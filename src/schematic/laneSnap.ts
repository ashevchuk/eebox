import type { Point } from '../view/Camera';
import type { Layout } from './geometry';
import { segmentsOf } from './wireEditing';

export type Axis = 'x' | 'y';

export interface SnapTarget {
  value: number;
  kind: 'grid' | 'node' | 'wire';
}

/** Space left between a lane and the node it passes, and between neighbouring wires. */
export const NODE_GAP_MM = 10;
export const WIRE_GAP_MM = 10;
export const GRID_MM = 10;

/** How much better than the nearest grid line a node or a wire has to be to win over it, in mm. */
const PREFERENCE_MM = 2.5;

/**
 * Where a lane may settle: beside a node, beside another wire but never on it, and on the grid. A lane
 * right on another wire would glue the two together, so those are left out on purpose.
 */
export function laneTargets(axis: Axis, layout: Layout, routes: Map<string, Point[]>, exclude: ReadonlySet<string>): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const { rect } of layout.values()) {
    const [from, size] = axis === 'x' ? [rect.x, rect.width] : [rect.y, rect.height];
    targets.push({ value: from - NODE_GAP_MM, kind: 'node' }, { value: from + size + NODE_GAP_MM, kind: 'node' });
  }
  for (const [id, path] of routes) {
    if (exclude.has(id)) continue;
    for (const segment of segmentsOf(path)) {
      if (segment.index === 0 || (axis === 'x') !== segment.vertical) continue;
      const value = axis === 'x' ? segment.a.x : segment.a.y;
      targets.push({ value: value - WIRE_GAP_MM, kind: 'wire' }, { value: value + WIRE_GAP_MM, kind: 'wire' });
    }
  }
  return targets;
}

/** The value pulled onto the best target within the tolerance, or onto the grid; the target it settled on, if one. */
export function snapLane(value: number, targets: SnapTarget[], toleranceMm: number): { value: number; target?: SnapTarget } {
  let best: { target: SnapTarget; distance: number } | undefined;
  for (const target of targets) {
    const distance = Math.abs(target.value - value);
    if (distance <= toleranceMm && (!best || distance < best.distance)) best = { target, distance };
  }
  const grid = Math.round(value / GRID_MM) * GRID_MM;
  if (best && best.distance <= Math.abs(grid - value) + PREFERENCE_MM) return { value: best.target.value, target: best.target };
  return Math.abs(grid - value) <= toleranceMm ? { value: grid, target: { value: grid, kind: 'grid' } } : { value };
}
