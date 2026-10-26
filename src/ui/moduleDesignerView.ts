import { stableStringify } from '../library/equality';
import { CONDUCTORS, TERMINAL_SIDES, TRIP_CURVES, type Conductor, type Library, type ModuleDef, type TerminalSide, type TripCurve } from '../library/types';
import { validateLibrary } from '../library/validate';
import { Camera } from '../view/Camera';
import { railRect } from '../view/geometry';
import { History } from '../view/history';
import { render } from '../view/render';
import { theme } from '../view/theme';
import { FieldsView } from './fieldsView';
import type { InspectorView } from './inspector';
import { applyEditorAction, applyEditorEdit, describeEditor, validateDraft, type EditorState } from './libraryEditor';
import {
  addPreset,
  addRow,
  addTerminalAt,
  connectTerminals,
  designerLayout,
  detachTerminal,
  makeBlock,
  makeVariants,
  moveTerminal,
  netCentre,
  netGroups,
  pinAt,
  pinLabels,
  railPreviewScene,
  repairPositions,
  setAllConductors,
  slotAt,
  spreadSide,
  TERMINAL_PRESETS,
  UNIT_PX,
  type DesignerLayout,
  type DesignerPin,
} from './moduleDesigner';
import { MODULE_TEMPLATES } from './moduleTemplates';

export interface DesignerHost {
  /** Stores the library the module belongs to. */
  save(library: Library): Promise<void>;
  askConfirmation(message: string, confirmLabel: string): Promise<boolean>;
}

export interface DesignerOptions {
  moduleId: string;
  /** True for a module that has never been stored. */
  isNew: boolean;
  /** Offers templates to start from, for a blank module; a copy of an existing one keeps its terminals. */
  offerTemplates?: boolean;
}

type Tool = 'place' | 'connect';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SHOWN_ERRORS = 6;
const DRAG_THRESHOLD_PX = 3;
const MAX_LABEL_CHARS = 28;
const MAX_ZOOM = 2.5;
const STAGE_WIDTH_PX = 560;
const STAGE_HEIGHT_PX = 400;
const RAIL_PREVIEW = { width: 520, height: 150 };
/** A light outline, so dark text stays readable where it runs past a narrow module onto the dark ground. */
const HALO = { stroke: '#e5e7eb', 'stroke-width': 3, 'paint-order': 'stroke' };
const NET_COLOR = '#7c3aed';
const LABEL_STAGGER_PX = 10;
const RAIL_MARGIN_MM = 45;
const SINGLE_TERMINAL = 'single';

function svgElement(tag: string, attributes: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = label;
  if (title) el.title = title;
  el.addEventListener('click', onClick);
  return el;
}

/** A modal that draws a module and lets a person place and join its terminals with the mouse. */
export class ModuleDesignerView {
  private readonly history: History<Library>;
  private moduleId: string;
  private savedText: string;
  private pristine: boolean;
  private selected: number | null = null;
  private tool: Tool = 'place';
  private connectFrom: number | null = null;
  /** The width the drawing shows, when the slider has moved it; null follows the width of the module. */
  private previewWidth: number | null = null;
  private hover: { unit: number; side: 'top' | 'bottom' } | null = null;
  private drag: { pin: DesignerPin; start: { x: number; y: number }; moved: boolean } | null = null;
  private message = '';
  private messageIsError = false;
  private layout!: DesignerLayout;

  private readonly dialog = document.createElement('dialog');
  private readonly svgHost = document.createElement('div');
  private readonly railCanvas = document.createElement('canvas');
  private readonly status = document.createElement('span');
  private readonly saveButton = document.createElement('button');
  private readonly undoButton = document.createElement('button');
  private readonly redoButton = document.createElement('button');
  private readonly errors = document.createElement('div');
  private readonly templateSelect = document.createElement('select');
  private readonly kindSelect = document.createElement('select');
  private readonly placeButton = document.createElement('button');
  private readonly connectButton = document.createElement('button');
  private readonly detachButton = document.createElement('button');
  private readonly widthSlider = document.createElement('input');
  private readonly widthLabel = document.createElement('span');
  private readonly moduleFields: FieldsView;
  private readonly terminalFields: FieldsView;

  constructor(
    library: Library,
    private readonly options: DesignerOptions,
    private readonly host: DesignerHost,
  ) {
    this.history = new History<Library>(library);
    this.moduleId = options.moduleId;
    this.pristine = options.offerTemplates === true;
    this.savedText = options.isNew ? '' : stableStringify(library);

    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'Module designer';
    header.append(title);
    if (options.offerTemplates) header.append(this.templatePicker());
    this.status.className = 'editor-status';
    this.undoButton.textContent = 'Undo';
    this.undoButton.addEventListener('click', () => this.undo());
    this.redoButton.textContent = 'Redo';
    this.redoButton.addEventListener('click', () => this.redo());
    this.saveButton.textContent = 'Save';
    this.saveButton.className = 'primary';
    this.saveButton.addEventListener('click', () => void this.save());
    header.append(this.status, this.undoButton, this.redoButton, this.saveButton, button('Close', () => void this.close()));

    const stage = document.createElement('div');
    stage.className = 'designer-stage';
    this.railCanvas.width = RAIL_PREVIEW.width;
    this.railCanvas.height = RAIL_PREVIEW.height;
    this.railCanvas.className = 'designer-rail';
    const hint = document.createElement('p');
    hint.className = 'designer-hint';
    hint.textContent =
      'Place: click the top or bottom half to add, click a terminal to select it, drag it to move it, Delete removes it. ' +
      'Connect: click two terminals to join them inside the module.';
    stage.append(this.toolbar(), this.svgHost, this.widthControl(), hint, this.railCaption(), this.railCanvas);

    const side = document.createElement('section');
    side.className = 'designer-fields';
    const terminalHost = document.createElement('div');
    const moduleHost = document.createElement('div');
    side.append(terminalHost, moduleHost);
    const handlers = {
      onEdit: (key: string, raw: string | string[]) => this.edit(key, typeof raw === 'string' ? raw : raw.join(' ')),
      onAction: (action: { key: string }) => this.act(action.key),
    };
    this.moduleFields = new FieldsView(moduleHost, handlers);
    this.terminalFields = new FieldsView(terminalHost, handlers);

    const body = document.createElement('div');
    body.className = 'designer-body';
    body.append(stage, side);
    this.errors.className = 'editor-errors';
    this.dialog.className = 'app-dialog editor-dialog designer-dialog';
    this.dialog.append(header, body, this.errors);
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      void this.close();
    });
    this.dialog.addEventListener('close', () => this.dialog.remove());
    this.dialog.addEventListener('keydown', (e) => this.onKey(e));
  }

  open(): void {
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.renderAll(true);
  }

  private get draft(): Library {
    return this.history.current;
  }

  private get state(): EditorState {
    return { draft: this.draft, target: { kind: 'module', id: this.moduleId } };
  }

  private get module(): ModuleDef {
    return this.draft.modules.find((m) => m.id === this.moduleId)!;
  }

  private get shownWidth(): number {
    return this.previewWidth ?? this.module.widthUnits;
  }

  private get dirty(): boolean {
    return stableStringify(this.draft) !== this.savedText;
  }

  private templatePicker(): HTMLElement {
    const label = document.createElement('label');
    label.className = 'designer-template';
    label.append('Start from ');
    for (const template of MODULE_TEMPLATES) {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = template.label;
      this.templateSelect.append(option);
    }
    this.templateSelect.value = 'blank';
    this.templateSelect.addEventListener('change', () => {
      const template = MODULE_TEMPLATES.find((t) => t.id === this.templateSelect.value);
      if (!template || !this.pristine) return;
      const built = template.build(this.moduleId);
      this.commit({ ...this.draft, modules: this.draft.modules.map((m) => (m.id === built.id ? built : m)) }, null, true);
    });
    label.append(this.templateSelect);
    return label;
  }

  private toolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'designer-toolbar';
    this.kindSelect.title = 'What a click on the drawing adds';
    for (const [value, label] of [[SINGLE_TERMINAL, 'Single terminal'], ...TERMINAL_PRESETS.map((p) => [p.id, p.label] as const)]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.kindSelect.append(option);
    }
    this.placeButton.textContent = 'Place';
    this.placeButton.addEventListener('click', () => this.setTool('place'));
    this.connectButton.textContent = 'Connect';
    this.connectButton.title = 'Click two terminals to join them inside the module';
    this.connectButton.addEventListener('click', () => this.setTool('connect'));
    this.detachButton.textContent = 'Detach';
    this.detachButton.title = 'Take the selected terminal out of its connection';
    this.detachButton.addEventListener('click', () => this.detach());
    const everything = document.createElement('select');
    everything.title = 'Put one conductor on every terminal';
    everything.append(new Option('All terminals: conductor…', ''));
    for (const conductor of CONDUCTORS) everything.append(new Option(conductor, conductor));
    everything.addEventListener('change', () => {
      if (everything.value) this.setEveryConductor(everything.value as Conductor);
      everything.value = '';
    });
    bar.append(
      this.placeButton,
      this.kindSelect,
      this.connectButton,
      this.detachButton,
      button('Row…', () => this.rowDialog(), 'Add several terminals on one side at once, spread evenly'),
      button('Spread', () => this.spread(), 'Space the terminals of the selected side evenly'),
      button('Block…', () => this.blockDialog(), 'Make a terminal block: so many on top, so many below'),
      everything,
      button('Variants…', () => this.variants(), 'Make a copy for every rating, curve or conductor'),
    );
    return bar;
  }

  private widthControl(): HTMLElement {
    const row = document.createElement('label');
    row.className = 'designer-width';
    this.widthSlider.type = 'range';
    this.widthSlider.step = 'any';
    this.widthSlider.addEventListener('input', () => {
      this.previewWidth = Number(this.widthSlider.value);
      this.renderAll();
    });
    row.append(this.widthLabel, this.widthSlider);
    return row;
  }

  private railCaption(): HTMLElement {
    const caption = document.createElement('p');
    caption.className = 'designer-hint';
    caption.textContent = 'On a rail:';
    return caption;
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.connectFrom = null;
    this.say('');
    this.renderAll();
  }

  private say(message: string, isError = false): void {
    this.message = message;
    this.messageIsError = isError;
    this.status.textContent = message;
    this.status.classList.toggle('error', isError);
  }

  /** Records a new draft in the history; `reset` also forgets what was selected and the width that was tried. */
  private commit(draft: Library, selected: number | null, reset = false): void {
    if (stableStringify(draft) === stableStringify(this.draft)) return;
    this.history.commit(draft);
    this.selected = selected;
    this.connectFrom = null;
    if (reset) this.previewWidth = null;
    this.say('');
    this.renderAll(true);
  }

  private undo(): void {
    if (!this.history.undo()) return;
    this.afterHistory();
  }

  private redo(): void {
    if (!this.history.redo()) return;
    this.afterHistory();
  }

  private afterHistory(): void {
    this.pristine = false;
    this.connectFrom = null;
    if (!this.draft.modules.some((m) => m.id === this.moduleId)) this.moduleId = this.options.moduleId;
    const count = this.module.terminals?.length ?? 0;
    if (this.selected !== null && this.selected >= count) this.selected = null;
    this.say('');
    this.renderAll(true);
  }

  private renderAll(force = false): void {
    this.layout = designerLayout(this.module, this.shownWidth);
    this.drawStage();
    this.drawRailPreview();
    this.renderFields(force);
    const problems = validateDraft(this.draft);
    this.errors.textContent = problems
      .slice(0, MAX_SHOWN_ERRORS)
      .map((p) => `${p.path || '(library)'}: ${p.message}`)
      .join('\n');
    this.saveButton.disabled = problems.length > 0 || !this.dirty;
    this.undoButton.disabled = !this.history.canUndo;
    this.redoButton.disabled = !this.history.canRedo;
    this.placeButton.classList.toggle('active', this.tool === 'place');
    this.connectButton.classList.toggle('active', this.tool === 'connect');
    this.kindSelect.disabled = this.tool !== 'place';
    const entry = this.selected === null ? undefined : this.module.terminals?.[this.selected];
    this.detachButton.disabled = entry?.net === undefined;
    this.syncWidthControl();
    this.templateSelect.disabled = !this.pristine;
    this.status.textContent = this.message;
    this.status.classList.toggle('error', this.messageIsError);
  }

  private syncWidthControl(): void {
    const range = this.module.resizable;
    this.widthSlider.disabled = !range;
    this.widthSlider.min = String(range?.minUnits ?? this.module.widthUnits);
    this.widthSlider.max = String(range?.maxUnits ?? this.module.widthUnits);
    this.widthSlider.value = String(this.shownWidth);
    const note = range ? `${range.minUnits}-${range.maxUnits}` : 'fixed';
    this.widthLabel.textContent = `Shown at ${this.shownWidth} unit${this.shownWidth === 1 ? '' : 's'} (${note}) `;
  }

  private renderFields(force: boolean): void {
    const view = describeEditor(this.state);
    const moduleActions = view.actions.filter((a) => a.key === 'defaultTerminals');
    this.moduleFields.render(
      { title: 'Module', fields: view.fields.filter((f) => !f.key.startsWith('t.')), actions: moduleActions } satisfies InspectorView,
      force,
    );
    const index = this.selected;
    const own = index === null ? [] : view.fields.filter((f) => f.key.startsWith(`t.${index}.`));
    const terminalView: InspectorView =
      index === null || own.length === 0
        ? { title: 'No terminal selected', fields: [], actions: [{ key: 'addTerminal', label: 'Add terminal' }] }
        : {
            title: `Terminal ${index + 1}`,
            fields: own,
            actions: [{ key: `removeTerminal:${index}`, label: 'Remove terminal' }],
          };
    this.terminalFields.render(terminalView, force);
  }

  private drawStage(): void {
    const { layout } = this;
    const colours = theme().conductors;
    const svg = svgElement('svg', { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`, class: 'designer-svg' });
    const zoom = Math.max(1, Math.min(MAX_ZOOM, STAGE_WIDTH_PX / layout.width, STAGE_HEIGHT_PX / layout.height));
    svg.style.width = `${layout.width * zoom}px`;
    const { body } = layout;
    svg.append(svgElement('rect', { x: body.x, y: body.y, width: body.width, height: body.height, fill: '#e5e7eb', stroke: '#6b7280', rx: 3 }));
    for (let unit = 1; unit < layout.widthUnits; unit++) {
      const x = body.x + unit * UNIT_PX;
      svg.append(svgElement('line', { x1: x, y1: body.y, x2: x, y2: body.y + body.height, stroke: '#9ca3af', 'stroke-dasharray': '3 4', 'stroke-width': 1 }));
    }
    const label = this.module.name || this.module.id;
    const cx = body.x + body.width / 2;
    const cy = body.y + body.height / 2;
    svg.append(
      svgElement(
        'text',
        { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 13, fill: '#14161d', ...HALO, transform: `rotate(-90 ${cx} ${cy})` },
        label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label,
      ),
    );
    svg.append(svgElement('text', { x: body.x, y: body.y + body.height + 18, 'font-size': 11, fill: '#9aa1b3' }, `${layout.widthUnits} unit${layout.widthUnits === 1 ? '' : 's'}, ${(layout.widthUnits * 17.5).toFixed(1)} mm`));
    for (const { net, pins } of netGroups(layout)) {
      const centre = netCentre(pins);
      const group = svgElement('g', { stroke: NET_COLOR, 'stroke-width': 2, opacity: 0.6, fill: NET_COLOR });
      group.append(svgElement('title', {}, `Joined inside the module: ${net}`));
      for (const pin of pins) group.append(svgElement('line', { x1: pin.x, y1: pin.y, x2: centre.x, y2: centre.y }));
      group.append(svgElement('circle', { cx: centre.x, cy: centre.y, r: 4, stroke: 'none' }));
      svg.append(group);
    }
    if (this.hover && this.drag?.moved) {
      const x = body.x + (this.hover.unit + 0.5) * UNIT_PX;
      const y = this.hover.side === 'top' ? body.y + 18 : body.y + body.height - 18;
      svg.append(svgElement('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: '#f5c518', 'stroke-dasharray': '3 3', 'stroke-width': 2 }));
    }
    const labels = pinLabels(layout);
    for (const pin of layout.pins) {
      const entry = pin.source ?? layout.pins.indexOf(pin);
      const marked = entry === this.selected || entry === this.connectFrom;
      svg.append(svgElement('circle', { cx: pin.x, cy: pin.y, r: layout.pinRadius, fill: colours[pin.terminal.conductor], stroke: marked ? '#f5c518' : '#14161d', 'stroke-width': marked ? 3 : 1, class: 'designer-pin' }));
      const stagger = layout.crowded ? (layout.pins.indexOf(pin) % 2) * LABEL_STAGGER_PX : 0;
      const labelY = pin.terminal.side === 'top' ? pin.y + 19 + stagger : pin.y - 11 - stagger;
      svg.append(svgElement('text', { x: pin.x, y: labelY, 'text-anchor': 'middle', 'font-size': layout.crowded ? 8 : 9, fill: '#14161d', ...HALO }, labels[layout.pins.indexOf(pin)]!));
    }
    svg.addEventListener('pointerdown', (e) => this.onPointerDown(e, svg));
    svg.addEventListener('pointermove', (e) => this.onPointerMove(e, svg));
    svg.addEventListener('pointerup', (e) => this.onPointerUp(e, svg));
    this.svgHost.replaceChildren(svg);
  }

  /** Draws the module with the very renderer of the panel, on a rail of its own. */
  private drawRailPreview(): void {
    const ctx = this.railCanvas.getContext('2d');
    if (!ctx) return;
    const { panel, resolve } = railPreviewScene(this.module, this.shownWidth);
    const rail = railRect(panel, 0);
    const camera = new Camera();
    camera.fit(
      { minX: rail.x - RAIL_MARGIN_MM, minY: rail.y - RAIL_MARGIN_MM, maxX: rail.x + rail.width + RAIL_MARGIN_MM, maxY: rail.y + rail.height + RAIL_MARGIN_MM },
      RAIL_PREVIEW.width,
      RAIL_PREVIEW.height,
      0,
    );
    render(ctx, camera, { panel, resolve, selectedPlacementId: null, selectedCombId: null, selectedRail: null, moving: null, ghost: null }, RAIL_PREVIEW.width, RAIL_PREVIEW.height, 1);
  }

  private point(e: PointerEvent, svg: SVGElement): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) * this.layout.width) / rect.width, y: ((e.clientY - rect.top) * this.layout.height) / rect.height };
  }

  private entryOf(pin: DesignerPin): number {
    return pin.source ?? this.layout.pins.indexOf(pin);
  }

  private onPointerDown(e: PointerEvent, svg: SVGElement): void {
    const at = this.point(e, svg);
    const pin = pinAt(this.layout, at.x, at.y);
    if (this.tool === 'connect') return this.connectAt(pin);
    if (pin) {
      this.drag = { pin, start: at, moved: false };
      svg.setPointerCapture(e.pointerId);
      this.selected = this.entryOf(pin);
      this.renderFields(false);
      this.detachButton.disabled = this.module.terminals?.[this.selected]?.net === undefined;
      return;
    }
    const slot = slotAt(this.layout, at.x, at.y);
    if (!slot) return;
    const kind = this.kindSelect.value;
    const width = this.shownWidth;
    const added =
      kind === SINGLE_TERMINAL
        ? addTerminalAt(this.draft, this.moduleId, slot.unit, slot.side, 'L', width)
        : addPreset(this.draft, this.moduleId, kind, slot.unit, slot.side, width);
    if (!added.ok) return this.say(added.message, true);
    this.commit(added.draft, added.index);
  }

  private connectAt(pin: DesignerPin | undefined): void {
    if (!pin) {
      this.connectFrom = null;
      return this.renderAll();
    }
    const entry = this.entryOf(pin);
    if (this.connectFrom === null) {
      this.connectFrom = entry;
      this.say('Now click the terminal to join it to.');
      return this.renderAll();
    }
    const joined = connectTerminals(this.draft, this.moduleId, this.connectFrom, entry);
    if (!joined.ok) {
      this.say(joined.message, true);
      return this.renderAll();
    }
    this.commit(joined.draft, entry);
  }

  private detach(): void {
    if (this.selected === null) return;
    const result = detachTerminal(this.draft, this.moduleId, this.selected);
    if (!result.ok) return this.say(result.message, true);
    this.commit(result.draft, this.selected);
  }

  private onPointerMove(e: PointerEvent, svg: SVGElement): void {
    if (!this.drag) return;
    const at = this.point(e, svg);
    if (!this.drag.moved && Math.hypot(at.x - this.drag.start.x, at.y - this.drag.start.y) < DRAG_THRESHOLD_PX) return;
    this.drag.moved = true;
    this.hover = slotAt(this.layout, at.x, at.y);
    this.drawStage();
  }

  private onPointerUp(e: PointerEvent, svg: SVGElement): void {
    const drag = this.drag;
    this.drag = null;
    const at = this.point(e, svg);
    const slot = drag?.moved ? slotAt(this.layout, at.x, at.y) : null;
    this.hover = null;
    if (!drag?.moved || !slot) return this.renderAll();
    const moved = moveTerminal(this.draft, this.moduleId, this.entryOf(drag.pin), slot.unit, slot.side, this.shownWidth);
    if (!moved.ok) {
      this.say(moved.message, true);
      return this.renderAll();
    }
    this.commit(moved.draft, moved.index);
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);
    if ((e.ctrlKey || e.metaKey) && !typing && (e.key === 'z' || e.key === 'y' || e.key === 'Z')) {
      e.preventDefault();
      if (e.key === 'y' || e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected !== null && !typing) {
      e.preventDefault();
      this.act(`removeTerminal:${this.selected}`);
    }
  }

  private edit(key: string, raw: string): void {
    const result = applyEditorEdit(this.state, key, raw);
    if (!result.ok) {
      this.say(result.message, true);
      return this.renderAll(true);
    }
    if (result.target?.kind === 'module') this.moduleId = result.target.id;
    this.pristine = false;
    if (key === 'widthUnits') this.previewWidth = null;
    const repaired = ['widthUnits', 'resizeMin', 'resizeMax'].includes(key) ? repairPositions(result.draft, this.moduleId) : result.draft;
    this.commit(repaired, this.selected);
  }

  private act(key: string): void {
    const result = applyEditorAction(this.state, key);
    if (!result.ok) return this.say(result.message, true);
    this.pristine = false;
    let selected = this.selected;
    if (/^removeTerminal:\d+$/.test(key)) selected = null;
    if (key === 'addTerminal') selected = (result.draft.modules.find((m) => m.id === this.moduleId)?.terminals?.length ?? 1) - 1;
    this.commit(result.draft, selected);
  }

  /** Asks for ratings and curves and adds a copy of the module for each. */
  private variants(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Variants of this module';
    const help = document.createElement('p');
    help.textContent = `One copy for every rating, curve and conductor you list, and for every combination of them. Ratings in amperes, curves out of ${TRIP_CURVES.join(' ')}; a copy for a conductor puts it on all terminals. Separate with spaces.`;
    const ratings = document.createElement('input');
    ratings.placeholder = 'Ratings: 6 10 16 25 32';
    const curves = document.createElement('input');
    curves.placeholder = 'Curves (optional): B C';
    const conductorsInput = document.createElement('input');
    conductorsInput.placeholder = `Conductors (optional): ${CONDUCTORS.join(' ')}`;
    const problem = document.createElement('div');
    problem.className = 'editor-errors';
    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const make = button('Make variants', () => {
      const rates = ratings.value.split(/[\s,]+/).filter(Boolean).map(Number);
      const named = curves.value.split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase());
      const unknown = named.find((c) => !(TRIP_CURVES as readonly string[]).includes(c));
      const wires = conductorsInput.value.split(/[\s,]+/).filter(Boolean);
      const badWire = wires.find((c) => !(CONDUCTORS as readonly string[]).includes(c));
      if (rates.some((r) => !Number.isFinite(r))) return void (problem.textContent = 'Ratings must be numbers.');
      if (unknown) return void (problem.textContent = `Unknown curve ${unknown}.`);
      if (badWire) return void (problem.textContent = `Unknown conductor ${badWire}.`);
      const result = makeVariants(this.draft, this.moduleId, rates, named as TripCurve[], wires as Conductor[]);
      if (!result.ok) return void (problem.textContent = result.message);
      dialog.close();
      this.pristine = false;
      this.commit(result.draft, this.selected);
      this.say(`Made ${result.ids.length} variants after this module.`);
    });
    make.className = 'primary';
    actions.append(button('Cancel', () => dialog.close()), make);
    dialog.append(title, help, ratings, curves, conductorsInput, problem, actions);
    dialog.addEventListener('close', () => dialog.remove());
    this.dialog.append(dialog);
    dialog.showModal();
    ratings.focus();
  }

  /** A small dialog with labelled fields; `submit` returns a message when something is wrong, or null when it is done. */
  private form(title: string, fields: Array<[string, HTMLElement]>, submit: () => string | null): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const rows = fields.map(([text, control]) => {
      const row = document.createElement('label');
      row.className = 'designer-form-row';
      row.append(text, control);
      return row;
    });
    const problem = document.createElement('div');
    problem.className = 'editor-errors';
    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const ok = button('OK', () => {
      const message = submit();
      if (message) problem.textContent = message;
      else dialog.close();
    });
    ok.className = 'primary';
    actions.append(button('Cancel', () => dialog.close()), ok);
    dialog.append(heading, ...rows, problem, actions);
    dialog.addEventListener('close', () => dialog.remove());
    this.dialog.append(dialog);
    dialog.showModal();
    (rows[0]?.querySelector('input, select') as HTMLElement | null)?.focus();
  }

  private choice(options: readonly string[], value: string): HTMLSelectElement {
    const select = document.createElement('select');
    for (const option of options) select.append(new Option(option, option));
    select.value = value;
    return select;
  }

  private numberInput(value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = String(value);
    return input;
  }

  private rowDialog(): void {
    const side = this.choice(TERMINAL_SIDES, 'bottom');
    const count = this.numberInput(6);
    const conductor = this.choice(CONDUCTORS, this.module.terminals?.[0]?.conductor ?? 'L');
    const prefix = document.createElement('input');
    prefix.value = 'T';
    const joined = document.createElement('input');
    joined.type = 'checkbox';
    this.form(
      'Row of terminals',
      [['Side', side], ['How many', count], ['Conductor', conductor], ['Name (numbered from 1)', prefix], ['Joined inside the module', joined]],
      () => {
        const result = addRow(this.draft, this.moduleId, { side: side.value as TerminalSide, count: Number(count.value), conductor: conductor.value as Conductor, prefix: prefix.value.trim(), joined: joined.checked }, this.shownWidth);
        if (!result.ok) return result.message;
        this.pristine = false;
        this.commit(result.draft, result.index);
        return null;
      },
    );
  }

  private blockDialog(): void {
    const top = this.numberInput(1);
    const bottom = this.numberInput(6);
    const conductor = this.choice(CONDUCTORS, this.module.terminals?.[0]?.conductor ?? 'L');
    const joined = document.createElement('input');
    joined.type = 'checkbox';
    joined.checked = true;
    this.form(
      'Terminal block',
      [['Terminals on top (inputs)', top], ['Terminals below (outputs)', bottom], ['Conductor', conductor], ['All one point (a distribution block)', joined]],
      () => {
        const result = makeBlock(this.draft, this.moduleId, { top: Number(top.value), bottom: Number(bottom.value), conductor: conductor.value as Conductor, joined: joined.checked }, this.shownWidth);
        if (!result.ok) return result.message;
        this.pristine = false;
        this.commit(result.draft, null);
        this.say('The terminals were replaced by the block.');
        return null;
      },
    );
  }

  private spread(): void {
    const entry = this.selected === null ? undefined : this.module.terminals?.[this.selected];
    const sides: TerminalSide[] = entry ? [entry.side] : ['top', 'bottom'];
    let draft = this.draft;
    for (const side of sides) {
      const result = spreadSide({ ...draft }, this.moduleId, side, this.shownWidth);
      if (result.ok) draft = result.draft;
      else if (sides.length === 1) return this.say(result.message, true);
    }
    this.commit(draft, this.selected);
  }

  private setEveryConductor(conductor: Conductor): void {
    const result = setAllConductors(this.draft, this.moduleId, conductor);
    if (!result.ok) return this.say(result.message, true);
    this.pristine = false;
    this.commit(result.draft, this.selected);
  }

  private async save(): Promise<void> {
    const checked = validateLibrary(this.draft);
    if (!checked.ok) return this.say('Fix the problems listed below first.', true);
    try {
      await this.host.save(checked.library);
    } catch (error) {
      return this.say(`Saving failed: ${(error as Error).message}`, true);
    }
    this.savedText = stableStringify(this.draft);
    this.say(`Saved "${this.module.name}".`);
    this.renderAll();
  }

  private async close(): Promise<void> {
    if (this.dirty && !(await this.host.askConfirmation('Close the designer and discard the changes you have not saved?', 'Discard'))) return;
    this.dialog.close();
  }
}

/** Opens the designer on a module of a library draft; the designer works on the draft it is given. */
export function openModuleDesigner(library: Library, options: DesignerOptions, host: DesignerHost): void {
  new ModuleDesignerView(library, { ...options }, host).open();
}
