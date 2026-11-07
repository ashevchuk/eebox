export const RAIL_ORIENTATIONS = ['horizontal', 'vertical'] as const;
export type RailOrientation = (typeof RAIL_ORIENTATIONS)[number];

/**
 * A DIN rail on the panel; modules and combs refer to it by its index in `Panel.rails`. A horizontal
 * rail starts at `x` and lies on the line `y`; a vertical one lies on the line `x` and starts at `y`,
 * its modules turned a quarter turn clockwise so that their top faces right.
 */
export interface Rail {
  /** The plate the rail is fixed to. */
  plate: string;
  orientation: RailOrientation;
  /** Left end of a horizontal rail, or the centre line of a vertical one, in mm from the left edge of the working area. */
  x: number;
  /** Centre line of a horizontal rail, or the top end of a vertical one, in mm from the top of the working area. */
  y: number;
  lengthUnits: number;
  /** What the person calls this row; only when there is one. */
  label?: string;
}

export const isVertical = (rail: Rail | undefined): boolean => rail?.orientation === 'vertical';
