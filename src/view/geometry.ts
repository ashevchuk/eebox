import { MODULE_UNIT_MM } from '../library/types';
import type { CombPlacement, Panel, Placement, WidthOf } from '../layout/placement';
import type { TerminalSide } from '../library/types';
import { LAYOUT_EPSILON_UNITS, isWholeUnits, roundUnits } from '../layout/units';
import type { Point } from './Camera';

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
