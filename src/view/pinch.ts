import type { Point } from './Camera';

export interface Pair {
  a: Point;
  b: Point;
}

const distance = (p: Pair): number => Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y);
export const centreOf = (p: Pair): Point => ({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 });

/** Two fingers closer together than this say nothing about a zoom. */
const MIN_DISTANCE_PX = 8;
/** One step may not zoom by more than this, whatever a noisy touch screen reports. */
const MAX_FACTOR = 4;

export interface PinchStep {
  /** How much to zoom, about the new centre. */
  factor: number;
  /** How far the centre between the fingers moved, which the view follows. */
  pan: Point;
}

/** What two fingers moving from one place to another do to the view: pan by the move of their centre, then zoom by the change of their distance. */
export function pinchStep(before: Pair, after: Pair): PinchStep | null {
  const was = distance(before);
  if (was < MIN_DISTANCE_PX) return null;
  const factor = Math.min(MAX_FACTOR, Math.max(1 / MAX_FACTOR, distance(after) / was));
  const [from, to] = [centreOf(before), centreOf(after)];
  return { factor, pan: { x: to.x - from.x, y: to.y - from.y } };
}
