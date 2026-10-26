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
  'switch',
  'relay',
  'other',
] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

export const TRIP_CURVES = ['B', 'C', 'D', 'K', 'Z'] as const;
export type TripCurve = (typeof TRIP_CURVES)[number];

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
  modules: ModuleDef[];
  enclosures: EnclosureDef[];
}
