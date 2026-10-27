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
export const CONDUCTORS = ['L', 'L1', 'L2', 'L3', 'N', 'PE', 'PEN', 'C', 'DCP', 'DCN'] as const;
export type Conductor = (typeof CONDUCTORS)[number];
export type ConductorFamily = 'phase' | 'N' | 'PE' | 'PEN' | 'control';

/** A family that is several in one conductor: a PEN conductor is a neutral and a protective earth at once. */
export const COMBINED_FAMILIES: Partial<Record<ConductorFamily, readonly ConductorFamily[]>> = { PEN: ['N', 'PE'] };

/** Whether conductors of these families may be one net: a single family, or a combined one with the families it is made of, such as PEN with N and PE. */
export function familiesMayShareNet(families: ReadonlySet<ConductorFamily>): boolean {
  return families.size <= 1 || [...families].some((family) => [...families].every((other) => other === family || COMBINED_FAMILIES[family]?.includes(other)));
}

const CONTROL_CONDUCTORS: readonly Conductor[] = ['C', 'DCP', 'DCN'];

export const familyOf = (conductor: Conductor): ConductorFamily =>
  conductor === 'N' || conductor === 'PE' || conductor === 'PEN' ? conductor : CONTROL_CONDUCTORS.includes(conductor) ? 'control' : 'phase';

/**
 * Whether a wire may join two conductors: those of one family, or any pair when one is `C`, the
 * terminal of a contact, which switches whatever is wired to it.
 */
export const canJoin = (a: Conductor, b: Conductor): boolean => a === 'C' || b === 'C' || familyOf(a) === familyOf(b);

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

/** A group of terminals whose voltage a device senses; a coil is one with two terminals. */
export interface LogicInput {
  /** Terminal ids of the module, such as `top:A1`. */
  terminals: string[];
  /** `all`: every terminal carries voltage, on separate nets (a coil); `any`: at least one does. */
  when: 'all' | 'any';
}

/** A fact about the device that no terminal shows, such as a latched impulse relay or an elapsed timer; the person sets it on a placed copy. */
export interface LogicFlag {
  /** What the inspector calls it. */
  label: string;
  default: boolean;
}

/** Two terminals that are joined while an expression over the input names is true. */
export interface LogicContact {
  between: [string, string];
  closedWhen: string;
}

/** What a relay or contactor does with the voltages it senses, so the power view can follow its contacts. */
export interface ModuleLogic {
  inputs: Record<string, LogicInput>;
  /** Named on/off facts that contact expressions may use next to the inputs. */
  flags?: Record<string, LogicFlag>;
  contacts: LogicContact[];
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
  /** What one costs, in `currency`; entered by the person who owns the library, so a bill of materials can be priced. */
  price?: number;
  /** Short code of the currency of `price`, for example EUR; totals are kept apart per currency. */
  currency?: string;
  /** Replaces the terminals derived from `poles`. */
  terminals?: TerminalDef[];
  /** Required for, and only allowed on, kind "comb". */
  comb?: CombSpec;
  /**
   * Lets a placed copy have its own width, as devices of one kind differ between makes. Terminal
   * groups (those with a `count`) scale with it: a bar of 6 units with 12 terminals gets 18 at 9
   * units; single terminals stay single.
   */
  resizable?: ResizeSpec;
  /** Needs explicit `terminals`, which it refers to. */
  logic?: ModuleLogic;
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
