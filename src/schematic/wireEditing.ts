import type { Point } from '../view/Camera';
import { wirePath, type Endpoint } from './geometry';
import { insertJog, lanesFromPath, moveLane, normalisePath, type Lanes } from './manualRoute';

export interface Segment {
  /** Position in the path, from the first piece at the terminal. */
  index: number;
  a: Point;
  b: Point;
  vertical: boolean;
}

export function segmentsOf(path: Point[]): Segment[] {
  const points = normalisePath(path);
  return points.slice(1).map((b, i) => {
    const a = points[i]!;
    return { index: i, a, b, vertical: Math.abs(a.x - b.x) < 1e-6 };
  });
}

function distanceToSegment(p: Point, { a, b }: Segment): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The piece of the path nearest to the point, if one is within the tolerance. */
export function hitSegment(path: Point[], p: Point, tolerance: number): Segment | undefined {
  let best: { segment: Segment; distance: number } | undefined;
  for (const segment of segmentsOf(path)) {
    const distance = distanceToSegment(p, segment);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { segment, distance };
  }
  return best?.segment;
}

/** What dragging a piece of a wire does: move a lane, or turn the piece at a terminal into a jog. */
export type WireDrag =
  | { kind: 'lane'; index: number; vertical: boolean; grab: number; lanes: Lanes }
  | { kind: 'jog'; atStart: boolean; startX: number; startY: number; lanes: Lanes };

/** How far a piece at a terminal has to be pulled sideways before it becomes a jog. */
export const JOG_THRESHOLD_MM = 6;

/** Where a drag of this piece starts. The lanes are those of the wire as drawn now, whether it is routed by hand or not. */
export function beginDrag(a: Endpoint, b: Endpoint, path: Point[], segment: Segment, pointer: Point, route: Lanes | undefined): WireDrag {
  const lanes = route ?? lanesFromPath(path) ?? lanesFromPath(wirePath(a, b, 0)) ?? [(a.point.y + b.point.y) / 2];
  const segments = segmentsOf(path).length;
  if (segment.index === 0 || segment.index === segments - 1) return { kind: 'jog', atStart: segment.index === 0, startX: pointer.x, startY: pointer.y, lanes };
  const index = segment.index - 1;
  return { kind: 'lane', index, vertical: segment.vertical, grab: (segment.vertical ? pointer.x : pointer.y) - lanes[index]!, lanes };
}

/** How the lanes look with the pointer at a point; `snap` may pull a coordinate onto something nearby. */
export function dragLanes(a: Endpoint, b: Endpoint, drag: WireDrag, pointer: Point, snap: (value: number, axis: 'x' | 'y') => number = (v) => v): Lanes {
  if (drag.kind === 'jog') {
    return Math.abs(pointer.x - drag.startX) < JOG_THRESHOLD_MM ? drag.lanes : insertJog(a, b, drag.lanes, drag.atStart, snap(pointer.x, 'x'), drag.startY);
  }
  const axis = drag.vertical ? 'x' : 'y';
  const value = snap((drag.vertical ? pointer.x : pointer.y) - drag.grab, axis);
  return moveLane(a, b, drag.lanes, drag.index, value);
}
