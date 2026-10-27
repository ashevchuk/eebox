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
  addVertex,
  applyShapeEdit,
  boundsOf,
  createShape,
  dragHandle,
  duplicateShape,
  handlesOf,
  moveLayer,
  polylineThrough,
  removeShape,
  removeVertex,
  replaceShape,
  shapeAt,
  shapeFields,
  snapMm,
  translate,
  type ArtResult,
  type ArtTool,
  type Layer,
  type Point,
} from './artEditor';
import { FieldsView } from './fieldsView';

/** What the face editor needs from the designer around it. */
export interface ArtEditorHost {
  draft(): Library;
  module(): ModuleDef;
  /** Records a new draft in the history of the designer, once for each gesture. */
  commit(draft: Library): void;
  say(message: string, isError?: boolean): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SCALE_PX_PER_MM = 4;
const STAGE_WIDTH_PX = 540;
const STAGE_HEIGHT_PX = 380;
const HIT_TOLERANCE_PX = 5;
const HANDLE_RADIUS_PX = 4.5;
const DRAG_THRESHOLD_PX = 3;
const SELECTION_COLOUR = '#f5c518';
const BAND_MM = 14;
const TOOL_LABELS: Record<ArtTool, string> = { select: 'Select', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', polyline: 'Polyline', text: 'Text' };
const TOOL_HINTS: Record<ArtTool, string> = {
  select: 'Click a shape to select it, drag it to move it, pull its handles to resize it. Delete removes it, the arrow keys nudge it.',
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

type Gesture =
  | { kind: 'create'; tool: Exclude<ArtTool, 'select' | 'polyline' | 'text'>; from: Point; to: Point }
  | { kind: 'move'; index: number; from: Point; original: ArtShape; moved: boolean; current: ArtShape }
  | { kind: 'handle'; index: number; id: string; original: ArtShape; current: ArtShape };

/** The shape as SVG, in pixels at `scale` pixels to the millimetre. */
function shapeElement(shape: PlacedShape, scale: number): SVGElement {
  const paint = {
    fill: shape.fill ?? 'none',
    stroke: shape.kind === 'text' ? 'none' : (shape.stroke ?? 'none'),
    'stroke-width': (shape.strokeWidth ?? 0.5) * scale,
    'stroke-linejoin': 'round',
  };
  switch (shape.kind) {
    case 'line':
      return svgElement('line', { x1: shape.x1 * scale, y1: shape.y1 * scale, x2: shape.x2 * scale, y2: shape.y2 * scale, ...paint, fill: 'none' });
    case 'rect':
      return svgElement('rect', { x: shape.x * scale, y: shape.y * scale, width: shape.width * scale, height: shape.height * scale, ...paint });
    case 'ellipse':
      return svgElement('ellipse', { cx: shape.cx * scale, cy: shape.cy * scale, rx: shape.rx * scale, ry: shape.ry * scale, ...paint });
    case 'polyline':
      return svgElement(shape.closed ? 'polygon' : 'polyline', { points: shape.points.map(([x, y]) => `${x * scale},${y * scale}`).join(' '), ...paint });
    case 'text':
      return svgElement(
        'text',
        {
          x: shape.x * scale,
          y: shape.y * scale,
          'font-size': shape.size * scale,
          'font-family': FONT_FAMILY,
          'font-weight': shape.bold ? 'bold' : 'normal',
          'text-anchor': { left: 'start', centre: 'middle', right: 'end' }[shape.align ?? 'left'],
          'dominant-baseline': 'central',
          fill: shape.fill ?? '#000000',
        },
        shape.text,
      );
  }
}

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
  private readonly fields: FieldsView;
  private readonly toolButtons = new Map<ArtTool, HTMLButtonElement>();
  private tool: ArtTool = 'select';
  private selected: number | null = null;
  private gesture: Gesture | null = null;
  private points: Array<[number, number]> = [];
  private cursor: Point | null = null;
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
    this.toolbar.append(button('Finish line', () => this.finishPolyline(), 'Make the polyline from the points clicked so far'));
    this.hint.className = 'designer-hint';
    this.stage.append(this.toolbar, this.svgHost, this.hint);

    this.layers.className = 'face-layers';
    this.layerBar.className = 'inspector-actions first';
    const propertiesHost = document.createElement('div');
    this.fields = new FieldsView(propertiesHost, {
      onEdit: (key, raw) => this.edit(key, typeof raw === 'string' ? raw : raw.join(' ')),
      onAction: () => undefined,
    });
    this.side.append(this.layers, this.layerBar, propertiesHost);
  }

  /** Goes back to the select tool with nothing selected, as when the face is opened. */
  reset(): void {
    this.tool = 'select';
    this.selected = null;
    this.gesture = null;
    this.points = [];
  }

  private get art(): ArtShape[] {
    return this.host.module().art ?? [];
  }

  private setTool(tool: ArtTool): void {
    this.tool = tool;
    this.points = [];
    this.gesture = null;
    this.render();
  }

  render(): void {
    const module = this.host.module();
    if (this.selected !== null && this.selected >= this.art.length) this.selected = this.art.length > 0 ? this.art.length - 1 : null;
    for (const [tool, el] of this.toolButtons) el.classList.toggle('active', tool === this.tool);
    this.hint.textContent = `${TOOL_HINTS[this.tool]} Edited at ${module.widthUnits} unit${module.widthUnits === 1 ? '' : 's'}, the width the module is made for; the rail below shows the other widths.`;
    this.drawStage(module);
    this.renderSide();
  }

  /** Draws the face with what is being dragged in place of the shape it started from. */
  private drawStage(module: ModuleDef): void {
    const widthMm = module.widthUnits * MODULE_UNIT_MM;
    const scale = Math.min(MAX_SCALE_PX_PER_MM, STAGE_WIDTH_PX / widthMm, STAGE_HEIGHT_PX / FACE_HEIGHT_MM);
    this.scale = scale;
    const margin = 12;
    const svg = svgElement('svg', { width: widthMm * scale + 2 * margin, height: FACE_HEIGHT_MM * scale + 2 * margin, class: 'designer-svg' }) as SVGSVGElement;
    const face = svgElement('g', { transform: `translate(${margin} ${margin})` });
    svg.append(face);
    face.append(svgElement('rect', { x: 0, y: 0, width: widthMm * scale, height: FACE_HEIGHT_MM * scale, fill: '#e5e7eb', stroke: '#6b7280' }));
    face.append(svgElement('rect', { x: 0, y: 0, width: widthMm * scale, height: BAND_MM * scale, fill: LEVER_COLORS[module.kind] }));
    for (let unit = 1; unit < module.widthUnits; unit++) {
      const x = unit * MODULE_UNIT_MM * scale;
      face.append(svgElement('line', { x1: x, y1: 0, x2: x, y2: FACE_HEIGHT_MM * scale, stroke: '#9ca3af', 'stroke-dasharray': '3 4' }));
    }

    const art = this.art.map((shape, i) => (this.gesture && 'index' in this.gesture && this.gesture.index === i ? this.gesture.current : shape));
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
    face.append(svgElement('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 6 * scale, 'font-family': FONT_FAMILY, fill: '#14161d', opacity: 0.35, transform: `rotate(-90 ${cx} ${cy})`, 'pointer-events': 'none' }, module.name));
  }

  private drawInProgress(face: SVGElement, scale: number): void {
    if (this.tool !== 'polyline' || this.points.length === 0) return;
    const through = [...this.points, ...(this.cursor ? [[this.cursor.x, this.cursor.y] as [number, number]] : [])];
    face.append(svgElement('polyline', { points: through.map(([x, y]) => `${x * scale},${y * scale}`).join(' '), fill: 'none', stroke: SELECTION_COLOUR, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
    for (const [x, y] of this.points) face.append(svgElement('circle', { cx: x * scale, cy: y * scale, r: 3, fill: SELECTION_COLOUR, 'pointer-events': 'none' }));
  }

  private drawSelection(face: SVGElement, art: ArtShape[], scale: number): void {
    const shape = this.selected === null ? undefined : art[this.selected];
    if (!shape || this.tool !== 'select') return;
    const { widthUnits } = this.host.module();
    for (const { shape: placed } of placeArtFrom([shape], widthUnits, widthUnits)) {
      const box = boundsOf(placed);
      const outline =
        placed.kind === 'text'
          ? svgElement('rect', { x: box.x1 * scale, y: box.y1 * scale, width: (box.x2 - box.x1) * scale, height: (box.y2 - box.y1) * scale, fill: 'none', stroke: SELECTION_COLOUR, 'stroke-dasharray': '3 3' })
          : shapeElement({ ...placed, fill: 'none', stroke: SELECTION_COLOUR, strokeWidth: Math.max(placed.strokeWidth ?? 0.5, 1.5 / scale) } as PlacedShape, scale);
      outline.setAttribute('pointer-events', 'none');
      face.append(outline);
    }
    for (const handle of handlesOf(shape)) {
      face.append(svgElement('rect', { x: handle.x * scale - HANDLE_RADIUS_PX, y: handle.y * scale - HANDLE_RADIUS_PX, width: 2 * HANDLE_RADIUS_PX, height: 2 * HANDLE_RADIUS_PX, fill: '#14161d', stroke: SELECTION_COLOUR, 'stroke-width': 1.5, 'data-handle': handle.id, cursor: 'pointer' }));
    }
  }

  private renderSide(): void {
    this.layers.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = this.art.length === 0 ? 'No shapes on the face' : `Shapes, bottom to top (${this.art.length})`;
    this.layers.append(heading);
    this.art.forEach((shape, i) => {
      const row = button(describe(shape, i), () => this.select(i));
      row.className = `face-layer${i === this.selected ? ' selected' : ''}`;
      this.layers.append(row);
    });
    this.layerBar.replaceChildren();
    const shape = this.selected === null ? undefined : this.art[this.selected];
    if (shape && this.selected !== null) {
      const index = this.selected;
      for (const [layer, label, title] of LAYER_BUTTONS) this.layerBar.append(button(label, () => this.apply(moveLayer(this.host.draft(), this.host.module().id, index, layer)), title));
      this.layerBar.append(button('Duplicate', () => this.apply(duplicateShape(this.host.draft(), this.host.module().id, index))));
      this.layerBar.append(button('Delete', () => this.apply(removeShape(this.host.draft(), this.host.module().id, index))));
      if (shape.kind === 'polyline') {
        this.layerBar.append(button('Add point', () => this.changeShape(index, addVertex(shape), 'A polyline has at most 64 points.')));
        this.layerBar.append(button('Remove last point', () => this.changeShape(index, removeVertex(shape, shape.points.length - 1), 'A polyline needs two points.')));
      }
    }
    this.fields.render(shape ? { title: `Shape ${(this.selected ?? 0) + 1}`, fields: shapeFields(shape), actions: [] } : { title: 'No shape selected', fields: [], actions: [] });
  }

  private select(index: number | null): void {
    this.selected = index;
    this.tool = 'select';
    this.render();
  }

  /** Records the draft a model function made, and selects the shape it says. */
  private apply(result: ArtResult): void {
    if (!result.ok) return this.host.say(result.message, true);
    this.selected = result.index >= 0 ? result.index : null;
    this.host.commit(result.draft);
  }

  private changeShape(index: number, shape: ArtShape | undefined, refusal: string): void {
    if (!shape) return this.host.say(refusal, true);
    this.apply(replaceShape(this.host.draft(), this.host.module().id, index, shape));
  }

  private edit(key: string, raw: string): void {
    const shape = this.selected === null ? undefined : this.art[this.selected];
    if (!shape || this.selected === null) return;
    const result = applyShapeEdit(shape, key, raw);
    if (!result.ok) {
      this.host.say(result.message, true);
      return this.render();
    }
    this.apply(replaceShape(this.host.draft(), this.host.module().id, this.selected, result.shape));
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
    const shape = this.selected === null ? undefined : this.art[this.selected];
    const handleId = (e.target as Element).getAttribute?.('data-handle');
    if (shape && this.selected !== null && handleId) {
      this.gesture = { kind: 'handle', index: this.selected, id: handleId, original: shape, current: shape };
      this.listen();
      return;
    }
    const module = this.host.module();
    const hit = shapeAt(placeArtFrom(this.art, module.widthUnits, module.widthUnits), at, tolerance);
    if (hit === undefined) {
      this.selected = null;
      return this.render();
    }
    this.selected = hit;
    this.gesture = { kind: 'move', index: hit, from: at, original: this.art[hit]!, moved: false, current: this.art[hit]! };
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
    } else if (gesture.kind === 'move') {
      const farEnough = Math.hypot(at.x - gesture.from.x, at.y - gesture.from.y) * this.scale >= DRAG_THRESHOLD_PX;
      if (!gesture.moved && !farEnough) return;
      gesture.moved = true;
      gesture.current = translate(gesture.original, snapMm(at.x - gesture.from.x), snapMm(at.y - gesture.from.y));
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
    if (gesture.kind === 'move' && !gesture.moved) return this.render();
    this.apply(replaceShape(this.host.draft(), this.host.module().id, gesture.index, gesture.current));
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
    if (e.key === 'Escape' && (this.points.length > 0 || this.tool !== 'select')) {
      e.preventDefault();
      e.stopPropagation();
      this.setTool('select');
      return true;
    }
    if (e.key === 'Enter' && this.tool === 'polyline') {
      e.preventDefault();
      this.finishPolyline();
      return true;
    }
    const shape = this.selected === null ? undefined : this.art[this.selected];
    if (!shape || this.selected === null) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.apply(removeShape(this.host.draft(), this.host.module().id, this.selected));
      return true;
    }
    const step = e.shiftKey ? 5 : 0.5;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const by = nudge[e.key];
    if (!by) return false;
    e.preventDefault();
    this.apply(replaceShape(this.host.draft(), this.host.module().id, this.selected, translate(shape, by[0], by[1])));
    return true;
  }
}
