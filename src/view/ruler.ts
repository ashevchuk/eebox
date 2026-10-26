import { MODULE_UNIT_MM, type TerminalSide } from '../library/types';
import type { CombPlacement, Panel, WidthOf } from '../layout/placement';
import type { Point } from './Camera';
import { combRect, frameRect, moduleRect, railRect } from './geometry';

export interface RulerLine {
  a: Point;
  b: Point;
}

export interface Measurement {
  dxMm: number;
  dyMm: number;
  lengthMm: number;
  lengthUnits: number;
}

/** World units are millimetres, so a distance in the drawing is a distance on the panel. */
export function measurement({ a, b }: RulerLine): Measurement {
  const dxMm = Math.abs(b.x - a.x);
  const dyMm = Math.abs(b.y - a.y);
  const lengthMm = Math.hypot(dxMm, dyMm);
  return { dxMm, dyMm, lengthMm, lengthUnits: lengthMm / MODULE_UNIT_MM };
}

const mm = (value: number) => `${value.toFixed(1)} mm`;
const units = (value: number) => `${Number(value.toFixed(2))} unit${Number(value.toFixed(2)) === 1 ? '' : 's'}`;

/** The text beside the ruler: the length first, then how it splits along and across the rail. */
export function describeMeasurement(m: Measurement): string[] {
  const lines = [`${mm(m.lengthMm)} (${units(m.lengthUnits)})`];
  if (m.dxMm >= 0.05 && m.dyMm >= 0.05) lines.push(`Δx ${mm(m.dxMm)}, Δy ${mm(m.dyMm)}`);
  return lines;
}

export interface EdgeLines {
  xs: number[];
  ys: number[];
}

/** The x and y of every edge a measurement may start or end on: modules, combs, rails and the frame. */
export function edgeLines(
  panel: Panel,
  widthOf: WidthOf,
  combInfoOf: (comb: CombPlacement) => { widthUnits: number; side: TerminalSide } | undefined,
): EdgeLines {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (r: { x: number; y: number; width: number; height: number }) => {
    xs.push(r.x, r.x + r.width);
    ys.push(r.y, r.y + r.height);
  };
  add(frameRect(panel));
  panel.railLengthsUnits.forEach((_length, rail) => add(railRect(panel, rail)));
  for (const p of panel.placements) add(moduleRect(panel, p.rail, p.slot, widthOf(p) ?? 1));
  for (const c of panel.combs) {
    const info = combInfoOf(c);
    if (info) add(combRect(panel, c.rail, c.slot, info.widthUnits, info.side));
  }
  return { xs, ys };
}

/** Moves each coordinate of the point to the nearest edge within the tolerance, independently, so edges line up. */
export function snapToEdges(point: Point, edges: EdgeLines, toleranceMm: number): Point {
  const nearest = (value: number, candidates: number[]) =>
    candidates.length === 0 ? value : candidates.reduce((best, c) => (Math.abs(c - value) < Math.abs(best - value) ? c : best));
  const x = nearest(point.x, edges.xs);
  const y = nearest(point.y, edges.ys);
  return { x: Math.abs(x - point.x) <= toleranceMm ? x : point.x, y: Math.abs(y - point.y) <= toleranceMm ? y : point.y };
}
