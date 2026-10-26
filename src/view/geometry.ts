import { MODULE_UNIT_MM } from '../library/types';
import type { CombPlacement, Panel, Placement, WidthOf } from '../layout/placement';
import type { TerminalSide } from '../library/types';
import { LAYOUT_EPSILON_UNITS, isWholeUnits, roundUnits } from '../layout/units';
import type { Bounds, Point } from './Camera';

/** World units are millimetres. */
export const RAIL_HEIGHT = 35;
/** Space above the first and below the last rail, inside the frame. */
export const ROW_MARGIN = 110;
/** How far from a rail a drop still counts as being on that rail. */
const SNAP_DISTANCE = 75;
export const MODULE_HEIGHT = 90;
export const FRAME_PADDING = 40;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function railCenterY(panel: Panel, rail: number): number {
  const above = panel.railPitchesMm.slice(0, rail).reduce((sum, pitch) => sum + pitch, 0);
  return FRAME_PADDING + ROW_MARGIN + above;
}

export function railRect(panel: Panel, rail: number): Rect {
  return {
    x: FRAME_PADDING,
    y: railCenterY(panel, rail) - RAIL_HEIGHT / 2,
    width: (panel.railLengthsUnits[rail] ?? 0) * MODULE_UNIT_MM,
    height: RAIL_HEIGHT,
  };
}

export function moduleRect(panel: Panel, rail: number, slot: number, widthUnits: number): Rect {
  return {
    x: FRAME_PADDING + slot * MODULE_UNIT_MM,
    y: railCenterY(panel, rail) - MODULE_HEIGHT / 2,
    width: widthUnits * MODULE_UNIT_MM,
    height: MODULE_HEIGHT,
  };
}

const COMB_HEIGHT = 18;
export const COMB_OVERHANG = 10;
const LABEL_GAP = 8;

/** A comb lies along the terminal edge of the modules it covers, mostly just outside them. */
export function combRect(
  panel: Panel,
  rail: number,
  slot: number,
  widthUnits: number,
  side: TerminalSide,
): Rect {
  const module = moduleRect(panel, rail, slot, widthUnits);
  const y = side === 'top' ? module.y - COMB_OVERHANG : module.y + module.height - (COMB_HEIGHT - COMB_OVERHANG);
  return { x: module.x, y, width: module.width, height: COMB_HEIGHT };
}

/**
 * Length available for a label printed under the modules of a rail: down to the combs that
 * overhang the next row, or to the end of the frame for the last row.
 */
export function labelRoom(panel: Panel, rail: number): number {
  const bottom = railCenterY(panel, rail) + MODULE_HEIGHT / 2;
  const limit =
    rail + 1 < panel.railLengthsUnits.length
      ? railCenterY(panel, rail + 1) - MODULE_HEIGHT / 2 - COMB_OVERHANG
      : frameRect(panel).height;
  return Math.max(0, limit - bottom - LABEL_GAP);
}

export function combAtPoint(
  panel: Panel,
  infoOf: (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined,
  point: Point,
): CombPlacement | undefined {
  return [...panel.combs].reverse().find((comb) => {
    const info = infoOf(comb);
    if (!info) return false;
    const r = combRect(panel, comb.rail, comb.slot, info.widthUnits, info.side);
    return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
  });
}

export function frameRect(panel: Panel): Rect {
  const longest = Math.max(0, ...panel.railLengthsUnits) * MODULE_UNIT_MM;
  const lastRail = panel.railLengthsUnits.length - 1;
  const bottom = lastRail < 0 ? FRAME_PADDING : railCenterY(panel, lastRail) + ROW_MARGIN + FRAME_PADDING;
  return { x: 0, y: 0, width: longest + FRAME_PADDING * 2, height: bottom };
}

/**
 * Maps a world point to the rail row under it and the slot that puts the
 * grabbed point (`anchorUnits` from the module's left edge) under the pointer.
 * The slot is clamped into the rail so dragging past an end snaps inward.
 */
/** How close, in units, the module has to come to a neighbour's edge or the rail's end to be drawn to it: about 5 mm. */
export const EDGE_SNAP_UNITS = 0.3;

/** Cells of half a millimetre, the grid a module that is not a whole number of units is placed on. */
const HALF_MM_CELLS_PER_UNIT = MODULE_UNIT_MM * 2;

export interface Neighbour {
  rail: number;
  slot: number;
  widthUnits: number;
}

export function snapToSlot(
  panel: Panel,
  point: Point,
  widthUnits: number,
  anchorUnits: number,
  neighbours: readonly Neighbour[] = [],
): { rail: number; slot: number } | null {
  let rail = -1;
  let nearest = Infinity;
  panel.railLengthsUnits.forEach((_length, i) => {
    const distance = Math.abs(point.y - railCenterY(panel, i));
    if (distance < nearest) {
      nearest = distance;
      rail = i;
    }
  });
  const railLength = panel.railLengthsUnits[rail];
  if (railLength === undefined || nearest > SNAP_DISTANCE) return null;
  const raw = (point.x - FRAME_PADDING) / MODULE_UNIT_MM - anchorUnits;
  const last = Math.max(0, railLength - widthUnits);
  const edges = [
    0,
    last,
    ...neighbours.filter((n) => n.rail === rail).flatMap((n) => [n.slot + n.widthUnits, n.slot - widthUnits]),
  ].filter((edge) => edge >= 0 && edge <= last + LAYOUT_EPSILON_UNITS);
  const closest = edges.reduce<number | undefined>((best, edge) => (best === undefined || Math.abs(edge - raw) < Math.abs(best - raw) ? edge : best), undefined);
  const grid = isWholeUnits(widthUnits) ? Math.round(raw) : Math.round(raw * HALF_MM_CELLS_PER_UNIT) / HALF_MM_CELLS_PER_UNIT;
  const slot = closest !== undefined && Math.abs(closest - raw) <= EDGE_SNAP_UNITS ? closest : grid;
  return { rail, slot: roundUnits(Math.max(0, Math.min(slot, last))) };
}

/** The row whose rail bar is under the point, if any. */
export function railAtPoint(panel: Panel, point: Point): number | undefined {
  const index = panel.railLengthsUnits.findIndex((_length, rail) => {
    const r = railRect(panel, rail);
    return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y - 2 && point.y <= r.y + r.height + 2;
  });
  return index < 0 ? undefined : index;
}

export function placementAt(panel: Panel, widthOf: WidthOf, point: Point): Placement | undefined {
  return [...panel.placements].reverse().find((placement) => {
    const rect = moduleRect(panel, placement.rail, placement.slot, widthOf(placement) ?? 1);
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  });
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Normalises two corners into a rectangle, whichever way the user dragged. */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Ids of the modules and combs whose outline touches the rectangle. */
export function itemsInRect(
  panel: Panel,
  widthOf: WidthOf,
  combInfoOf: (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined,
  area: Rect,
): { placements: string[]; combs: string[] } {
  return {
    placements: panel.placements
      .filter((p) => overlaps(moduleRect(panel, p.rail, p.slot, widthOf(p) ?? 1), area))
      .map((p) => p.id),
    combs: panel.combs
      .filter((c) => {
        const info = combInfoOf(c);
        return info !== undefined && overlaps(combRect(panel, c.rail, c.slot, info.widthUnits, info.side), area);
      })
      .map((c) => c.id),
  };
}

/** Space kept around what is printed at full size, so a label or a sheet edge does not touch the drawing. */
export const PRINT_MARGIN_MM = 12;
/** A label under a module is cut at the room it has, and starts this far below the module. */
const PRINT_LABEL_START_MM = 4;
const PRINT_LABEL_HALF_WIDTH_MM = 6;
const ROW_LABEL_X_MM = FRAME_PADDING / 2;

/**
 * What a drawing of the panel at full size has to cover: the rails, the modules, the combs and the
 * labels, with a margin, and not the empty frame around them. `rects` are the parts that hold
 * something, so a sheet that holds none of them can be left out. `measure` is the length of a text
 * in mm, since a label runs only as far as it is long.
 */
export function printArea(
  panel: Panel,
  widthOf: WidthOf,
  combInfoOf: (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined,
  measure: (text: string) => number,
): { bounds: Bounds; rects: Rect[] } {
  const rects: Rect[] = panel.railLengthsUnits.map((_length, rail) => railRect(panel, rail));
  for (const p of panel.placements) {
    const r = moduleRect(panel, p.rail, p.slot, widthOf(p) ?? 1);
    rects.push(r);
    if (p.label) {
      const length = Math.min(measure(p.label), labelRoom(panel, p.rail));
      rects.push({ x: r.x + r.width / 2 - PRINT_LABEL_HALF_WIDTH_MM, y: r.y + r.height, width: 2 * PRINT_LABEL_HALF_WIDTH_MM, height: PRINT_LABEL_START_MM + length });
    }
  }
  for (const c of panel.combs) {
    const info = combInfoOf(c);
    if (info) rects.push(combRect(panel, c.rail, c.slot, info.widthUnits, info.side));
  }
  panel.railLabels.forEach((label, rail) => {
    if (!label) return;
    const centre = railCenterY(panel, rail);
    const half = Math.min(measure(label), 110) / 2;
    rects.push({ x: ROW_LABEL_X_MM - PRINT_LABEL_HALF_WIDTH_MM, y: centre - half, width: 2 * PRINT_LABEL_HALF_WIDTH_MM, height: 2 * half });
  });
  if (rects.length === 0) {
    const frame = frameRect(panel);
    return { bounds: { minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.height }, rects };
  }
  const bounds: Bounds = {
    minX: Math.min(...rects.map((r) => r.x)) - PRINT_MARGIN_MM,
    minY: Math.min(...rects.map((r) => r.y)) - PRINT_MARGIN_MM,
    maxX: Math.max(...rects.map((r) => r.x + r.width)) + PRINT_MARGIN_MM,
    maxY: Math.max(...rects.map((r) => r.y + r.height)) + PRINT_MARGIN_MM,
  };
  return { bounds, rects };
}
