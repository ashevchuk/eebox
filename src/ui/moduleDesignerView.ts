import { stableStringify } from '../library/equality';
import type { Library, ModuleDef } from '../library/types';
import { validateLibrary } from '../library/validate';
import { theme } from '../view/theme';
import { FieldsView } from './fieldsView';
import type { InspectorField, InspectorView } from './inspector';
import { applyEditorAction, applyEditorEdit, describeEditor, validateDraft, type EditorState } from './libraryEditor';
import { addTerminalAt, designerLayout, moveTerminal, pinAt, slotAt, UNIT_PX, type DesignerLayout, type DesignerPin } from './moduleDesigner';
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

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SHOWN_ERRORS = 6;
const DRAG_THRESHOLD_PX = 3;
const MAX_LABEL_CHARS = 28;
const MAX_ZOOM = 2.5;
const STAGE_WIDTH_PX = 560;
const STAGE_HEIGHT_PX = 400;

function svgElement(tag: string, attributes: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A modal that draws a module and lets a person place its terminals with the mouse. */
export class ModuleDesignerView {
  private state: EditorState;
  private savedText: string;
  private isNew: boolean;
  private pristine: boolean;
  private selected: number | null = null;
  private hover: { unit: number; side: 'top' | 'bottom' } | null = null;
  private drag: { pin: DesignerPin; start: { x: number; y: number }; moved: boolean } | null = null;
  private message = '';
  private messageIsError = false;
  private layout!: DesignerLayout;

  private readonly dialog = document.createElement('dialog');
  private readonly stage = document.createElement('div');
  private readonly status = document.createElement('span');
  private readonly saveButton = document.createElement('button');
  private readonly errors = document.createElement('div');
  private readonly templateSelect = document.createElement('select');
  private readonly moduleFields: FieldsView;
  private readonly terminalFields: FieldsView;

  constructor(
    library: Library,
    private readonly options: DesignerOptions,
    private readonly host: DesignerHost,
  ) {
    this.state = { draft: library, target: { kind: 'module', id: options.moduleId } };
    this.isNew = options.isNew;
    this.pristine = options.offerTemplates === true;
    this.savedText = options.isNew ? '' : stableStringify(library);

    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'Module designer';
    header.append(title);
    if (options.offerTemplates) header.append(this.templatePicker());
    this.status.className = 'editor-status';
    this.saveButton.textContent = 'Save';
    this.saveButton.className = 'primary';
    this.saveButton.addEventListener('click', () => void this.save());
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.addEventListener('click', () => void this.close());
    header.append(this.status, this.saveButton, close);

    this.stage.className = 'designer-stage';
    const side = document.createElement('section');
    side.className = 'designer-fields';
    const moduleFieldsHost = document.createElement('div');
    const terminalFieldsHost = document.createElement('div');
    side.append(terminalFieldsHost, moduleFieldsHost);
    const handlers = {
      onEdit: (key: string, raw: string | string[]) => this.edit(key, typeof raw === 'string' ? raw : raw.join(' ')),
      onAction: (action: { key: string }) => this.act(action.key),
    };
    this.moduleFields = new FieldsView(moduleFieldsHost, handlers);
    this.terminalFields = new FieldsView(terminalFieldsHost, handlers);

    const body = document.createElement('div');
    body.className = 'designer-body';
    body.append(this.stage, side);
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

  private get module(): ModuleDef {
    return this.state.draft.modules.find((m) => m.id === this.options.moduleId)!;
  }

  private get dirty(): boolean {
    return stableStringify(this.state.draft) !== this.savedText;
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
      const built = template.build(this.options.moduleId);
      this.state = {
        ...this.state,
        draft: { ...this.state.draft, modules: this.state.draft.modules.map((m) => (m.id === built.id ? built : m)) },
      };
      this.selected = null;
      this.renderAll(true);
    });
    label.append(this.templateSelect);
    return label;
  }

  private say(message: string, isError = false): void {
    this.message = message;
    this.messageIsError = isError;
    this.status.textContent = message;
    this.status.classList.toggle('error', isError);
  }

  private renderAll(force = false): void {
    this.layout = designerLayout(this.module);
    this.drawStage();
    this.renderFields(force);
    const problems = validateDraft(this.state.draft);
    this.errors.textContent = problems
      .slice(0, MAX_SHOWN_ERRORS)
      .map((p) => `${p.path || '(library)'}: ${p.message}`)
      .join('\n');
    this.saveButton.disabled = problems.length > 0 || !this.dirty;
    this.status.textContent = this.message;
    this.status.classList.toggle('error', this.messageIsError);
    this.templateSelect.disabled = !this.pristine;
  }

  private renderFields(force: boolean): void {
    const view = describeEditor(this.state);
    const isTerminalField = (f: InspectorField) => f.key.startsWith('t.');
    const moduleActions = view.actions.filter((a) => a.key === 'defaultTerminals');
    this.moduleFields.render(
      { title: 'Module', fields: view.fields.filter((f) => !isTerminalField(f)), actions: moduleActions } satisfies InspectorView,
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
        { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 13, fill: '#14161d', transform: `rotate(-90 ${cx} ${cy})` },
        label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}\u2026` : label,
      ),
    );
    svg.append(svgElement('text', { x: body.x, y: body.y + body.height + 18, 'font-size': 11, fill: '#9aa1b3' }, `${layout.widthUnits} unit${layout.widthUnits === 1 ? '' : 's'}, ${(layout.widthUnits * 17.5).toFixed(1)} mm`));
    if (this.hover && this.drag?.moved) {
      const x = body.x + (this.hover.unit + 0.5) * UNIT_PX;
      const y = this.hover.side === 'top' ? body.y + 18 : body.y + body.height - 18;
      svg.append(svgElement('circle', { cx: x, cy: y, r: 9, fill: 'none', stroke: '#f5c518', 'stroke-dasharray': '3 3', 'stroke-width': 2 }));
    }
    for (const pin of layout.pins) {
      const selected = pin.source !== null && pin.source === this.selected;
      svg.append(svgElement('circle', { cx: pin.x, cy: pin.y, r: 6, fill: colours[pin.terminal.conductor], stroke: selected ? '#f5c518' : '#14161d', 'stroke-width': selected ? 3 : 1, class: 'designer-pin' }));
      svg.append(
        svgElement('text', { x: pin.x, y: pin.terminal.side === 'top' ? pin.y + 19 : pin.y - 11, 'text-anchor': 'middle', 'font-size': 9, fill: '#14161d' }, pin.terminal.name),
      );
    }
    svg.addEventListener('pointerdown', (e) => this.onPointerDown(e, svg));
    svg.addEventListener('pointermove', (e) => this.onPointerMove(e, svg));
    svg.addEventListener('pointerup', (e) => this.onPointerUp(e, svg));
    const hint = document.createElement('p');
    hint.className = 'designer-hint';
    hint.textContent = 'Click the top or bottom half to add a terminal, click a terminal to select it, drag it to move it, press Delete to remove it.';
    this.stage.replaceChildren(svg, hint);
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
    if (pin) {
      this.drag = { pin, start: at, moved: false };
      svg.setPointerCapture(e.pointerId);
      this.selected = this.entryOf(pin);
      this.renderFields(false);
      return;
    }
    const slot = slotAt(this.layout, at.x, at.y);
    if (!slot) return;
    const added = addTerminalAt(this.state.draft, this.options.moduleId, slot.unit, slot.side);
    if (!added.ok) return this.say(added.message, true);
    this.apply(added.draft, added.index);
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
    if (!drag?.moved) {
      this.hover = null;
      return this.renderAll();
    }
    const slot = slotAt(this.layout, this.point(e, svg).x, this.point(e, svg).y);
    this.hover = null;
    if (!slot) return this.renderAll();
    const moved = moveTerminal(this.state.draft, this.options.moduleId, this.entryOf(drag.pin), slot.unit, slot.side);
    if (!moved.ok) {
      this.say(moved.message, true);
      return this.renderAll();
    }
    this.apply(moved.draft, moved.index);
  }

  private apply(draft: Library, selected: number | null): void {
    this.state = { ...this.state, draft };
    this.selected = selected;
    this.pristine = false;
    this.say('');
    this.renderAll(true);
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected !== null && !/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) {
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
    this.state = { draft: result.draft, target: result.target ?? this.state.target };
    if (result.target?.kind === 'module') this.options.moduleId = result.target.id;
    this.pristine = false;
    this.say('');
    this.renderAll();
  }

  private act(key: string): void {
    const result = applyEditorAction(this.state, key);
    if (!result.ok) return this.say(result.message, true);
    this.state = { draft: result.draft, target: { kind: 'module', id: this.options.moduleId } };
    this.pristine = false;
    const removed = /^removeTerminal:(\d+)$/.exec(key);
    if (removed) this.selected = null;
    if (key === 'addTerminal') this.selected = (this.module.terminals?.length ?? 1) - 1;
    this.say('');
    this.renderAll(true);
  }

  private async save(): Promise<void> {
    const checked = validateLibrary(this.state.draft);
    if (!checked.ok) return this.say('Fix the problems listed below first.', true);
    try {
      await this.host.save(checked.library);
    } catch (error) {
      return this.say(`Saving failed: ${(error as Error).message}`, true);
    }
    this.isNew = false;
    this.savedText = stableStringify(this.state.draft);
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
