import { MODULE_UNIT_MM } from '../library/types';
import { ductsOf, type Duct } from '../layout/ducts';
import { isFree, isOnRail, type CombPlacement, type Panel, type Placement, type Sizes } from '../layout/placement';
import { DIN_MODULE_HEIGHT_MM, type TerminalSide } from '../library/types';
import { FIRST_RAIL_Y_MM } from '../layout/limits';
import { isVertical } from '../layout/rail';
import { LAYOUT_EPSILON_UNITS, isWholeUnits, roundUnits } from '../layout/units';
import type { Bounds, Point } from './Camera';

/** World units are millimetres. */
export const RAIL_HEIGHT = 35;
/** Space above the first and below the last rail, inside the frame. */
export const ROW_MARGIN = FIRST_RAIL_Y_MM;
/** How far from a rail a drop still counts as being on that rail. */
const SNAP_DISTANCE = 75;
export const FRAME_PADDING = 40;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The bar of a rail: along `x` for a horizontal rail, along `y` for a vertical one. */
export function railRect(panel: Panel, rail: number): Rect {
  const r = panel.rails[rail];
  const length = (r?.lengthUnits ?? 0) * MODULE_UNIT_MM;
  if (isVertical(r)) return { x: FRAME_PADDING + (r?.x ?? 0) - RAIL_HEIGHT / 2, y: FRAME_PADDING + (r?.y ?? 0), width: RAIL_HEIGHT, height: length };
  return { x: FRAME_PADDING + (r?.x ?? 0), y: FRAME_PADDING + (r?.y ?? 0) - RAIL_HEIGHT / 2, width: length, height: RAIL_HEIGHT };
}

/** The middle of the rail's bar, from the top of the drawing. */
export function railCenterY(panel: Panel, rail: number): number {
  const r = railRect(panel, rail);
  return r.y + r.height / 2;
}

/**
 * Where a module stands on a rail. On a vertical rail the module is turned a quarter turn clockwise:
 * its width runs down the rail, its height across it, and its top faces right.
 */
export function moduleRect(panel: Panel, rail: number, slot: number, widthUnits: number, heightMm: number): Rect {
  const bar = railRect(panel, rail);
  if (isVertical(panel.rails[rail])) return { x: bar.x + bar.width / 2 - heightMm / 2, y: bar.y + slot * MODULE_UNIT_MM, width: heightMm, height: widthUnits * MODULE_UNIT_MM };
  return { x: bar.x + slot * MODULE_UNIT_MM, y: bar.y + bar.height / 2 - heightMm / 2, width: widthUnits * MODULE_UNIT_MM, height: heightMm };
}

/** Where a placed module stands, by the size its module has; a module that is not in any library is drawn standard-sized. */
export function placementRect(panel: Panel, sizes: Sizes, placement: Placement): Rect {
  const width = sizes.widthOf(placement) ?? 1;
  const height = sizes.heightOf(placement) ?? DIN_MODULE_HEIGHT_MM;
  if (isFree(placement)) return { x: FRAME_PADDING + placement.x, y: FRAME_PADDING + placement.y, width: width * MODULE_UNIT_MM, height };
  return moduleRect(panel, placement.rail, placement.slot, width, height);
}

/** The body of a row: the length of its rail and the height of the tallest module standing on it (a standard module when it is empty). */
export function rowRect(panel: Panel, sizes: Sizes, rail: number): Rect {
  const heights = panel.placements.filter(isOnRail).filter((p) => p.rail === rail).map((p) => sizes.heightOf(p) ?? DIN_MODULE_HEIGHT_MM);
  const height = Math.max(DIN_MODULE_HEIGHT_MM, ...heights);
  const bar = railRect(panel, rail);
  if (isVertical(panel.rails[rail])) return { x: bar.x + bar.width / 2 - height / 2, y: bar.y, width: height, height: bar.height };
  return { x: bar.x, y: bar.y + bar.height / 2 - height / 2, width: bar.width, height };
}

export function ductRect(duct: Duct): Rect {
  return { x: FRAME_PADDING + duct.x, y: FRAME_PADDING + duct.y, width: duct.widthMm, height: duct.heightMm };
}

/** The cable duct under a point; a later one lies over an earlier one. */
export function ductAt(panel: Panel, point: Point): Duct | undefined {
  return [...ductsOf(panel)].reverse().find((duct) => {
    const r = ductRect(duct);
    return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
  });
}

export const COMB_HEIGHT = 18;
export const COMB_OVERHANG = 10;
const LABEL_GAP = 8;

/** The height of the tallest module that a comb at `slot` covers on its rail; a standard module when it covers none. */
function heightUnderComb(panel: Panel, sizes: Sizes, rail: number, slot: number, widthUnits: number): number {
  const heights = panel.placements
    .filter(isOnRail)
    .filter((p) => {
      const width = sizes.widthOf(p) ?? 1;
      return p.rail === rail && p.slot < slot + widthUnits - LAYOUT_EPSILON_UNITS && slot < p.slot + width - LAYOUT_EPSILON_UNITS;
    })
    .map((p) => sizes.heightOf(p) ?? DIN_MODULE_HEIGHT_MM);
  return heights.length > 0 ? Math.max(...heights) : DIN_MODULE_HEIGHT_MM;
}

/** A comb lies along the terminal edge of the modules it covers, mostly just outside them. */
export function combRect(
  panel: Panel,
  sizes: Sizes,
  rail: number,
  slot: number,
  widthUnits: number,
  side: TerminalSide,
): Rect {
  const module = moduleRect(panel, rail, slot, widthUnits, heightUnderComb(panel, sizes, rail, slot, widthUnits));
  if (isVertical(panel.rails[rail])) {
    const x = side === 'top' ? module.x + module.width - (COMB_HEIGHT - COMB_OVERHANG) : module.x - COMB_OVERHANG;
    return { x, y: module.y, width: COMB_HEIGHT, height: module.height };
  }
  const y = side === 'top' ? module.y - COMB_OVERHANG : module.y + module.height - (COMB_HEIGHT - COMB_OVERHANG);
  return { x: module.x, y, width: module.width, height: COMB_HEIGHT };
}

/**
 * Length available for a label printed under the modules of a rail: down to the combs that
 * overhang the nearest rail below it that shares some of its length, or to the end of the frame.
 */
export function labelRoom(panel: Panel, rail: number, heightMm: number): number {
  const bottom = railCenterY(panel, rail) + heightMm / 2;
  const here = railRect(panel, rail);
  const below = panel.rails
    .map((r, i) => ({ r: railRect(panel, i), vertical: isVertical(r) }))
    .filter(({ r }, i) => i !== rail && r.y > here.y && r.x < here.x + here.width && here.x < r.x + r.width)
    .map(({ r, vertical }) => (vertical ? r.y : r.y + r.height / 2 - DIN_MODULE_HEIGHT_MM / 2) - COMB_OVERHANG);
  const limit = below.length > 0 ? Math.min(...below) : frameRect(panel).height;
  return Math.max(0, limit - bottom - LABEL_GAP);
}

/** How far a label under a placed module may run: down to what is below it on its rail, or to the end of the frame for a device on the plate. */
export function placementLabelRoom(panel: Panel, placement: Placement, body: Rect): number {
  if (isOnRail(placement) && isVertical(panel.rails[placement.rail])) return Math.max(0, frameRect(panel).width - (body.x + body.width) - LABEL_GAP);
  return isOnRail(placement) ? labelRoom(panel, placement.rail, body.height) : Math.max(0, frameRect(panel).height - (body.y + body.height) - LABEL_GAP);
}

type CombInfoOf = (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined;

/**
 * Where the label of a module on a vertical rail may start: right of the module, and right of a comb of
 * top terminals that lies over it, which sticks out on the same side.
 */
export function levelLabelStart(panel: Panel, sizes: Sizes, combInfoOf: CombInfoOf, body: Rect, rail: number): number {
  let edge = body.x + body.width;
  for (const comb of panel.combs) {
    const info = comb.rail === rail ? combInfoOf(comb) : undefined;
    if (info?.side !== 'top') continue;
    const r = combRect(panel, sizes, comb.rail, comb.slot, info.widthUnits, info.side);
    if (r.y < body.y + body.height && body.y < r.y + r.height) edge = Math.max(edge, r.x + r.width);
  }
  return edge;
}

export function combAtPoint(
  panel: Panel,
  sizes: Sizes,
  infoOf: (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined,
  point: Point,
): CombPlacement | undefined {
  return [...panel.combs].reverse().find((comb) => {
    const info = infoOf(comb);
    if (!info) return false;
    const r = combRect(panel, sizes, comb.rail, comb.slot, info.widthUnits, info.side);
    return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height;
  });
}

/** The frame is the plate, with a margin around it; a panel of several plates shows its first. */
export function frameRect(panel: Panel): Rect {
  const plate = panel.plates[0];
  return { x: 0, y: 0, width: (plate?.widthMm ?? 0) + 2 * FRAME_PADDING, height: (plate?.heightMm ?? 0) + 2 * FRAME_PADDING };
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
  accepts: (rail: number) => boolean = () => true,
): { rail: number; slot: number } | null {
  const usable = panel.rails.map((_r, i) => i).filter(accepts);
  const crossOf = (i: number) => {
    const bar = railRect(panel, i);
    return isVertical(panel.rails[i]) ? Math.abs(point.x - (bar.x + bar.width / 2)) : Math.abs(point.y - (bar.y + bar.height / 2));
  };
  const outsideOf = (i: number) => {
    const bar = railRect(panel, i);
    return isVertical(panel.rails[i]) ? Math.max(bar.y - point.y, 0, point.y - (bar.y + bar.height)) : Math.max(bar.x - point.x, 0, point.x - (bar.x + bar.width));
  };
  const nearest = Math.min(Infinity, ...usable.map(crossOf));
  // Rails side by side in one row are told apart by how far the point is from their length; a point past the end of a rail still belongs to it.
  const row = usable.filter((i) => crossOf(i) <= nearest + RAIL_HEIGHT / 2);
  const rail = row.reduce((best, i) => (best < 0 || outsideOf(i) < outsideOf(best) || (outsideOf(i) === outsideOf(best) && crossOf(i) < crossOf(best)) ? i : best), -1);
  const railLength = panel.rails[rail]?.lengthUnits;
  if (railLength === undefined || nearest > SNAP_DISTANCE) return null;
  const bar = railRect(panel, rail);
  const alongPoint = isVertical(panel.rails[rail]) ? point.y - bar.y : point.x - bar.x;
  const raw = alongPoint / MODULE_UNIT_MM - anchorUnits;
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
  const index = panel.rails.findIndex((_r, rail) => {
    const r = railRect(panel, rail);
    return point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y - 2 && point.y <= r.y + r.height + 2;
  });
  return index < 0 ? undefined : index;
}

export function placementAt(panel: Panel, sizes: Sizes, point: Point): Placement | undefined {
  return [...panel.placements].reverse().find((placement) => {
    const rect = placementRect(panel, sizes, placement);
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
export interface ItemsInRect {
  placements: string[];
  combs: string[];
  ducts: string[];
}

export function itemsInRect(
  panel: Panel,
  sizes: Sizes,
  combInfoOf: (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined,
  area: Rect,
): ItemsInRect {
  return {
    placements: panel.placements
      .filter((p) => overlaps(placementRect(panel, sizes, p), area))
      .map((p) => p.id),
    combs: panel.combs
      .filter((c) => {
        const info = combInfoOf(c);
        return info !== undefined && overlaps(combRect(panel, sizes, c.rail, c.slot, info.widthUnits, info.side), area);
      })
      .map((c) => c.id),
    ducts: ductsOf(panel).filter((d) => overlaps(ductRect(d), area)).map((d) => d.id),
  };
}

/** Space kept around what is printed at full size, so a label or a sheet edge does not touch the drawing. */
export const PRINT_MARGIN_MM = 12;
/** A label under a module is cut at the room it has, and starts this far below the module. */
const PRINT_LABEL_START_MM = 4;
const PRINT_LABEL_HALF_WIDTH_MM = 6;
const PRINT_LABEL_HALF_HEIGHT_MM = 5;
/** The longest a level label, such as the label of a comb on a vertical rail, is printed. */
const LEVEL_LABEL_MAX_MM = 110;
/** A row label stands in the margin to the left of its rail. */
export const rowLabelX = (panel: Panel, rail: number): number => railRect(panel, rail).x - FRAME_PADDING / 2;

/**
 * What a drawing of the panel at full size has to cover: the rails, the modules, the combs and the
 * labels, with a margin, and not the empty frame around them. `rects` are the parts that hold
 * something, so a sheet that holds none of them can be left out. `measure` is the length of a text
 * in mm, since a label runs only as far as it is long. `extra` are further boxes that hold something,
 * such as the names over the terminals of a terminal block.
 */
export function printArea(
  panel: Panel,
  sizes: Sizes,
  combInfoOf: (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined,
  measure: (text: string) => number,
  extra: readonly Rect[] = [],
): { bounds: Bounds; rects: Rect[] } {
  const rects: Rect[] = panel.rails.map((_r, rail) => railRect(panel, rail));
  rects.push(...ductsOf(panel).map(ductRect), ...extra);
  for (const p of panel.placements) {
    const r = placementRect(panel, sizes, p);
    rects.push(r);
    if (p.label) {
      if (isOnRail(p) && isVertical(panel.rails[p.rail])) {
        const start = levelLabelStart(panel, sizes, combInfoOf, r, p.rail);
        const length = Math.min(measure(p.label), placementLabelRoom(panel, p, { ...r, width: start - r.x }));
        rects.push({ x: start, y: r.y + r.height / 2 - PRINT_LABEL_HALF_HEIGHT_MM, width: PRINT_LABEL_START_MM + length, height: 2 * PRINT_LABEL_HALF_HEIGHT_MM });
      } else {
        const length = Math.min(measure(p.label), placementLabelRoom(panel, p, r));
        rects.push({ x: r.x + r.width / 2 - PRINT_LABEL_HALF_WIDTH_MM, y: r.y + r.height, width: 2 * PRINT_LABEL_HALF_WIDTH_MM, height: PRINT_LABEL_START_MM + length });
      }
    }
  }
  for (const c of panel.combs) {
    const info = combInfoOf(c);
    if (!info) continue;
    const r = combRect(panel, sizes, c.rail, c.slot, info.widthUnits, info.side);
    rects.push(r);
    if (c.label && isVertical(panel.rails[c.rail])) {
      const length = Math.min(measure(c.label), LEVEL_LABEL_MAX_MM);
      const x = info.side === 'top' ? r.x + r.width : r.x - PRINT_LABEL_START_MM - length;
      rects.push({ x, y: r.y + 2, width: PRINT_LABEL_START_MM + length, height: 2 * PRINT_LABEL_HALF_HEIGHT_MM });
    }
  }
  panel.rails.forEach(({ label }, rail) => {
    if (!label) return;
    const centre = railCenterY(panel, rail);
    const half = Math.min(measure(label), 110) / 2;
    if (isVertical(panel.rails[rail])) {
      const bar = railRect(panel, rail);
      rects.push({ x: bar.x + bar.width / 2 - half, y: bar.y - PRINT_LABEL_START_MM - 2 * PRINT_LABEL_HALF_HEIGHT_MM, width: 2 * half, height: PRINT_LABEL_START_MM + 2 * PRINT_LABEL_HALF_HEIGHT_MM });
    } else {
      rects.push({ x: rowLabelX(panel, rail) - PRINT_LABEL_HALF_WIDTH_MM, y: centre - half, width: 2 * PRINT_LABEL_HALF_WIDTH_MM, height: 2 * half });
    }
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
