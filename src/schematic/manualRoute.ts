import type { Point } from '../view/Camera';
import { WIRE_STUB, type Endpoint } from './geometry';
import { MAX_ROUTE_LANES } from './model';

/**
 * A wire leaves a terminal straight up or down, so it is vertical, horizontal, vertical, ... and
 * vertical again into the other terminal. A route is stored as the coordinates of the interior
 * segments only: the y of the first horizontal one, the x of the next vertical one, and so on. The
 * ends of the wire come from the terminals, so a moved node never leaves a slanted piece behind.
 */
export type Lanes = number[];

/** Closer than this, two lanes are one. */
const SAME_MM = 0.5;

const directionOf = (end: Endpoint): 1 | -1 => (end.side === 'bottom' ? 1 : -1);

/** The nearest y a lane next to this terminal may have: the wire has to leave the terminal first. */
const bound = (end: Endpoint) => end.point.y + directionOf(end) * WIRE_STUB;

/** Clamps a lane that touches the terminal so the wire leaves it in the right direction. */
function clampTo(y: number, end: Endpoint): number {
  return directionOf(end) === 1 ? Math.max(y, bound(end)) : Math.min(y, bound(end));
}

/** The y-range a single lane has to lie in to serve both terminals; empty when there is none. */
function singleLaneRange(a: Endpoint, b: Endpoint): { lower: number; upper: number } {
  const lower = Math.max(...[a, b].filter((e) => directionOf(e) === 1).map(bound), -Infinity);
  const upper = Math.min(...[a, b].filter((e) => directionOf(e) === -1).map(bound), Infinity);
  return { lower, upper };
}

/** How far a bend is moved off a terminal when it cannot be taken away, because the wire could not go round without it. */
const NUDGE_MM = 40;

/** Where the vertical piece of a wire that has to go round is put between two terminals. */
function sideOf(a: Endpoint, b: Endpoint): number {
  return Math.abs(a.point.x - b.point.x) < 2 * SAME_MM ? a.point.x + NUDGE_MM : (a.point.x + b.point.x) / 2;
}

/** Lanes that are valid for these terminals: the first and the last lane leave them in the right direction. */
export function fitLanes(a: Endpoint, b: Endpoint, lanes: Lanes): Lanes {
  const result = [...lanes];
  if (result.length === 1) {
    const { lower, upper } = singleLaneRange(a, b);
    if (lower > upper) return [bound(a), sideOf(a, b), bound(b)];
    result[0] = Math.min(Math.max(result[0]!, lower), upper);
    return result;
  }
  result[0] = clampTo(result[0]!, a);
  result[result.length - 1] = clampTo(result[result.length - 1]!, b);
  return result;
}

/**
 * Removes the bends that have no length, so a lane dragged onto its neighbour does not leave a stub
 * behind. A bend at a terminal that the wire needs in order to get round is moved off it instead.
 */
export function simplifyLanes(a: Endpoint, b: Endpoint, lanes: Lanes): Lanes {
  const needsBend = (rest: Lanes) => {
    if (rest.length !== 1) return false;
    const { lower, upper } = singleLaneRange(a, b);
    return lower > upper;
  };
  let current = [...lanes];
  for (let changed = true; changed && current.length > 1; ) {
    changed = false;
    if (Math.abs(current[1]! - a.point.x) < SAME_MM) {
      if (needsBend(current.slice(2))) current[1] = a.point.x + NUDGE_MM;
      else {
        current = current.slice(2);
        changed = true;
      }
    } else if (Math.abs(current[current.length - 2]! - b.point.x) < SAME_MM) {
      if (needsBend(current.slice(0, -2))) current[current.length - 2] = b.point.x + NUDGE_MM;
      else {
        current = current.slice(0, -2);
        changed = true;
      }
    } else {
      for (let i = 0; i + 2 < current.length; i++) {
        if (Math.abs(current[i]! - current[i + 2]!) < SAME_MM) {
          current.splice(i + 1, 2);
          changed = true;
          break;
        }
      }
    }
  }
  return current;
}

/** The route as a path of points, ports included. */
export function pathFromLanes(a: Endpoint, b: Endpoint, lanes: Lanes): Point[] {
  const fitted = fitLanes(a, b, lanes);
  const points: Point[] = [a.point];
  let at: Point = a.point;
  fitted.forEach((value, i) => {
    at = i % 2 === 0 ? { x: at.x, y: value } : { x: value, y: at.y };
    points.push(at);
  });
  points.push({ x: b.point.x, y: at.y }, b.point);
  return dedupe(points);
}

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) > 1e-6);
}

/** The path without repeated points and without points in the middle of a straight run. */
export function normalisePath(path: Point[]): Point[] {
  const points: Point[] = [];
  for (const p of dedupe(path)) {
    const last = points[points.length - 1];
    const before = points[points.length - 2];
    if (last && before && ((Math.abs(before.x - last.x) < 1e-6 && Math.abs(last.x - p.x) < 1e-6) || (Math.abs(before.y - last.y) < 1e-6 && Math.abs(last.y - p.y) < 1e-6))) points.pop();
    points.push(p);
  }
  return points;
}

/** The lanes of a path that has the shape of a route, or undefined for any other path. */
export function lanesFromPath(path: Point[]): Lanes | undefined {
  const points = normalisePath(path);
  const segments = points.length - 1;
  if (segments < 3 || segments % 2 === 0) return undefined;
  const lanes: Lanes = [];
  for (let s = 0; s < segments; s++) {
    const p = points[s]!;
    const q = points[s + 1]!;
    const vertical = Math.abs(p.x - q.x) < 1e-6;
    const horizontal = Math.abs(p.y - q.y) < 1e-6;
    if (vertical === horizontal || vertical !== (s % 2 === 0)) return undefined;
    if (s >= 1 && s <= segments - 2) lanes.push(vertical ? p.x : p.y);
  }
  return lanes.length <= MAX_ROUTE_LANES ? lanes : undefined;
}

/** Index of the lane that a segment of the path is on, or undefined for the two pieces at the terminals. */
export function laneOfSegment(segment: number, segments: number): number | undefined {
  return segment >= 1 && segment <= segments - 2 ? segment - 1 : undefined;
}

/** Moves one lane to a new coordinate; the result is valid for the terminals. */
export function moveLane(a: Endpoint, b: Endpoint, lanes: Lanes, index: number, value: number): Lanes {
  const next = [...lanes];
  next[index] = value;
  return simplifyLanes(a, b, fitLanes(a, b, next));
}

/**
 * Drags the piece of the wire at a terminal sideways, which gives the wire a jog: it goes down (or up)
 * to the height where it was taken hold of, across to `x`, and on along what was the first (or last)
 * lane. Without a height the jog is made as near the terminal as the wire may turn.
 */
export function insertJog(a: Endpoint, b: Endpoint, lanes: Lanes, atStart: boolean, x: number, at?: number): Lanes {
  const end = atStart ? a : b;
  const dir = directionOf(end);
  const near = bound(end);
  const index = atStart ? 0 : lanes.length - 1;
  const next = lanes[index]!;
  const farthest = dir === 1 ? Math.max(next - WIRE_STUB, near) : Math.min(next + WIRE_STUB, near);
  const wanted = at ?? near;
  const jog = dir === 1 ? Math.min(Math.max(wanted, near), farthest) : Math.max(Math.min(wanted, near), farthest);
  const after = dir === 1 ? Math.max(next, jog + WIRE_STUB) : Math.min(next, jog - WIRE_STUB);
  return simplifyLanes(a, b, fitLanes(a, b, atStart ? [jog, x, after, ...lanes.slice(1)] : [...lanes.slice(0, index), after, x, jog]));
}
