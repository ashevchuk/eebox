import { drawArt } from './art';
import { FONT_FAMILY } from './font';
import { drawConductorDot } from './conductorDraw';
import { describeMeasurement, measurement, type RulerLine } from './ruler';
import { wrapText } from './textFit';
import { terminalsOf } from '../electrical/terminals';
import { MODULE_UNIT_MM, type Conductor, type ModuleDef, type ModuleKind } from '../library/types';
import type { ModuleRef, Panel } from '../layout/placement';
import type { Camera } from './Camera';
import { theme } from './theme';
import { FRAME_PADDING, combRect, frameRect, labelRoom, moduleRect, railRect, type Rect } from './geometry';

export interface Ghost {
  module: ModuleDef;
  /** Width of the item being dragged: a resized copy keeps its own width. */
  widthUnits: number;
  rail: number;
  slot: number;
  valid: boolean;
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
  moving: { kind: 'placement' | 'comb'; id: string } | null;
  ghost: Ghost | null;
  /** A rubber band being dragged to select several items, in world coordinates. */
  band?: Rect | null;
  /** What the ruler has measured, in world coordinates. */
  ruler?: RulerLine | null;
  /** Draws only the rails and what stands on them, without the frame and its title, as a full-size print needs. */
  bare?: boolean;
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

function drawLabel(ctx: CanvasRenderingContext2D, def: ModuleDef, r: Rect): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rating = def.ratedCurrentA === undefined ? '' : `${def.curve ?? ''}${def.ratedCurrentA}`;
  if (rating && r.width >= MIN_RATING_WIDTH_MM) {
    ctx.font = `bold 8px ${FONT_FAMILY}`;
    ctx.fillText(rating, r.x + r.width / 2, r.y + 22);
  }
  if (r.width >= MIN_NAME_WIDTH_MM) {
    const room = r.height - NAME_TOP_MM - NAME_BOTTOM_MM;
    ctx.translate(r.x + r.width / 2, r.y + NAME_TOP_MM + room / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `6px ${FONT_FAMILY}`;
    const lines = wrapText((text) => ctx.measureText(text).width, def.shortName ?? def.name, room, Math.min(NAME_MAX_LINES, Math.max(1, Math.floor(r.width / NAME_LINE_SPACING_MM / 1.6))));
    lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * NAME_LINE_SPACING_MM));
  }
  ctx.restore();
}

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

function drawLabels(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { panel } = scene;
  panel.railLabels.forEach((label, rail) => {
    if (!label) return;
    const r = railRect(panel, rail);
    drawUpwardsLabel(ctx, label, FRAME_PADDING / 2, r.y + r.height / 2, ROW_LABEL_MAX_LENGTH, 'center', theme().rowLabel);
  });
  for (const placement of panel.placements) {
    if (!placement.label) continue;
    const r = moduleRect(panel, placement.rail, placement.slot, itemWidth(scene, placement));
    drawUpwardsLabel(ctx, placement.label, r.x + r.width / 2, r.y + r.height + 4, labelRoom(panel, placement.rail), 'right', theme().label);
  }
  ctx.font = LABEL_FONT;
  ctx.fillStyle = theme().label;
  ctx.textAlign = 'left';
  for (const comb of panel.combs) {
    const def = scene.resolve(comb.module);
    if (!comb.label || !def?.comb) continue;
    const r = combRect(panel, comb.rail, comb.slot, itemWidth(scene, comb), def.comb.side);
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
  def: ModuleDef,
  rail: number,
  slot: number,
  widthUnits: number,
  color: string,
): void {
  if (!def.comb) return;
  const r = combRect(panel, rail, slot, widthUnits, def.comb.side);
  fillRect(ctx, r, color);
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  for (let unit = 0; unit < widthUnits; unit++) {
    const pin = def.comb.pattern[unit % def.comb.pattern.length]!;
    drawPin(ctx, r.x + (unit + 0.5) * MODULE_UNIT_MM, r.y + r.height / 2, pin);
  }
}

function drawModule(
  ctx: CanvasRenderingContext2D,
  panel: Panel,
  def: ModuleDef | undefined,
  rail: number,
  slot: number,
  widthUnits: number,
): void {
  const r = moduleRect(panel, rail, slot, widthUnits);
  if (!def) {
    fillRect(ctx, r, COLORS.missing);
    return;
  }
  fillRect(ctx, r, COLORS.body);
  fillRect(ctx, { ...r, height: 14 }, LEVER_COLORS[def.kind]);
  if (def.art) drawArt(ctx, def.art, r, def.widthUnits, widthUnits);
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  drawLabel(ctx, def, r);
  drawTerminals(ctx, def, r, widthUnits);
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
  if (!scene.bare) {
    fillRect(ctx, frame, theme().frameFill);
    ctx.strokeStyle = theme().frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
    if (panel.title) {
      ctx.font = `bold 14px ${FONT_FAMILY}`;
      ctx.fillStyle = theme().label;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, panel.title, frame.width - 28), 14, 24);
    }
  }

  panel.railLengthsUnits.forEach((_length, rail) => {
    const r = railRect(panel, rail);
    fillRect(ctx, r, COLORS.rail);
    ctx.fillStyle = theme().frameFill;
    for (let unit = 0; unit < r.width / MODULE_UNIT_MM; unit++) {
      ctx.fillRect(r.x + unit * MODULE_UNIT_MM + MODULE_UNIT_MM / 2 - 3, r.y + r.height / 2 - 1.5, 6, 3);
    }
  });

  if (scene.selectedRail !== null && scene.selectedRail < panel.railLengthsUnits.length) {
    const r = railRect(panel, scene.selectedRail);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
  }

  const movingId = (kind: 'placement' | 'comb') => (scene.moving?.kind === kind ? scene.moving.id : null);
  for (const placement of panel.placements) {
    ctx.globalAlpha = placement.id === movingId('placement') ? 0.35 : 1;
    drawModule(ctx, panel, scene.resolve(placement.module), placement.rail, placement.slot, itemWidth(scene, placement));
    const mark = scene.marked?.get(placement.id);
    if (mark) {
      const r = moduleRect(panel, placement.rail, placement.slot, itemWidth(scene, placement));
      ctx.strokeStyle = mark === 'error' ? '#ef4444' : '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(r.x - 3, r.y - 3, r.width + 6, r.height + 6);
    }
    if (placement.id === scene.selectedPlacementId || scene.selectedIds?.has(placement.id)) {
      const r = moduleRect(panel, placement.rail, placement.slot, itemWidth(scene, placement));
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
    }
  }
  for (const comb of panel.combs) {
    const def = scene.resolve(comb.module);
    if (!def?.comb) continue;
    ctx.globalAlpha = comb.id === movingId('comb') ? 0.35 : 1;
    drawComb(ctx, panel, def, comb.rail, comb.slot, itemWidth(scene, comb), LEVER_COLORS.comb);
    if (comb.id === scene.selectedCombId || scene.selectedIds?.has(comb.id)) {
      const r = combRect(panel, comb.rail, comb.slot, itemWidth(scene, comb), def.comb.side);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
    }
  }
  ctx.globalAlpha = 1;
  drawLabels(ctx, scene);

  if (scene.ghost) {
    const { module, widthUnits, rail, slot, valid } = scene.ghost;
    const color = valid ? COLORS.ghostOk : COLORS.ghostBad;
    const area = module.comb
      ? combRect(panel, rail, slot, widthUnits, module.comb.side)
      : moduleRect(panel, rail, slot, widthUnits);
    fillRect(ctx, area, color);
  }

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
