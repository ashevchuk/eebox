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
  const segments = segmentsOf(path).length;
  const numberedLikePath = (lanes: Lanes) => lanes.length + 2 === segments;
  const shown = route && numberedLikePath(route) ? route : lanesFromPath(path);
  const lanes = shown ?? lanesFromPath(wirePath(a, b, 0)) ?? [(a.point.y + b.point.y) / 2];
  const jog = (atStart: boolean): WireDrag => ({ kind: 'jog', atStart, startX: pointer.x, startY: pointer.y, lanes });
  if (segment.index === 0 || segment.index === segments - 1) return jog(segment.index === 0);
  const pointerAcross = segment.vertical ? pointer.x : pointer.y;
  let index = segment.index - 1;
  if (!shown) {
    const sameWay = lanes.map((value, i) => ({ value, i })).filter(({ i }) => (i % 2 === 1) === segment.vertical);
    const nearest = sameWay.sort((p, q) => Math.abs(p.value - pointerAcross) - Math.abs(q.value - pointerAcross))[0];
    if (!nearest) return jog(Math.abs(pointer.y - a.point.y) <= Math.abs(pointer.y - b.point.y));
    index = nearest.i;
  }
  return { kind: 'lane', index, vertical: segment.vertical, grab: pointerAcross - lanes[index]!, lanes };
}

/** The coordinate a dragged lane is wanted at, with the pointer where it is and the grab offset taken off. */
export function laneValue(drag: Extract<WireDrag, { kind: 'lane' }>, pointer: Point, snap: (value: number, axis: 'x' | 'y') => number = (v) => v): number {
  return snap((drag.vertical ? pointer.x : pointer.y) - drag.grab, drag.vertical ? 'x' : 'y');
}

/** How far a piece of another wire may be from the one pulled, across its line, and still go along with it. */
export const COMPANION_BAND_MM = 30;

export interface Companion {
  wire: string;
  a: Endpoint;
  b: Endpoint;
  drag: Extract<WireDrag, { kind: 'lane' }>;
}

/**
 * The pieces of the other selected wires that run alongside the piece being pulled, the same way and
 * overlapping it along its line, one for each wire: they move by as much as it does.
 */
export function companionsOf(
  pulled: Extract<WireDrag, { kind: 'lane' }>,
  pulledSegment: Segment,
  pointer: Point,
  others: Array<{ wire: string; a: Endpoint; b: Endpoint; path: Point[]; route: Lanes | undefined }>,
): Companion[] {
  const along = (s: Segment): [number, number] => (s.vertical ? [Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)] : [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)]);
  const across = (s: Segment) => (s.vertical ? s.a.x : s.a.y);
  const [from, to] = along(pulledSegment);
  const found: Companion[] = [];
  for (const other of others) {
    const segments = segmentsOf(other.path);
    const candidates = segments.filter((s) => {
      const [f, t] = along(s);
      return s.index >= 1 && s.index <= segments.length - 2 && s.vertical === pulled.vertical && Math.abs(across(s) - across(pulledSegment)) <= COMPANION_BAND_MM && Math.min(t, to) - Math.max(f, from) > 0;
    });
    const nearest = candidates.sort((x, y) => Math.abs(across(x) - across(pulledSegment)) - Math.abs(across(y) - across(pulledSegment)))[0];
    if (!nearest) continue;
    const drag = beginDrag(other.a, other.b, other.path, nearest, pointer, other.route);
    if (drag.kind === 'lane') found.push({ wire: other.wire, a: other.a, b: other.b, drag });
  }
  return found;
}

/** The ids of the wires with a piece inside the rectangle. */
export function wiresInRect(routes: Map<string, Point[]>, rect: { x: number; y: number; width: number; height: number }): string[] {
  const hits = (a: Point, b: Point) =>
    Math.max(a.x, b.x) >= rect.x && Math.min(a.x, b.x) <= rect.x + rect.width && Math.max(a.y, b.y) >= rect.y && Math.min(a.y, b.y) <= rect.y + rect.height;
  return [...routes].filter(([, path]) => path.slice(1).some((p, i) => hits(path[i]!, p))).map(([id]) => id);
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
