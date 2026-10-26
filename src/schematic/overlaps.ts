import type { Point } from '../view/Camera';
import { wirePath, type Endpoint } from './geometry';
import { WIRE_GAP_MM } from './laneSnap';
import { lanesFromPath, moveLane, normalisePath, pathFromLanes, type Lanes } from './manualRoute';

/** Pieces of different wires that run side by side closer than this look like one wire. */
const CLOSE_MM = WIRE_GAP_MM - 1;
/** Wires closer than this are stuck together to the eye, and Check says so; the lines of the router's grid keep a gap well above it. */
export const TOUCH_MM = 5;
/** A lane that is within this of where it should be is left alone. */
const LEAVE_MM = 0.5;
/** A shared stretch shorter than this is two wires crossing or touching, not running together. */
const MIN_SHARED_MM = 6;
const MAX_PASSES = 80;

/** A stretch of a wire: where it is in the path, along which part of its line, and on which line. */
export interface Piece {
  wire: string;
  segment: number;
  range: [number, number];
  /** The coordinate of its line: x for a vertical piece, y for a horizontal one. */
  at: number;
}

export interface Overlap {
  /** The two wires, and the piece of each (its position in the path) that runs on the other. */
  first: Piece;
  second: Piece;
  vertical: boolean;
}

/** Interior pieces only: the piece at a terminal is shared by every wire that leaves it, which is as it should be. */
function interior(path: Point[]) {
  const points = normalisePath(path);
  const pieces: Array<{ segment: number; a: Point; b: Point; vertical: boolean }> = [];
  for (let s = 1; s <= points.length - 3; s++) {
    const a = points[s]!;
    const b = points[s + 1]!;
    pieces.push({ segment: s, a, b, vertical: Math.abs(a.x - b.x) < 1e-6 });
  }
  return pieces;
}

/** Pieces of wires that run side by side closer than `closerThan`, over a stretch long enough to see. */
export function findOverlaps(paths: Map<string, Point[]>, closerThan = CLOSE_MM): Overlap[] {
  const pieces = [...paths].flatMap(([wire, path]) => interior(path).map((p) => ({ wire, ...p })));
  const found: Overlap[] = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[i]!;
      const q = pieces[j]!;
      if (p.wire === q.wire || p.vertical !== q.vertical) continue;
      const [cp, cq] = p.vertical ? [p.a.x, q.a.x] : [p.a.y, q.a.y];
      if (Math.abs(cp - cq) > closerThan) continue;
      const [p1, p2] = p.vertical ? [p.a.y, p.b.y].sort((x, y) => x - y) : [p.a.x, p.b.x].sort((x, y) => x - y);
      const [q1, q2] = q.vertical ? [q.a.y, q.b.y].sort((x, y) => x - y) : [q.a.x, q.b.x].sort((x, y) => x - y);
      if (Math.min(p2!, q2!) - Math.max(p1!, q1!) < MIN_SHARED_MM) continue;
      found.push({ first: { wire: p.wire, segment: p.segment, range: [p1!, p2!], at: cp }, second: { wire: q.wire, segment: q.segment, range: [q1!, q2!], at: cq }, vertical: p.vertical });
    }
  }
  return found;
}

export interface SpreadResult {
  /** The new route of every wire that was moved. */
  routes: Map<string, Lanes>;
  /** Overlaps that are still there, because a piece could not be moved far enough. */
  remaining: number;
}

/** The pieces that run close to each other, with the pieces that run close to those in turn. */
function groupOf(first: Overlap, overlaps: Overlap[]): Piece[] {
  const key = (p: Piece) => `${p.wire}#${p.segment}`;
  const members = new Map([[key(first.first), first.first], [key(first.second), first.second]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of overlaps) {
      if (o.vertical !== first.vertical) continue;
      const known = members.has(key(o.first));
      if (known !== members.has(key(o.second))) {
        members.set(key(o.first), o.first);
        members.set(key(o.second), o.second);
        grew = true;
      }
    }
  }
  return [...members.values()];
}

/**
 * Moves wires that run on top of each other, or too close, apart. The wires of a group are set side by
 * side in the order they already had, a gap between them and the group centred on where it was, and this is repeated until no wire
 * lies on another or nothing more can be done. Only the wires that had to move get a route of their own.
 */
export function spreadOverlaps(paths: Map<string, Point[]>, ends: Map<string, { a: Endpoint; b: Endpoint }>): SpreadResult {
  const moved = new Map<string, Lanes>();
  const current = new Map(paths);
  /** The lanes of the wire as it is drawn now, so that the pieces and the lanes are numbered alike. */
  const lanesOf = (wire: string): Lanes | undefined => {
    const path = current.get(wire);
    const e = ends.get(wire);
    return path && e ? (lanesFromPath(path) ?? lanesFromPath(wirePath(e.a, e.b, 0)) ?? [(e.a.point.y + e.b.point.y) / 2]) : undefined;
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const overlaps = findOverlaps(current);
    if (overlaps.length === 0) break;
    const first = overlaps[0]!;
    const group = groupOf(first, overlaps).sort((p, q) => p.at - q.at || p.range[0] - q.range[0] || p.range[1] - q.range[1] || p.wire.localeCompare(q.wire));
    const centre = group.reduce((sum, piece) => sum + piece.at, 0) / group.length;
    const before = new Map(current);
    const movedBefore = new Map(moved);
    const touched = new Set<string>();
    group.forEach((piece, i) => {
      const e = ends.get(piece.wire);
      const lanes = lanesOf(piece.wire);
      if (!e || !lanes || touched.has(piece.wire)) return;
      const value = centre + (i - (group.length - 1) / 2) * WIRE_GAP_MM;
      if (Math.abs(lanes[piece.segment - 1]! - value) < LEAVE_MM) return;
      const next = moveLane(e.a, e.b, lanes, piece.segment - 1, value);
      current.set(piece.wire, pathFromLanes(e.a, e.b, next));
      moved.set(piece.wire, next);
      touched.add(piece.wire);
    });
    if (findOverlaps(current).length >= overlaps.length) {
      for (const [wire, path] of before) current.set(wire, path);
      moved.clear();
      for (const [wire, lanes] of movedBefore) moved.set(wire, lanes);
      break;
    }
  }
  return { routes: moved, remaining: findOverlaps(current).length };
}
