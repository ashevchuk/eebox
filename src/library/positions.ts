/**
 * Where a terminal may stand along a module. A position is in units of 17.5 mm and names the
 * centre of the terminal: 0 is the centre of the first unit, 1 of the second, so 0.5 is the border
 * between them. Positions may be fractional, so that six terminals fit in two units.
 */

/** A terminal keeps this far from either edge of the module, which leaves room for its own width. */
export const TERMINAL_EDGE_MARGIN_UNITS = 0.15;

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export interface Range {
  min: number;
  max: number;
}

/** What a module of a fixed width allows, counted from the left. */
export function fixedRange(width: number): Range {
  return { min: round(-0.5 + TERMINAL_EDGE_MARGIN_UNITS), max: round(width - 0.5 - TERMINAL_EDGE_MARGIN_UNITS) };
}

/**
 * What a module that may be narrower allows: a position has to exist at the narrowest width, counted
 * from the left edge when it is not negative and from the right edge when it is.
 */
export function resizableRanges(narrowest: number): { left: Range; right: Range } {
  return {
    left: fixedRange(narrowest),
    right: { min: round(-narrowest - 0.5 + TERMINAL_EDGE_MARGIN_UNITS), max: round(-0.5 - TERMINAL_EDGE_MARGIN_UNITS) },
  };
}

/** The position as a distance from the left edge at the given width; a negative one counts from the right. */
export function leftPosition(unit: number, width: number, resizable: boolean): number {
  return resizable && unit < 0 ? width + unit : unit;
}

/** Says what is wrong with a position, or null when it is fine for a module of this width, and range if it has one. */
export function positionProblem(unit: number, narrowest: number | undefined, width: number): string | null {
  if (narrowest === undefined) {
    const { min, max } = fixedRange(width);
    return unit >= min && unit <= max ? null : `must be from ${min} to ${max}, counted from the left edge (0 is the centre of the first unit)`;
  }
  const { left, right } = resizableRanges(narrowest);
  const fits = (unit >= left.min && unit <= left.max) || (unit >= right.min && unit <= right.max);
  return fits
    ? null
    : `must exist at the narrowest width (${narrowest}): from ${left.min} to ${left.max} from the left edge, or from ${right.min} to ${right.max} from the right edge`;
}

export const isValidPosition = (unit: number, narrowest: number | undefined, width: number): boolean =>
  positionProblem(unit, narrowest, width) === null;
