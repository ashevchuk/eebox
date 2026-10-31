/** A DIN rail on the panel; modules and combs refer to it by its index in `Panel.rails`. */
export interface Rail {
  /** Left end of the rail, in mm from the left edge of the working area. */
  x: number;
  /** Centre line of the rail, in mm from the top of the working area. */
  y: number;
  lengthUnits: number;
  /** What the person calls this row; only when there is one. */
  label?: string;
}
