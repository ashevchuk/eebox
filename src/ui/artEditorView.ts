import { placeArtFrom, type ArtShape, type PlacedShape } from '../library/art';
import { MODULE_UNIT_MM, type Library, type ModuleDef } from '../library/types';
import { terminalsOf } from '../electrical/terminals';
import { FONT_FAMILY } from '../view/font';
import { LEVER_COLORS } from '../view/render';
import { conductorStyle } from '../view/theme';
import {
  ART_TOOLS,
  FACE_HEIGHT_MM,
  addShape,
  addShapes,
  addVertex,
  alignShapes,
  applyShapeEdit,
  boundsOf,
  copiedShapeCount,
  copyShapes,
  createShape,
  distributeShapes,
  dragHandle,
  duplicateShapes,
  flipShape,
  flipShapes,
  groupCentre,
  handlesOf,
  moveLayer,
  pasteShapes,
  polylineThrough,
  removeShapes,
  removeVertex,
  replaceShape,
  replaceShapes,
  rotateShapeBy,
  shapeAt,
  shapeFields,
  shapesInBox,
  snapMm,
  textBox,
  translate,
  turnShape,
  turnShapes,
  type Align,
  type ArtResult,
  type ArtTool,
  type Box,
  type Layer,
  type Point,
} from './artEditor';
import { svgElement, shapeElement } from './artSvg';
import { FieldsView } from './fieldsView';
import { openSvgImportDialog } from './svgImportDialog';

/** What the face editor needs from the designer around it. */
export interface ArtEditorHost {
  draft(): Library;
  module(): ModuleDef;
  /** Shows a modal dialog on top of the designer. */
  openDialog(dialog: HTMLDialogElement): void;
  /** Saves the face as an SVG file. */
  exportSvg(): void;
  /** Records a new draft in the history of the designer, once for each gesture. */
  commit(draft: Library): void;
  say(message: string, isError?: boolean): void;
}

const MAX_SCALE_PX_PER_MM = 4;
const MAX_ZOOM = 6;
const MIN_ZOOM = 0.5;
const ZOOM_STEP = 1.25;
const STAGE_WIDTH_PX = 540;
const STAGE_HEIGHT_PX = 380;
const HIT_TOLERANCE_PX = 5;
const HANDLE_RADIUS_PX = 4.5;
const DRAG_THRESHOLD_PX = 3;
const SELECTION_COLOUR = '#f5c518';
const BAND_MM = 14;
const DEFAULT_TURN_DEGREES = 15;
const TOOL_LABELS: Record<ArtTool, string> = { select: 'Select', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', polyline: 'Polyline', text: 'Text' };
const TOOL_HINTS: Record<ArtTool, string> = {
  select: 'Click a shape to select it, Shift+click to add, drag over empty space to select what is inside; drag a selection to move it, pull a handle to resize. Delete removes, the arrow keys nudge, Ctrl+C and Ctrl+V copy to another module.',
  line: 'Drag from one end of the line to the other.',
  rect: 'Drag from one corner to the opposite one.',
  ellipse: 'Drag across the box the ellipse is to fill.',
  polyline: 'Click each point; double-click or press Enter to finish, Escape to cancel.',
  text: 'Click where the text is to go, then type it in the fields at the right.',
};
const LAYER_BUTTONS: Array<[Layer, string, string]> = [
  ['back', 'To back', 'Put the shape under all the others'],
  ['backward', 'Down', 'Put the shape one step down'],
  ['forward', 'Up', 'Put the shape one step up'],
  ['front', 'To front', 'Put the shape over all the others'],
];
const ALIGN_BUTTONS: Array<[Align, string]> = [
  ['left', 'Left'],
  ['centre', 'Centre'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['middle', 'Middle'],
  ['bottom', 'Bottom'],
];

function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.textContent = label;
  if (title) el.title = title;
  el.addEventListener('click', onClick);
  return el;
}

type Gesture =
  | { kind: 'create'; tool: Exclude<ArtTool, 'select' | 'polyline' | 'text'>; from: Point; to: Point }
  | { kind: 'move'; from: Point; originals: Map<number, ArtShape>; moved: boolean; current: Map<number, ArtShape> }
  | { kind: 'handle'; index: number; id: string; original: ArtShape; current: ArtShape }
  | { kind: 'band'; from: Point; to: Point; additive: boolean };

const describe = (shape: ArtShape, index: number): string => {
  const brief = shape.kind === 'text' ? `“${shape.text}”` : (shape.anchor ?? '');
  return `${index + 1}. ${shape.kind}${brief ? ` ${brief}` : ''}`;
};

/** Draws and edits the face of a module on an SVG that is to scale: a millimetre is the same on both axes. */
export class ArtEditorView {
  readonly stage = document.createElement('div');
  readonly side = document.createElement('div');
  private readonly toolbar = document.createElement('div');
  private readonly svgHost = document.createElement('div');
  private readonly hint = document.createElement('p');
  private readonly layers = document.createElement('div');
  private readonly layerBar = document.createElement('div');
  private readonly alignBar = document.createElement('div');
  private readonly fields: FieldsView;
  private readonly toolButtons = new Map<ArtTool, HTMLButtonElement>();
  private readonly exportButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly pasteButton: HTMLButtonElement;
  private readonly turnInput = document.createElement('input');
  private tool: ArtTool = 'select';
  /** The indexes of the selected shapes, in the order of the drawing. */
  private selection: number[] = [];
  private gesture: Gesture | null = null;
  private points: Array<[number, number]> = [];
  private cursor: Point | null = null;
  private zoom = 1;
  private scale = 1;
  private svg: SVGSVGElement | null = null;

  constructor(private readonly host: ArtEditorHost) {
    this.stage.className = 'face-stage';
    this.toolbar.className = 'designer-toolbar';
    for (const tool of ART_TOOLS) {
      const el = button(TOOL_LABELS[tool], () => this.setTool(tool), TOOL_HINTS[tool]);
      this.toolButtons.set(tool, el);
      this.toolbar.append(el);
    }
    this.exportButton = button('Export SVG', () => this.host.exportSvg(), 'Save the drawing of the face as an SVG file, to import onto another module or to open in a drawing program');
    this.copyButton = button('Copy', () => this.copySelection(), 'Copy the selected shapes, to paste them on this or another module (Ctrl+C)');
    this.pasteButton = button('Paste', () => this.paste(), 'Put the copied shapes on this face (Ctrl+V)');
    this.toolbar.append(button('Import SVG…', () => this.importSvg(), 'Put the drawing of an SVG file on the face'));
    this.toolbar.append(this.exportButton, this.copyButton, this.pasteButton);
    this.toolbar.append(button('Finish line', () => this.finishPolyline(), 'Make the polyline from the points clicked so far'));
    this.toolbar.append(button('Zoom −', () => this.zoomBy(1 / ZOOM_STEP), 'Make the face smaller (Ctrl + wheel)'));
    this.toolbar.append(button('Fit', () => this.zoomTo(1), 'Show the whole face'));
    this.toolbar.append(button('Zoom +', () => this.zoomBy(ZOOM_STEP), 'Make the face larger (Ctrl + wheel)'));
    this.hint.className = 'designer-hint';
    this.svgHost.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      },
      { passive: false },
    );
    this.stage.append(this.toolbar, this.svgHost, this.hint);

    this.turnInput.type = 'number';
    this.turnInput.value = String(DEFAULT_TURN_DEGREES);
    this.turnInput.step = '5';
    this.turnInput.title = 'Degrees, clockwise';
    this.turnInput.className = 'face-angle';
    this.layers.className = 'face-layers';
    this.layerBar.className = 'inspector-actions first';
    this.alignBar.className = 'inspector-actions face-align';
    const propertiesHost = document.createElement('div');
    this.fields = new FieldsView(propertiesHost, {
      onEdit: (key, raw) => this.edit(key, typeof raw === 'string' ? raw : raw.join(' ')),
      onAction: () => undefined,
    });
    this.side.append(this.layers, this.layerBar, this.alignBar, propertiesHost);
  }

  /** Goes back to the select tool with nothing selected, as when the face is opened. */
  reset(): void {
    this.tool = 'select';
    this.selection = [];
    this.gesture = null;
    this.points = [];
    this.zoom = 1;
  }

  private get art(): ArtShape[] {
    return this.host.module().art ?? [];
  }

  /** The one selected shape, when exactly one is. */
  private get single(): number | undefined {
    return this.selection.length === 1 ? this.selection[0] : undefined;
  }

  private get chosen(): ArtShape[] {
    return this.selection.map((i) => this.art[i]!).filter(Boolean);
  }

  private setTool(tool: ArtTool): void {
    this.tool = tool;
    this.points = [];
    this.gesture = null;
    this.render();
  }

  private zoomBy(factor: number): void {
    this.zoomTo(this.zoom * factor);
  }

  private zoomTo(zoom: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.render();
  }

  render(): void {
    const module = this.host.module();
    this.selection = this.selection.filter((i) => i < this.art.length);
    for (const [tool, el] of this.toolButtons) el.classList.toggle('active', tool === this.tool);
    this.exportButton.disabled = this.art.length === 0;
    this.copyButton.disabled = this.selection.length === 0;
    this.pasteButton.disabled = copiedShapeCount() === 0;
    this.hint.textContent = `${TOOL_HINTS[this.tool]} Edited at ${module.widthUnits} unit${module.widthUnits === 1 ? '' : 's'}, the width the module is made for; the rail below shows the other widths.`;
    this.drawStage(module);
    this.renderSide();
  }

  /** The shapes as they are drawn: those being dragged are in the place they have been dragged to. */
  private shown(): ArtShape[] {
    const { gesture } = this;
    return this.art.map((shape, i) => {
      if (gesture?.kind === 'move') return gesture.current.get(i) ?? shape;
      if (gesture?.kind === 'handle' && gesture.index === i) return gesture.current;
      return shape;
    });
  }

  private drawStage(module: ModuleDef): void {
    const widthMm = module.widthUnits * MODULE_UNIT_MM;
    const scale = Math.min(MAX_SCALE_PX_PER_MM, STAGE_WIDTH_PX / widthMm, STAGE_HEIGHT_PX / FACE_HEIGHT_MM) * this.zoom;
    this.scale = scale;
    const margin = 12;
    const svg = svgElement('svg', { width: widthMm * scale + 2 * margin, height: FACE_HEIGHT_MM * scale + 2 * margin, class: 'designer-svg' }) as SVGSVGElement;
    svg.style.maxWidth = 'none';
    const face = svgElement('g', { transform: `translate(${margin} ${margin})` });
    svg.append(face);
    face.append(svgElement('rect', { x: 0, y: 0, width: widthMm * scale, height: FACE_HEIGHT_MM * scale, fill: '#e5e7eb', stroke: '#6b7280' }));
    face.append(svgElement('rect', { x: 0, y: 0, width: widthMm * scale, height: BAND_MM * scale, fill: LEVER_COLORS[module.kind] }));
    for (let unit = 1; unit < module.widthUnits; unit++) {
      const x = unit * MODULE_UNIT_MM * scale;
      face.append(svgElement('line', { x1: x, y1: 0, x2: x, y2: FACE_HEIGHT_MM * scale, stroke: '#9ca3af', 'stroke-dasharray': '3 4' }));
    }

    const art = this.shown();
    const clip = svgElement('clipPath', { id: 'face-clip' });
    clip.append(svgElement('rect', { x: 0, y: 0, width: widthMm * scale, height: FACE_HEIGHT_MM * scale }));
    face.append(clip);
    const drawing = svgElement('g', { 'clip-path': 'url(#face-clip)' });
    for (const { shape } of placeArtFrom(art, module.widthUnits, module.widthUnits)) drawing.append(shapeElement(shape, scale));
    if (this.gesture?.kind === 'create') {
      const preview = createShape(this.gesture.tool, this.gesture.from, this.gesture.to);
      if (preview) drawing.append(shapeElement(preview, scale));
    }
    face.append(drawing);
    this.drawReference(face, module, scale);
    this.drawInProgress(face, scale);
    this.drawSelection(face, art, scale);
    if (this.gesture?.kind === 'band') this.drawBand(face, this.gesture, scale);

    svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    svg.addEventListener('pointermove', (e) => this.onPointerMove(e));
    svg.addEventListener('dblclick', () => this.finishPolyline());
    this.svg = svg;
    this.svgHost.replaceChildren(svg);
  }

  /** The terminals and the name, as the panel draws them over the face, so the drawing is made around them. */
  private drawReference(face: SVGElement, module: ModuleDef, scale: number): void {
    const terminals = terminalsOf(module, module.widthUnits);
    for (const terminal of terminals) {
      const sharing = terminals.filter((t) => t.side === terminal.side && t.unit === terminal.unit);
      const offset = (sharing.indexOf(terminal) - (sharing.length - 1) / 2) * 5;
      const x = (terminal.unit + 0.5) * MODULE_UNIT_MM + offset;
      const y = terminal.side === 'top' ? 7 : FACE_HEIGHT_MM - 6;
      const style = conductorStyle(terminal.conductor);
      face.append(svgElement('circle', { cx: x * scale, cy: y * scale, r: 2.4 * scale, fill: style.color, stroke: style.outline ?? '#14161d', 'stroke-width': 1, 'pointer-events': 'none', opacity: 0.85 }));
    }
    const cx = (module.widthUnits * MODULE_UNIT_MM * scale) / 2;
    const cy = (FACE_HEIGHT_MM * scale) / 2 + 4 * scale;
    face.append(svgElement('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 6 * scale, 'font-family': FONT_FAMILY, fill: '#14161d', opacity: 0.35, transform: `rotate(-90 ${cx} ${cy})`, 'pointer-events': 'none' }, module.shortName ?? module.name));
  }

  private drawInProgress(face: SVGElement, scale: number): void {
    if (this.tool !== 'polyline' || this.points.length === 0) return;
    const through = [...this.points, ...(this.cursor ? [[this.cursor.x, this.cursor.y] as [number, number]] : [])];
    face.append(svgElement('polyline', { points: through.map(([x, y]) => `${x * scale},${y * scale}`).join(' '), fill: 'none', stroke: SELECTION_COLOUR, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
    for (const [x, y] of this.points) face.append(svgElement('circle', { cx: x * scale, cy: y * scale, r: 3, fill: SELECTION_COLOUR, 'pointer-events': 'none' }));
  }

  private drawBand(face: SVGElement, band: Extract<Gesture, { kind: 'band' }>, scale: number): void {
    const [x1, x2] = [Math.min(band.from.x, band.to.x), Math.max(band.from.x, band.to.x)];
    const [y1, y2] = [Math.min(band.from.y, band.to.y), Math.max(band.from.y, band.to.y)];
    face.append(svgElement('rect', { x: x1 * scale, y: y1 * scale, width: (x2 - x1) * scale, height: (y2 - y1) * scale, fill: 'rgba(245, 197, 24, 0.12)', stroke: SELECTION_COLOUR, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
  }

  private drawSelection(face: SVGElement, art: ArtShape[], scale: number): void {
    if (this.tool !== 'select' || this.selection.length === 0) return;
    const { widthUnits } = this.host.module();
    const chosen = this.selection.map((i) => art[i]).filter((s): s is ArtShape => s !== undefined);
    for (const shape of chosen) {
      for (const { shape: placed } of placeArtFrom([shape], widthUnits, widthUnits)) {
        const outline =
          placed.kind === 'text'
            ? this.textOutline(placed, scale)
            : shapeElement({ ...placed, fill: 'none', stroke: SELECTION_COLOUR, strokeWidth: Math.max(placed.strokeWidth ?? 0.5, 1.5 / scale) } as PlacedShape, scale);
        outline.setAttribute('pointer-events', 'none');
        face.append(outline);
      }
    }
    if (chosen.length > 1) {
      const boxes = chosen.map(boundsOf);
      const box: Box = { x1: Math.min(...boxes.map((b) => b.x1)), y1: Math.min(...boxes.map((b) => b.y1)), x2: Math.max(...boxes.map((b) => b.x2)), y2: Math.max(...boxes.map((b) => b.y2)) };
      face.append(svgElement('rect', { x: box.x1 * scale, y: box.y1 * scale, width: (box.x2 - box.x1) * scale, height: (box.y2 - box.y1) * scale, fill: 'none', stroke: SELECTION_COLOUR, 'stroke-dasharray': '6 3', 'pointer-events': 'none' }));
      return;
    }
    for (const handle of handlesOf(chosen[0]!)) {
      face.append(svgElement('rect', { x: handle.x * scale - HANDLE_RADIUS_PX, y: handle.y * scale - HANDLE_RADIUS_PX, width: 2 * HANDLE_RADIUS_PX, height: 2 * HANDLE_RADIUS_PX, fill: '#14161d', stroke: SELECTION_COLOUR, 'stroke-width': 1.5, 'data-handle': handle.id, cursor: 'pointer' }));
    }
  }

  private textOutline(shape: Extract<PlacedShape, { kind: 'text' }>, scale: number): SVGElement {
    const box = textBox(shape);
    return svgElement('rect', {
      x: box.x1 * scale,
      y: box.y1 * scale,
      width: (box.x2 - box.x1) * scale,
      height: (box.y2 - box.y1) * scale,
      fill: 'none',
      stroke: SELECTION_COLOUR,
      'stroke-dasharray': '3 3',
      ...(shape.rotation ? { transform: `rotate(${shape.rotation} ${shape.x * scale} ${shape.y * scale})` } : {}),
    });
  }

  private renderSide(): void {
    this.layers.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = this.art.length === 0 ? 'No shapes on the face' : `Shapes, bottom to top (${this.art.length})`;
    this.layers.append(heading);
    this.art.forEach((shape, i) => {
      const row = button(describe(shape, i), () => undefined);
      row.className = `face-layer${this.selection.includes(i) ? ' selected' : ''}`;
      row.addEventListener('click', (e) => this.pick(i, e.shiftKey || e.ctrlKey || e.metaKey));
      this.layers.append(row);
    });
    this.layerBar.replaceChildren();
    this.alignBar.replaceChildren();
    const index = this.single;
    const shape = index === undefined ? undefined : this.art[index];
    const module = this.host.module();
    if (this.selection.length > 0) this.fillActions(module, index, shape);
    this.fields.render(
      shape && index !== undefined ? { title: `Shape ${index + 1}`, fields: shapeFields(shape), actions: [] } : { title: this.selection.length > 1 ? `${this.selection.length} shapes selected` : 'No shape selected', fields: [], actions: [] },
    );
  }

  private fillActions(module: ModuleDef, index: number | undefined, shape: ArtShape | undefined): void {
    const draft = () => this.host.draft();
    const id = module.id;
    const chosen = this.chosen;
    const bar = this.layerBar;
    if (index !== undefined && shape) {
      for (const [layer, label, title] of LAYER_BUTTONS) bar.append(button(label, () => this.apply(moveLayer(draft(), id, index, layer)), title));
      bar.append(button('Turn right', () => this.changeShape(index, turnShape(shape, 1), ''), 'Turn the shape a quarter turn clockwise about its middle'));
      bar.append(button('Turn left', () => this.changeShape(index, turnShape(shape, 3), ''), 'Turn the shape a quarter turn anticlockwise about its middle'));
      bar.append(button('Turn 180°', () => this.changeShape(index, turnShape(shape, 2), ''), 'Turn the shape half a turn about its middle'));
      bar.append(button('Flip horizontally', () => this.changeShape(index, flipShape(shape, 'horizontal'), 'A text cannot be flipped, only turned.'), 'Reflect the shape left to right about its middle'));
      bar.append(button('Flip vertically', () => this.changeShape(index, flipShape(shape, 'vertical'), 'A text cannot be flipped, only turned.'), 'Reflect the shape top to bottom about its middle'));
    } else {
      bar.append(button('Turn right', () => this.changeChosen(turnShapes(chosen, 1)), 'Turn the shapes together a quarter turn clockwise'));
      bar.append(button('Turn left', () => this.changeChosen(turnShapes(chosen, 3)), 'Turn the shapes together a quarter turn anticlockwise'));
      bar.append(button('Turn 180°', () => this.changeChosen(turnShapes(chosen, 2)), 'Turn the shapes together half a turn'));
      bar.append(button('Flip horizontally', () => this.changeChosen(flipShapes(chosen, 'horizontal')), 'Reflect the shapes together, left to right'));
      bar.append(button('Flip vertically', () => this.changeChosen(flipShapes(chosen, 'vertical')), 'Reflect the shapes together, top to bottom'));
    }
    bar.append(this.turnInput);
    bar.append(
      button('Turn by °', () => {
        const degrees = Number(this.turnInput.value);
        if (!Number.isFinite(degrees) || degrees === 0) return this.host.say('Give the degrees to turn by, clockwise.', true);
        const about = chosen.length > 1 ? groupCentre(chosen) : undefined;
        this.changeChosen(chosen.map((s) => rotateShapeBy(s, degrees, about)));
      }, 'Turn by any angle, clockwise; a rectangle or an ellipse becomes the path of its outline'),
    );
    bar.append(button('Duplicate', () => this.apply(duplicateShapes(draft(), id, this.selection), this.selection.length)));
    bar.append(button('Copy', () => this.copySelection()));
    bar.append(button('Delete', () => this.apply(removeShapes(draft(), id, this.selection))));
    if (shape?.kind === 'polyline' && index !== undefined) {
      bar.append(button('Add point', () => this.changeShape(index, addVertex(shape), 'A polyline has at most 64 points.')));
      bar.append(button('Remove last point', () => this.changeShape(index, removeVertex(shape, shape.points.length - 1), 'A polyline needs two points.')));
    }

    const label = document.createElement('span');
    label.className = 'face-align-label';
    label.textContent = chosen.length > 1 ? 'Align to each other' : 'Align on the face';
    this.alignBar.append(label);
    const face: Box = { x1: 0, y1: 0, x2: module.widthUnits * MODULE_UNIT_MM, y2: FACE_HEIGHT_MM };
    for (const [how, name] of ALIGN_BUTTONS) {
      this.alignBar.append(button(name, () => this.changeChosen(alignShapes(chosen, how, chosen.length > 1 ? undefined : face)), `Line the shapes up on ${how}`));
    }
    if (chosen.length >= 3) {
      this.alignBar.append(button('Spread across', () => this.changeChosen(distributeShapes(chosen, 'horizontal')), 'Make the gaps between the shapes equal, from left to right'));
      this.alignBar.append(button('Spread down', () => this.changeChosen(distributeShapes(chosen, 'vertical')), 'Make the gaps between the shapes equal, from top to bottom'));
    }
  }

  private importSvg(): void {
    openSvgImportDialog({
      module: this.host.module(),
      openDialog: (dialog) => this.host.openDialog(dialog),
      accept: (shapes) => {
        this.tool = 'select';
        this.apply(addShapes(this.host.draft(), this.host.module().id, shapes), shapes.length);
        this.host.say(`${shapes.length} shape${shapes.length === 1 ? '' : 's'} imported.`);
      },
    });
  }

  private copySelection(): void {
    if (this.selection.length === 0) return this.host.say('Select the shapes to copy first.', true);
    const count = copyShapes(this.chosen);
    this.host.say(`${count} shape${count === 1 ? '' : 's'} copied; Paste puts them on this or another module.`);
    this.render();
  }

  private paste(): void {
    const count = copiedShapeCount();
    this.apply(pasteShapes(this.host.draft(), this.host.module().id), count);
  }

  /** Selects a shape, or adds it to or takes it out of the selection. */
  private pick(index: number, additive: boolean): void {
    this.tool = 'select';
    if (!additive) this.selection = [index];
    else this.selection = this.selection.includes(index) ? this.selection.filter((i) => i !== index) : [...this.selection, index].sort((a, b) => a - b);
    this.render();
  }

  /**
   * Records the draft a model function made. What is selected afterwards is `keep` when it is given,
   * else the `count` shapes from the index the result says, which is where added shapes stand.
   */
  private apply(result: ArtResult, count = 1, keep?: number[]): void {
    if (!result.ok) return this.host.say(result.message, true);
    this.selection = keep ?? (result.index >= 0 ? Array.from({ length: count }, (_, k) => result.index + k) : []);
    this.host.commit(result.draft);
  }

  private changeShape(index: number, shape: ArtShape | undefined, refusal: string): void {
    if (!shape) return this.host.say(refusal, true);
    this.apply(replaceShape(this.host.draft(), this.host.module().id, index, shape), 1, this.selection);
  }

  /** Replaces the selected shapes with these, one for one, as a single step. */
  private changeChosen(shapes: ArtShape[]): void {
    const kept = this.selection;
    this.apply(replaceShapes(this.host.draft(), this.host.module().id, new Map(kept.map((index, k) => [index, shapes[k]!]))), 1, kept);
  }

  private edit(key: string, raw: string): void {
    const index = this.single;
    const shape = index === undefined ? undefined : this.art[index];
    if (!shape || index === undefined) return;
    const result = applyShapeEdit(shape, key, raw);
    if (!result.ok) {
      this.host.say(result.message, true);
      return this.render();
    }
    this.changeShape(index, result.shape, '');
  }

  private point(e: PointerEvent): Point {
    const rect = this.svg!.getBoundingClientRect();
    const margin = 12;
    return { x: ((e.clientX - rect.left) * (this.svg!.width.baseVal.value / rect.width) - margin) / this.scale, y: ((e.clientY - rect.top) * (this.svg!.height.baseVal.value / rect.height) - margin) / this.scale };
  }

  private snapped(p: Point): Point {
    return { x: snapMm(p.x), y: snapMm(p.y) };
  }

  private onPointerDown(e: PointerEvent): void {
    const at = this.point(e);
    const tolerance = HIT_TOLERANCE_PX / this.scale;
    if (this.tool === 'polyline') {
      this.points = [...this.points, [snapMm(at.x), snapMm(at.y)]];
      return this.render();
    }
    if (this.tool === 'text') {
      const shape = createShape('text', this.snapped(at), this.snapped(at));
      if (shape) this.apply(addShape(this.host.draft(), this.host.module().id, shape));
      this.tool = 'select';
      return;
    }
    if (this.tool !== 'select') {
      this.gesture = { kind: 'create', tool: this.tool, from: this.snapped(at), to: this.snapped(at) };
      this.listen();
      return;
    }
    const handleId = (e.target as Element).getAttribute?.('data-handle');
    const index = this.single;
    if (index !== undefined && handleId) {
      const original = this.art[index]!;
      this.gesture = { kind: 'handle', index, id: handleId, original, current: original };
      this.listen();
      return;
    }
    const module = this.host.module();
    const hit = shapeAt(placeArtFrom(this.art, module.widthUnits, module.widthUnits), at, tolerance);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (hit === undefined) {
      this.gesture = { kind: 'band', from: at, to: at, additive };
      this.listen();
      return;
    }
    if (additive) return this.pick(hit, true);
    if (!this.selection.includes(hit)) this.selection = [hit];
    const originals = new Map(this.selection.map((i) => [i, this.art[i]!] as const));
    this.gesture = { kind: 'move', from: at, originals, moved: false, current: new Map(originals) };
    this.listen();
    this.renderSide();
    this.drawStage(module);
  }

  private readonly moveListener = (e: PointerEvent) => this.onPointerMove(e);
  private readonly upListener = (e: PointerEvent) => {
    window.removeEventListener('pointermove', this.moveListener);
    window.removeEventListener('pointerup', this.upListener);
    this.onPointerUp(e);
  };

  /** A gesture goes on while the pointer is anywhere, and the drawing under it is made again at every step. */
  private listen(): void {
    window.addEventListener('pointermove', this.moveListener);
    window.addEventListener('pointerup', this.upListener);
  }

  private onPointerMove(e: PointerEvent): void {
    const at = this.point(e);
    this.cursor = this.snapped(at);
    const gesture = this.gesture;
    if (!gesture) {
      if (this.tool === 'polyline' && this.points.length > 0) this.drawStage(this.host.module());
      return;
    }
    if (gesture.kind === 'create') {
      gesture.to = this.snapped(at);
    } else if (gesture.kind === 'band') {
      gesture.to = at;
    } else if (gesture.kind === 'move') {
      const farEnough = Math.hypot(at.x - gesture.from.x, at.y - gesture.from.y) * this.scale >= DRAG_THRESHOLD_PX;
      if (!gesture.moved && !farEnough) return;
      gesture.moved = true;
      const [dx, dy] = [snapMm(at.x - gesture.from.x), snapMm(at.y - gesture.from.y)];
      gesture.current = new Map([...gesture.originals].map(([i, shape]) => [i, translate(shape, dx, dy)] as const));
    } else {
      gesture.current = dragHandle(gesture.original, gesture.id, this.snapped(at));
    }
    this.drawStage(this.host.module());
  }

  private onPointerUp(e: PointerEvent): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture) return;
    if (gesture.kind === 'create') {
      const shape = createShape(gesture.tool, gesture.from, this.snapped(this.point(e)));
      this.tool = 'select';
      if (shape) return this.apply(addShape(this.host.draft(), this.host.module().id, shape));
      return this.render();
    }
    if (gesture.kind === 'band') return this.finishBand(gesture, this.point(e));
    if (gesture.kind === 'move') {
      if (!gesture.moved) return this.render();
      this.apply(replaceShapes(this.host.draft(), this.host.module().id, gesture.current), 1, this.selection);
      return;
    }
    this.changeShape(gesture.index, gesture.current, '');
  }

  private finishBand(band: Extract<Gesture, { kind: 'band' }>, to: Point): void {
    const far = Math.hypot(to.x - band.from.x, to.y - band.from.y) * this.scale >= DRAG_THRESHOLD_PX;
    if (!far) {
      if (!band.additive) this.selection = [];
      return this.render();
    }
    const module = this.host.module();
    const box: Box = { x1: Math.min(band.from.x, to.x), y1: Math.min(band.from.y, to.y), x2: Math.max(band.from.x, to.x), y2: Math.max(band.from.y, to.y) };
    const inside = shapesInBox(placeArtFrom(this.art, module.widthUnits, module.widthUnits), box);
    this.selection = band.additive ? [...new Set([...this.selection, ...inside])].sort((a, b) => a - b) : inside;
    this.render();
  }

  private finishPolyline(): void {
    if (this.tool !== 'polyline') return;
    const shape = polylineThrough(this.points);
    this.points = [];
    this.tool = 'select';
    if (!shape) return this.render();
    this.apply(addShape(this.host.draft(), this.host.module().id, shape));
  }

  /** Handles a key while the face is shown; says whether it was used. */
  onKey(e: KeyboardEvent): boolean {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);
    if (typing) return false;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyA') {
      e.preventDefault();
      this.selection = this.art.map((_, i) => i);
      this.render();
      return true;
    }
    if (mod && e.code === 'KeyC') {
      e.preventDefault();
      this.copySelection();
      return true;
    }
    if (mod && e.code === 'KeyV') {
      e.preventDefault();
      this.paste();
      return true;
    }
    if (e.key === 'Escape' && (this.points.length > 0 || this.tool !== 'select')) {
      e.preventDefault();
      e.stopPropagation();
      this.setTool('select');
      return true;
    }
    if (e.key === 'Escape' && this.selection.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      this.selection = [];
      this.render();
      return true;
    }
    if (e.key === 'Enter' && this.tool === 'polyline') {
      e.preventDefault();
      this.finishPolyline();
      return true;
    }
    if (this.selection.length === 0) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.apply(removeShapes(this.host.draft(), this.host.module().id, this.selection));
      return true;
    }
    const step = e.shiftKey ? 5 : 0.5;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const by = nudge[e.key];
    if (!by) return false;
    e.preventDefault();
    this.changeChosen(this.chosen.map((s) => translate(s, by[0], by[1])));
    return true;
  }
}
