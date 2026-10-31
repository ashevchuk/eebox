import { drawArt } from './art';
import { FONT_FAMILY } from './font';
import { drawConductorDot } from './conductorDraw';
import { describeMeasurement, measurement, type RulerLine } from './ruler';
import { wrapText } from './textFit';
import { terminalsOf } from '../electrical/terminals';
import { DIN_MODULE_HEIGHT_MM, MODULE_UNIT_MM, type Conductor, type ModuleDef, type ModuleKind } from '../library/types';
import { lookupsOf } from '../layout/lookups';
import type { ModuleRef, Panel, Sizes } from '../layout/placement';
import type { Camera } from './Camera';
import { theme } from './theme';
import type { Annotation } from '../layout/annotations';
import { stampParts } from '../layout/info';
import { t } from '../i18n';
import { drawAnnotations } from './annotationDraw';
import { ALL_TEXT, type TextVisibility } from './textVisibility';
import { COMB_HEIGHT, FRAME_PADDING, combRect, ductRect, frameRect, moduleRect, placementLabelRoom, placementRect, railRect, rowLabelX, type Rect } from './geometry';
import { ductsOf, type Duct } from '../layout/ducts';
import type { Guide } from './snap';
import type { Dimension } from './dimensions';

export interface Ghost {
  module: ModuleDef;
  /** Width of the item being dragged: a resized copy keeps its own width. */
  widthUnits: number;
  valid: boolean;
  /** Where it would stand on a rail, or ... */
  rail?: number;
  slot?: number;
  /** ... where it would stand on the plate, in mm from the top-left of the working area. */
  x?: number;
  y?: number;
}

export interface Scene {
  panel: Panel;
  resolve: (ref: ModuleRef) => ModuleDef | undefined;
  selectedPlacementId: string | null;
  selectedCombId: string | null;
  /** Items selected together as a group, instead of the two above. */
  selectedIds?: ReadonlySet<string>;
  /** Placed modules to mark: outlined in red for a fault, in amber for advice. */
  marked?: ReadonlyMap<string, 'error' | 'advice'>;
  selectedRail: number | null;
  /** The placement or comb being dragged; drawn dimmed at its old position. */
  moving: { kind: 'placement' | 'comb' | 'duct'; id: string } | null;
  ghost: Ghost | null;
  /** A rubber band being dragged to select several items, in world coordinates. */
  band?: Rect | null;
  /** What the ruler has measured, in world coordinates. */
  ruler?: RulerLine | null;
  /** Draws only the rails and what stands on them, without the frame and its title, as a full-size print needs. */
  bare?: boolean;
  /** The notes to draw when they are not those of the panel, such as while one is dragged. */
  annotations?: readonly Annotation[];
  /** The note that is selected, if the selection is a note. */
  selectedAnnotationId?: string | null;
  /** The kinds of text to draw; all of them when absent. */
  texts?: TextVisibility;
  /** The name of the plate, written after the title when the panel has several. */
  plateName?: string;
  /** Lines a dragged item is drawn to, in world coordinates; only while dragging. */
  guides?: readonly Guide[];
  /** A cable duct being drawn, before it is made. */
  draftDuct?: Rect | null;
  /** Distances from the selected thing to its neighbours; shown on the screen only. */
  dimensions?: readonly Dimension[];
  /** The grid devices on the plate are drawn to, in mm; 0 or absent for none. Shown on the screen only. */
  gridMm?: number;
}

/** A grid line closer than this on the screen would only be a grey wash. */
const MIN_GRID_PX = 6;

function drawGrid(ctx: CanvasRenderingContext2D, frame: Rect, gridMm: number, scale: number): void {
  if (gridMm <= 0 || gridMm * scale < MIN_GRID_PX) return;
  const inner = { x: FRAME_PADDING, y: FRAME_PADDING, width: frame.width - 2 * FRAME_PADDING, height: frame.height - 2 * FRAME_PADDING };
  ctx.save();
  ctx.strokeStyle = theme().frame;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  for (let x = inner.x; x <= inner.x + inner.width + 1e-6; x += gridMm) {
    ctx.moveTo(x, inner.y);
    ctx.lineTo(x, inner.y + inner.height);
  }
  for (let y = inner.y; y <= inner.y + inner.height + 1e-6; y += gridMm) {
    ctx.moveTo(inner.x, y);
    ctx.lineTo(inner.x + inner.width, y);
  }
  ctx.stroke();
  ctx.restore();
}

export const LEVER_COLORS: Record<ModuleKind, string> = {
  breaker: '#2563eb',
  rcd: '#16a34a',
  rcbo: '#0d9488',
  contactor: '#9333ea',
  spd: '#dc2626',
  meter: '#475569',
  psu: '#ca8a04',
  terminal: '#78716c',
  busbar: '#78716c',
  comb: '#334155',
  switch: '#ea580c',
  relay: '#7c3aed',
  softstarter: '#0e7490',
  vfd: '#0369a1',
  plc: '#15803d',
  transformer: '#a16207',
  other: '#64748b',
};

const PIN_RADIUS = 2.4;
const PIN_SPACING = 5;

const COLORS = {
  rail: '#9aa1b3',
  body: '#e5e7eb',
  text: '#14161d',
  missing: '#7f1d1d',
  selection: '#f5c518',
  ghostOk: 'rgba(34, 197, 94, 0.55)',
  ghostBad: 'rgba(239, 68, 68, 0.55)',
  duct: '#475569',
  ductSlot: '#334155',
  ductText: '#e2e8f0',
  guide: '#e879f9',
  dimension: '#38bdf8',
};

function fillRect(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.width, r.height);
}

/** Narrower than this a module has no room for its rating or its name, and the clipped pieces of letters only make a mess. */
const MIN_RATING_WIDTH_MM = 12;
const MIN_NAME_WIDTH_MM = 8;
/** The name runs between the rating at the top and the terminals at the bottom. */
const NAME_TOP_MM = 28;
const NAME_BOTTOM_MM = 20;
const NAME_MAX_LINES = 3;
const NAME_LINE_SPACING_MM = 7.5;

function drawLabel(ctx: CanvasRenderingContext2D, def: ModuleDef, r: Rect, texts: TextVisibility): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rating = def.ratedCurrentA === undefined ? '' : `${def.curve ?? ''}${def.ratedCurrentA}`;
  if (texts.ratings && rating && r.width >= MIN_RATING_WIDTH_MM) {
    ctx.font = `bold 8px ${FONT_FAMILY}`;
    ctx.fillText(rating, r.x + r.width / 2, r.y + 22);
  }
  if (texts.moduleNames && r.width >= MIN_NAME_WIDTH_MM) {
    const room = r.height - NAME_TOP_MM - NAME_BOTTOM_MM;
    ctx.translate(r.x + r.width / 2, r.y + NAME_TOP_MM + room / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `6px ${FONT_FAMILY}`;
    const lines = wrapText((text) => ctx.measureText(text).width, def.shortName ?? def.name, room, Math.min(NAME_MAX_LINES, Math.max(1, Math.floor(r.width / NAME_LINE_SPACING_MM / 1.6))));
    lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * NAME_LINE_SPACING_MM));
  }
  ctx.restore();
}

const sizesOf = (scene: Scene) => lookupsOf(scene.resolve).sizes;

const itemWidth = (scene: Scene, item: { module: ModuleRef; widthUnits?: number }): number =>
  item.widthUnits ?? scene.resolve(item.module)?.widthUnits ?? 1;

const LABEL_FONT = `8px ${FONT_FAMILY}`;
const ROW_LABEL_MAX_LENGTH = 110;

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
}

/** Text that reads upwards and ends at the given point, so it runs below it: the usual way DIN labels are printed. */
function drawUpwardsLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxLength: number,
  align: CanvasTextAlign,
  color: string,
): void {
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(fitText(ctx, text, maxLength), 0, 0);
  ctx.restore();
}

function drawLabels(ctx: CanvasRenderingContext2D, scene: Scene, texts: TextVisibility): void {
  const { panel } = scene;
  panel.rails.forEach(({ label }, rail) => {
    if (!label || !texts.rowLabels) return;
    const r = railRect(panel, rail);
    drawUpwardsLabel(ctx, label, rowLabelX(panel, rail), r.y + r.height / 2, ROW_LABEL_MAX_LENGTH, 'center', theme().rowLabel);
  });
  for (const placement of panel.placements) {
    if (!placement.label || !texts.moduleLabels) continue;
    const r = placementRect(panel, sizesOf(scene), placement);
    drawUpwardsLabel(ctx, placement.label, r.x + r.width / 2, r.y + r.height + 4, placementLabelRoom(panel, placement, r), 'right', theme().label);
  }
  ctx.font = LABEL_FONT;
  ctx.fillStyle = theme().label;
  ctx.textAlign = 'left';
  for (const comb of panel.combs) {
    const def = scene.resolve(comb.module);
    if (!comb.label || !texts.combLabels || !def?.comb) continue;
    const r = combRect(panel, sizesOf(scene), comb.rail, comb.slot, itemWidth(scene, comb), def.comb.side);
    ctx.textBaseline = def.comb.side === 'top' ? 'bottom' : 'top';
    ctx.fillText(fitText(ctx, comb.label, r.width), r.x + 2, def.comb.side === 'top' ? r.y - 3 : r.y + r.height + 3);
  }
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, conductor: Conductor): void {
  drawConductorDot(ctx, x, y, PIN_RADIUS, conductor, 0.6);
}

/** Screw terminals of a module: dots in the colour of their conductor, sharing a unit side by side. */
function drawTerminals(ctx: CanvasRenderingContext2D, def: ModuleDef, r: Rect, widthUnits: number): void {
  const terminals = terminalsOf(def, widthUnits);
  for (const terminal of terminals) {
    const sharing = terminals.filter((t) => t.side === terminal.side && t.unit === terminal.unit);
    const offset = (sharing.indexOf(terminal) - (sharing.length - 1) / 2) * PIN_SPACING;
    const x = r.x + (terminal.unit + 0.5) * MODULE_UNIT_MM + offset;
    drawPin(ctx, x, terminal.side === 'top' ? r.y + 7 : r.y + r.height - 6, terminal.conductor);
  }
}

function drawComb(
  ctx: CanvasRenderingContext2D,
  panel: Panel,
  sizes: Sizes,
  def: ModuleDef,
  rail: number,
  slot: number,
  widthUnits: number,
  color: string,
): void {
  if (!def.comb) return;
  drawCombStrip(ctx, def, combRect(panel, sizes, rail, slot, widthUnits, def.comb.side), widthUnits, color);
}

function drawCombStrip(ctx: CanvasRenderingContext2D, def: ModuleDef, r: Rect, widthUnits: number, color: string): void {
  if (!def.comb) return;
  fillRect(ctx, r, color);
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  for (let unit = 0; unit < widthUnits; unit++) {
    const pin = def.comb.pattern[unit % def.comb.pattern.length]!;
    drawPin(ctx, r.x + (unit + 0.5) * MODULE_UNIT_MM, r.y + r.height / 2, pin);
  }
}

const DUCT_SLOT_PITCH_MM = 12;
const DUCT_SLOT_LENGTH_MM = 3;

/** A duct is a grey bar with slots along it, drawn as plastic ducts look from the front. */
function drawDuct(ctx: CanvasRenderingContext2D, duct: Duct, labelled: boolean): void {
  const r = ductRect(duct);
  fillRect(ctx, r, COLORS.duct);
  ctx.fillStyle = COLORS.ductSlot;
  const lengthwise = r.width >= r.height;
  const along = lengthwise ? r.width : r.height;
  const across = lengthwise ? r.height : r.width;
  const slot = Math.min(DUCT_SLOT_LENGTH_MM, across / 3);
  for (let offset = DUCT_SLOT_PITCH_MM / 2; offset < along - DUCT_SLOT_PITCH_MM / 2; offset += DUCT_SLOT_PITCH_MM) {
    for (const side of [0.2, 0.8]) {
      const across0 = across * side - slot / 2;
      if (lengthwise) ctx.fillRect(r.x + offset, r.y + across0, slot, slot);
      else ctx.fillRect(r.x + across0, r.y + offset, slot, slot);
    }
  }
  if (!duct.label || !labelled) return;
  ctx.font = LABEL_FONT;
  ctx.fillStyle = COLORS.ductText;
  ctx.textBaseline = 'middle';
  if (lengthwise) {
    ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, duct.label, r.width - 8), r.x + r.width / 2, r.y + r.height / 2);
  } else {
    drawUpwardsLabel(ctx, duct.label, r.x + r.width / 2, r.y + r.height / 2, r.height - 8, 'center', COLORS.ductText);
  }
}

/** A line with a tick at each end and its length beside it; sizes are in screen pixels so it reads at any zoom. */
function drawDimensions(ctx: CanvasRenderingContext2D, dimensions: readonly Dimension[], scale: number): void {
  const px = 1 / scale;
  ctx.save();
  ctx.strokeStyle = COLORS.dimension;
  ctx.lineWidth = 1 * px;
  ctx.font = `${10 * px}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { from, to, mm } of dimensions) {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    const across = from.y === to.y ? { x: 0, y: 4 * px } : { x: 4 * px, y: 0 };
    for (const end of [from, to]) {
      ctx.moveTo(end.x - across.x, end.y - across.y);
      ctx.lineTo(end.x + across.x, end.y + across.y);
    }
    ctx.stroke();
    const text = `${Math.round(mm * 10) / 10}`;
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const width = ctx.measureText(text).width + 6 * px;
    ctx.fillStyle = 'rgba(20, 22, 29, 0.92)';
    ctx.fillRect(middle.x - width / 2, middle.y - 7 * px, width, 14 * px);
    ctx.fillStyle = COLORS.dimension;
    ctx.fillText(text, middle.x, middle.y);
  }
  ctx.restore();
}

function drawGuides(ctx: CanvasRenderingContext2D, guides: readonly Guide[], frame: Rect): void {
  ctx.save();
  ctx.strokeStyle = COLORS.guide;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  for (const guide of guides) {
    ctx.beginPath();
    if (guide.axis === 'x') {
      ctx.moveTo(guide.at, frame.y);
      ctx.lineTo(guide.at, frame.y + frame.height);
    } else {
      ctx.moveTo(frame.x, guide.at);
      ctx.lineTo(frame.x + frame.width, guide.at);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawModule(ctx: CanvasRenderingContext2D, def: ModuleDef | undefined, r: Rect, widthUnits: number, texts: TextVisibility): void {
  if (!def) {
    fillRect(ctx, r, COLORS.missing);
    return;
  }
  drawFace(ctx, def, r, widthUnits, true, texts);
}

/** The face of a module in a box: body, band, art, outline, and the name and terminals unless `detailed` is off. */
function drawFace(ctx: CanvasRenderingContext2D, def: ModuleDef, r: Rect, widthUnits: number, detailed: boolean, texts: TextVisibility = ALL_TEXT): void {
  fillRect(ctx, r, COLORS.body);
  fillRect(ctx, { ...r, height: 14 }, LEVER_COLORS[def.kind]);
  if (def.art) drawArt(ctx, def.art, r, def.widthUnits, widthUnits, texts.faceText);
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  if (detailed) drawLabel(ctx, def, r, texts);
  drawTerminals(ctx, def, r, widthUnits);
}

/** A picture of a module for a list, as large as fits in a square of `sizePx`; the name is left out, it is too small to read. */
export function drawThumbnail(canvas: HTMLCanvasElement, def: ModuleDef, sizePx: number): void {
  const widthMm = def.widthUnits * MODULE_UNIT_MM;
  const heightMm = def.comb ? COMB_HEIGHT : def.heightMm;
  const scale = Math.min(sizePx / widthMm, sizePx / heightMm);
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(widthMm * scale));
  const height = Math.max(1, Math.round(heightMm * scale));
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scale * ratio, 0, 0, scale * ratio, 0, 0);
  const box = { x: 0, y: 0, width: widthMm, height: heightMm };
  if (def.comb) drawCombStrip(ctx, def, box, def.widthUnits, LEVER_COLORS.comb);
  else drawFace(ctx, def, box, def.widthUnits, false);
}

const RULER_COLOR = '#f5c518';

/** A line with a tick at each end and its length beside it; sizes are given in screen pixels so it reads at any zoom. */
function drawRuler(ctx: CanvasRenderingContext2D, line: RulerLine, scale: number): void {
  const px = 1 / scale;
  const { a, b } = line;
  ctx.save();
  ctx.strokeStyle = RULER_COLOR;
  ctx.fillStyle = RULER_COLOR;
  ctx.lineWidth = 1.5 * px;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
  for (const end of [a, b]) {
    ctx.beginPath();
    ctx.moveTo(end.x - Math.cos(angle) * 6 * px, end.y - Math.sin(angle) * 6 * px);
    ctx.lineTo(end.x + Math.cos(angle) * 6 * px, end.y + Math.sin(angle) * 6 * px);
    ctx.stroke();
  }
  const lines = describeMeasurement(measurement(line));
  const size = 12 * px;
  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const width = Math.max(...lines.map((text) => ctx.measureText(text).width)) + 10 * px;
  const height = lines.length * size * 1.3 + 6 * px;
  const x = (a.x + b.x) / 2 - width / 2;
  const y = (a.y + b.y) / 2 - height - 8 * px;
  ctx.fillStyle = 'rgba(20, 22, 29, 0.92)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = '#f5f5f5';
  lines.forEach((text, i) => ctx.fillText(text, x + 5 * px, y + 3 * px + i * size * 1.3));
  ctx.restore();
}

export function render(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  scene: Scene,
  viewportW: number,
  viewportH: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme().background;
  ctx.fillRect(0, 0, viewportW, viewportH);

  ctx.translate(viewportW / 2 - camera.x * camera.scale, viewportH / 2 - camera.y * camera.scale);
  ctx.scale(camera.scale, camera.scale);

  const { panel } = scene;
  const frame = frameRect(panel);
  const texts = scene.texts ?? ALL_TEXT;
  if (!scene.bare) {
    fillRect(ctx, frame, theme().frameFill);
    ctx.strokeStyle = theme().frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
    if (texts.title) {
      const stamp = stampParts(panel.info).map(t).join(' · ');
      ctx.fillStyle = theme().label;
      ctx.textBaseline = 'middle';
      let stampWidth = 0;
      if (stamp) {
        ctx.font = `10px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.fillText(stamp, frame.width - 14, 24);
        stampWidth = ctx.measureText(stamp).width + 14;
      }
      const heading = [panel.title, scene.plateName].filter(Boolean).join(' - ');
      if (heading) {
        ctx.font = `bold 14px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText(fitText(ctx, heading, frame.width - 28 - stampWidth), 14, 24);
      }
    }
  }

  if (scene.gridMm) drawGrid(ctx, frame, scene.gridMm, camera.scale);

  panel.rails.forEach((_r, rail) => {
    const r = railRect(panel, rail);
    fillRect(ctx, r, COLORS.rail);
    ctx.fillStyle = theme().frameFill;
    for (let unit = 0; unit < r.width / MODULE_UNIT_MM; unit++) {
      ctx.fillRect(r.x + unit * MODULE_UNIT_MM + MODULE_UNIT_MM / 2 - 3, r.y + r.height / 2 - 1.5, 6, 3);
    }
  });

  if (scene.selectedRail !== null && scene.selectedRail < panel.rails.length) {
    const r = railRect(panel, scene.selectedRail);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
  }

  for (const duct of ductsOf(panel)) {
    ctx.globalAlpha = duct.id === scene.moving?.id && scene.moving.kind === 'duct' ? 0.35 : 1;
    drawDuct(ctx, duct, texts.moduleLabels);
    const mark = scene.marked?.get(duct.id);
    if (mark) {
      const r = ductRect(duct);
      ctx.strokeStyle = mark === 'error' ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(r.x - 3, r.y - 3, r.width + 6, r.height + 6);
    }
    if (scene.selectedIds?.has(duct.id)) {
      const r = ductRect(duct);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
    }
  }
  ctx.globalAlpha = 1;

  const movingId = (kind: 'placement' | 'comb') => (scene.moving?.kind === kind ? scene.moving.id : null);
  const sizes = sizesOf(scene);
  for (const placement of panel.placements) {
    ctx.globalAlpha = placement.id === movingId('placement') ? 0.35 : 1;
    drawModule(ctx, scene.resolve(placement.module), placementRect(panel, sizes, placement), itemWidth(scene, placement), texts);
  }
  for (const comb of panel.combs) {
    const def = scene.resolve(comb.module);
    if (!def?.comb) continue;
    ctx.globalAlpha = comb.id === movingId('comb') ? 0.35 : 1;
    drawComb(ctx, panel, sizes, def, comb.rail, comb.slot, itemWidth(scene, comb), LEVER_COLORS.comb);
  }
  // The marks and the frames come after every body, so a module drawn later cannot cover the edge of one beside it.
  for (const placement of panel.placements) {
    ctx.globalAlpha = placement.id === movingId('placement') ? 0.35 : 1;
    const mark = scene.marked?.get(placement.id);
    if (mark) {
      const r = placementRect(panel, sizes, placement);
      ctx.strokeStyle = mark === 'error' ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(r.x - 3, r.y - 3, r.width + 6, r.height + 6);
    }
    if (placement.id === scene.selectedPlacementId || scene.selectedIds?.has(placement.id)) {
      const r = placementRect(panel, sizes, placement);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
    }
  }
  for (const comb of panel.combs) {
    const def = scene.resolve(comb.module);
    if (!def?.comb || !(comb.id === scene.selectedCombId || scene.selectedIds?.has(comb.id))) continue;
    ctx.globalAlpha = comb.id === movingId('comb') ? 0.35 : 1;
    const r = combRect(panel, sizes, comb.rail, comb.slot, itemWidth(scene, comb), def.comb.side);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
  }
  ctx.globalAlpha = 1;
  drawLabels(ctx, scene, texts);
  drawAnnotations(ctx, scene.annotations ?? panel.plates[0]?.annotations, scene.selectedAnnotationId ?? null, texts.annotations);

  if (scene.ghost) {
    const { module, widthUnits, rail, slot, x, y, valid } = scene.ghost;
    const color = valid ? COLORS.ghostOk : COLORS.ghostBad;
    const area =
      x !== undefined && y !== undefined
        ? { x: FRAME_PADDING + x, y: FRAME_PADDING + y, width: widthUnits * MODULE_UNIT_MM, height: module.heightMm }
        : module.comb
          ? combRect(panel, sizesOf(scene), rail ?? 0, slot ?? 0, widthUnits, module.comb.side)
          : moduleRect(panel, rail ?? 0, slot ?? 0, widthUnits, module.heightMm);
    fillRect(ctx, area, color);
  }
  if (scene.draftDuct) fillRect(ctx, scene.draftDuct, COLORS.ghostOk);
  if (scene.guides) drawGuides(ctx, scene.guides, frame);
  if (scene.dimensions) drawDimensions(ctx, scene.dimensions, camera.scale);

  if (scene.ruler) drawRuler(ctx, scene.ruler, camera.scale);

  if (scene.band) {
    ctx.fillStyle = 'rgba(245, 197, 24, 0.12)';
    ctx.fillRect(scene.band.x, scene.band.y, scene.band.width, scene.band.height);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(scene.band.x, scene.band.y, scene.band.width, scene.band.height);
    ctx.setLineDash([]);
  }
}
