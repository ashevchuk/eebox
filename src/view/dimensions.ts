import type { Bounds, Point } from './Camera';
import type { Rect } from './geometry';

/** A measured distance between a selected thing and the nearest one beside it, as a line and its length in mm. */
export interface Dimension {
  from: Point;
  to: Point;
  mm: number;
}

/** Distances smaller than this are two things standing edge to edge, which needs no line. */
const MIN_SHOWN_MM = 0.5;
/** Distances larger than this are not about a neighbour any more. */
export const MAX_SHOWN_MM = 1500;

/** The length that the spans [a0, a1] and [b0, b1] share, and where its middle is; null when they do not overlap. */
function sharedSpan(a0: number, a1: number, b0: number, b1: number): { middle: number } | null {
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  return end > start ? { middle: (start + end) / 2 } : null;
}

/**
 * The distances from a box to what is next to it in each direction: the nearest other box that
 * shares some of its height (to the left and the right) or width (above and below), and, where there is
 * none to the left or above, the edge of the plate at `corner`. A distance that is nothing or too
 * large to be about a neighbour is left out.
 */
export function dimensionsOf(box: Rect, others: readonly Rect[], corner: Point): Dimension[] {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const found: Dimension[] = [];
  const keep = (from: Point, to: Point, mm: number) => {
    if (mm >= MIN_SHOWN_MM && mm <= MAX_SHOWN_MM) found.push({ from, to, mm });
  };
  const nearest = (direction: 'left' | 'right' | 'up' | 'down'): void => {
    let best: { mm: number; from: Point; to: Point } | null = null;
    for (const o of others) {
      const across =
        direction === 'left' || direction === 'right' ? sharedSpan(box.y, bottom, o.y, o.y + o.height) : sharedSpan(box.x, right, o.x, o.x + o.width);
      if (!across) continue;
      const mm =
        direction === 'right' ? o.x - right : direction === 'left' ? box.x - (o.x + o.width) : direction === 'down' ? o.y - bottom : box.y - (o.y + o.height);
      if (mm < 0 || (best && mm >= best.mm)) continue;
      const m = across.middle;
      const [from, to]: [Point, Point] =
        direction === 'right' ? [{ x: right, y: m }, { x: o.x, y: m }]
        : direction === 'left' ? [{ x: o.x + o.width, y: m }, { x: box.x, y: m }]
        : direction === 'down' ? [{ x: m, y: bottom }, { x: m, y: o.y }]
        : [{ x: m, y: o.y + o.height }, { x: m, y: box.y }];
      best = { mm, from, to };
    }
    if (best) keep(best.from, best.to, best.mm);
    else if (direction === 'left' && box.x > corner.x) keep({ x: corner.x, y: box.y + box.height / 2 }, { x: box.x, y: box.y + box.height / 2 }, box.x - corner.x);
    else if (direction === 'up' && box.y > corner.y) keep({ x: box.x + box.width / 2, y: corner.y }, { x: box.x + box.width / 2, y: box.y }, box.y - corner.y);
  };
  for (const direction of ['left', 'right', 'up', 'down'] as const) nearest(direction);
  return found;
}

/** The box that holds all the lines, for a drawing that has to include them. */
export function dimensionBounds(dimensions: readonly Dimension[]): Bounds | null {
  if (dimensions.length === 0) return null;
  const points = dimensions.flatMap((d) => [d.from, d.to]);
  return { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) };
}
