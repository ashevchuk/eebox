export const SCHEMA_VERSION = 1;
export const MODULE_UNIT_MM = 17.5;

export const MODULE_KINDS = [
  'breaker',
  'rcd',
  'rcbo',
  'contactor',
  'spd',
  'meter',
  'psu',
  'terminal',
  'busbar',
  'comb',
  'switch',
  'relay',
  'other',
] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/**
 * `L` is a phase that is decided by what feeds it; `L1`..`L3` are fixed phases. `C` is a control or
 * signal conductor, such as a relay contact; `DCP` and `DCN` are the plus and minus of a DC supply.
 */
export const CONDUCTORS = ['L', 'L1', 'L2', 'L3', 'N', 'PE', 'C', 'DCP', 'DCN'] as const;
export type Conductor = (typeof CONDUCTORS)[number];
export type ConductorFamily = 'phase' | 'N' | 'PE' | 'control';

const CONTROL_CONDUCTORS: readonly Conductor[] = ['C', 'DCP', 'DCN'];

export const familyOf = (conductor: Conductor): ConductorFamily =>
  conductor === 'N' || conductor === 'PE' ? conductor : CONTROL_CONDUCTORS.includes(conductor) ? 'control' : 'phase';

export const TERMINAL_SIDES = ['top', 'bottom'] as const;
export type TerminalSide = (typeof TERMINAL_SIDES)[number];

export const TRIP_CURVES = ['B', 'C', 'D', 'K', 'Z'] as const;
export type TripCurve = (typeof TRIP_CURVES)[number];

/**
 * One screw terminal, or `count` identical ones. Terminals that share a `net` are connected
 * inside the module (a terminal bar); without a net a terminal is isolated, like a pole of a breaker.
 */
export interface TerminalDef {
  name: string;
  conductor: Conductor;
  side: TerminalSide;
  net?: string;
  /** Horizontal position in module units; spread evenly over the width when omitted. */
  unit?: number;
  count?: number;
}

/** A comb bus bar: its pins repeat `pattern` along the span, one pin per module unit. */
export interface CombSpec {
  pattern: Conductor[];
  side: TerminalSide;
}

/** Widths a placed copy of a busbar or comb may take, in 17.5 mm units. */
export interface ResizeSpec {
  minUnits: number;
  maxUnits: number;
}

export interface ModuleDef {
  id: string;
  kind: ModuleKind;
  name: string;
  /** Width in 17.5 mm units. */
  widthUnits: number;
  poles: 1 | 2 | 3 | 4;
  sku?: string;
  ratedCurrentA?: number;
  curve?: TripCurve;
  breakingCapacityKA?: number;
  residualCurrentMa?: number;
  /** Replaces the terminals derived from `poles`. */
  terminals?: TerminalDef[];
  /** Required for, and only allowed on, kind "comb". */
  comb?: CombSpec;
  /**
   * Lets a placed copy have its own width. Terminal groups scale with it: a bar of 6 units with
   * 12 terminals gets 18 at 9 units. Only for busbars and combs.
   */
  resizable?: ResizeSpec;
}

export interface EnclosureDef {
  id: string;
  name: string;
  /** Usable length of each DIN rail, top to bottom, in 17.5 mm units. */
  railLengthsUnits: number[];
}

export interface Library {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  /** Free-form version of the library's content, shown so two copies can be told apart. */
  version?: string;
  vendor?: string;
  /** Where the library comes from; only http and https links are accepted. */
  url?: string;
  description?: string;
  modules: ModuleDef[];
  enclosures: EnclosureDef[];
}
