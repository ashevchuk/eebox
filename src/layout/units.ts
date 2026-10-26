import { MODULE_UNIT_MM } from '../library/types';

/** The smallest width a module may have: below this a terminal would not fit on it. */
export const MIN_WIDTH_UNITS = 0.1;

/** Positions and widths that differ by less than this are the same: rounding must not make two modules overlap. */
export const LAYOUT_EPSILON_UNITS = 1e-4;

const DECIMALS = 10_000;

/** Widths and positions are kept to four decimals, 0.002 mm, which is far below anything a rail resolves. */
export const roundUnits = (units: number): number => Math.round(units * DECIMALS) / DECIMALS;

export const unitsFromMm = (mm: number): number => roundUnits(mm / MODULE_UNIT_MM);

export const mmFromUnits = (units: number): number => Math.round(units * MODULE_UNIT_MM * 100) / 100;

export const isWholeUnits = (units: number): boolean => Math.abs(units - Math.round(units)) < LAYOUT_EPSILON_UNITS;
