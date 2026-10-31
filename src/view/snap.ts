import type { Rect } from './geometry';

/** A line a moving item is drawn to: `x` is a vertical line at that x, `y` a horizontal line at that y. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

export interface Snapped {
  x: number;
  y: number;
  guides: Guide[];
}

/** The three lines of a span that an edge or a centre can be drawn to. */
const linesOf = (start: number, size: number): number[] => [start, start + size / 2, start + size];

/**
 * Moves a rectangle so that one of its edges or its centre lies on an edge or the centre of another
 * rectangle, when that takes a shift of `threshold` or less, each axis on its own. The guides are the
 * lines it was drawn to, for the person to see.
 */
export function snapRect(rect: Rect, others: readonly Rect[], threshold: number): Snapped {
  const axisShift = (start: number, size: number, targets: number[]): { shift: number; at: number } | null => {
    let best: { shift: number; at: number } | null = null;
    for (const mine of linesOf(start, size)) {
      for (const target of targets) {
        const shift = target - mine;
        if (Math.abs(shift) <= threshold && (best === null || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at: target };
      }
    }
    return best;
  };
  const x = axisShift(rect.x, rect.width, others.flatMap((o) => linesOf(o.x, o.width)));
  const y = axisShift(rect.y, rect.height, others.flatMap((o) => linesOf(o.y, o.height)));
  return {
    x: rect.x + (x?.shift ?? 0),
    y: rect.y + (y?.shift ?? 0),
    guides: [...(x ? [{ axis: 'x' as const, at: x.at }] : []), ...(y ? [{ axis: 'y' as const, at: y.at }] : [])],
  };
}
