import { TRIP_CURVES, type TripCurve } from '../library/types';
import type { ValidationError } from '../library/validate';

export const INSTALL_METHODS = ['B1', 'B2', 'C', 'E'] as const;
export type InstallMethod = (typeof INSTALL_METHODS)[number];

export const CROSS_SECTIONS_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35] as const;

/** Conductors that carry current: a single-phase circuit has two, a balanced three-phase one has three. */
export type LoadedConductors = 2 | 3;
const LOADED_CONDUCTORS: readonly LoadedConductors[] = [2, 3];

/** Amperes per cross-section, in the order of `CROSS_SECTIONS_MM2`. */
export type AmpacityTable = Record<InstallMethod, Record<LoadedConductors, readonly number[]>>;

export interface CableSettings {
  ampacity: AmpacityTable;
  /** Allowed voltage drop of the final circuit, as a percentage of the phase voltage. */
  voltageDropLimitPercent: { lighting: number; other: number };
  /** Resistivity of the conductor at operating temperature, in ohm square millimetres per metre. */
  resistivityOhmMm2PerM: number;
  /** Reactance of the cable per metre, in ohms. */
  reactanceOhmPerM: number;
  /** Phase-to-neutral voltage that drives the fault current in the loop check, in volts. */
  faultVoltageV: number;
  /** The multiple of its rating at which a breaker of each curve trips at once, for the loop check. */
  tripMultiples: Record<TripCurve, number>;
}

/**
 * Copper conductors with PVC insulation at 30 °C ambient, as in IEC 60364-5-52; the voltage drop
 * limits are the 3 % for lighting and 5 % for other uses it recommends, the resistivity is that of
 * copper at 70 °C and the reactance the simplified 0.08 mOhm/m. These values were entered without
 * the standard at hand, so they can be replaced in the settings.
 */
export const DEFAULT_CABLE_SETTINGS: CableSettings = {
  ampacity: {
    B1: { 2: [17.5, 24, 32, 41, 57, 76, 101, 125], 3: [15.5, 21, 28, 36, 50, 68, 89, 110] },
    B2: { 2: [16.5, 23, 30, 38, 52, 69, 90, 111], 3: [15, 20, 27, 34, 46, 62, 80, 99] },
    C: { 2: [19.5, 27, 36, 46, 63, 85, 112, 138], 3: [17.5, 24, 32, 41, 57, 76, 96, 119] },
    E: { 2: [22, 30, 40, 51, 70, 94, 119, 148], 3: [18.5, 25, 34, 43, 60, 80, 101, 126] },
  },
  voltageDropLimitPercent: { lighting: 3, other: 5 },
  resistivityOhmMm2PerM: 0.0225,
  reactanceOhmPerM: 0.00008,
  faultVoltageV: 230,
  tripMultiples: { B: 5, C: 10, D: 20, K: 14, Z: 3 },
};

export const CABLE_TABLE_NOTE =
  'Ampacities (copper, PVC, 30 °C, 1.5 to 35 mm²) match IEC 60364-5-52:2009 tables B.52.2, B.52.4 and B.52.10; resistivity, reactance, voltage drop limits and trip multiples are not verified. Replace them in File > Cable settings.';

export function ampacityA(
  method: InstallMethod,
  loaded: LoadedConductors,
  sectionMm2: number,
  settings: CableSettings = DEFAULT_CABLE_SETTINGS,
): number | undefined {
  const index = (CROSS_SECTIONS_MM2 as readonly number[]).indexOf(sectionMm2);
  return index < 0 ? undefined : settings.ampacity[method][loaded][index];
}

/**
 * The smallest listed cross-section that carries `currentA` and that `accepts`, or undefined when
 * even the largest does not.
 */
export function minimumSectionMm2(
  method: InstallMethod,
  loaded: LoadedConductors,
  currentA: number,
  settings: CableSettings = DEFAULT_CABLE_SETTINGS,
  accepts: (sectionMm2: number) => boolean = () => true,
): number | undefined {
  return CROSS_SECTIONS_MM2.find((section) => (ampacityA(method, loaded, section, settings) ?? 0) >= currentA && accepts(section));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

function unknownKeys(value: Record<string, unknown>, known: readonly string[], path: string, errors: ValidationError[]): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) errors.push({ path: path ? `${path}.${key}` : key, message: 'is not a known setting' });
  }
}

function parseAmpacity(raw: unknown, errors: ValidationError[]): AmpacityTable | undefined {
  if (!isRecord(raw)) {
    errors.push({ path: 'ampacity', message: 'must be an object with a table per laying method' });
    return undefined;
  }
  unknownKeys(raw, INSTALL_METHODS, 'ampacity', errors);
  const table = {} as Record<InstallMethod, Record<LoadedConductors, readonly number[]>>;
  let ok = true;
  for (const method of INSTALL_METHODS) {
    const perMethod = raw[method];
    if (!isRecord(perMethod)) {
      errors.push({ path: `ampacity.${method}`, message: 'is missing' });
      ok = false;
      continue;
    }
    unknownKeys(perMethod, LOADED_CONDUCTORS.map(String), `ampacity.${method}`, errors);
    const row = {} as Record<LoadedConductors, readonly number[]>;
    for (const loaded of LOADED_CONDUCTORS) {
      const path = `ampacity.${method}.${loaded}`;
      const values = perMethod[String(loaded)];
      const valid =
        Array.isArray(values) &&
        values.length === CROSS_SECTIONS_MM2.length &&
        values.every(positive) &&
        values.every((v, i) => i === 0 || v > (values[i - 1] as number));
      if (!valid) {
        errors.push({ path, message: `must list ${CROSS_SECTIONS_MM2.length} growing amperes, one per cross-section ${CROSS_SECTIONS_MM2.join(', ')} mm2` });
        ok = false;
      } else {
        row[loaded] = values as number[];
      }
    }
    table[method] = row;
  }
  return ok ? table : undefined;
}

/** Reads the settings from text; a setting that is missing, unknown or out of range is an error with its path. */
export function parseCableSettings(text: string): { ok: true; settings: CableSettings } | { ok: false; errors: ValidationError[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `invalid JSON: ${(e as Error).message}` }] };
  }
  if (!isRecord(raw)) return { ok: false, errors: [{ path: '', message: 'must be an object' }] };
  const errors: ValidationError[] = [];
  unknownKeys(raw, ['ampacity', 'voltageDropLimitPercent', 'resistivityOhmMm2PerM', 'reactanceOhmPerM', 'faultVoltageV', 'tripMultiples'], '', errors);
  const ampacity = parseAmpacity(raw.ampacity, errors);

  const limits = raw.voltageDropLimitPercent;
  let limit: CableSettings['voltageDropLimitPercent'] | undefined;
  if (!isRecord(limits)) {
    errors.push({ path: 'voltageDropLimitPercent', message: 'must be an object with lighting and other' });
  } else {
    unknownKeys(limits, ['lighting', 'other'], 'voltageDropLimitPercent', errors);
    const inRange = (v: unknown): v is number => positive(v) && v <= 100;
    for (const key of ['lighting', 'other'] as const) {
      if (!inRange(limits[key])) errors.push({ path: `voltageDropLimitPercent.${key}`, message: 'must be above 0 and at most 100' });
    }
    if (inRange(limits.lighting) && inRange(limits.other)) limit = { lighting: limits.lighting, other: limits.other };
  }
  if (!positive(raw.resistivityOhmMm2PerM)) errors.push({ path: 'resistivityOhmMm2PerM', message: 'must be above 0' });
  if (typeof raw.reactanceOhmPerM !== 'number' || !Number.isFinite(raw.reactanceOhmPerM) || raw.reactanceOhmPerM < 0) {
    errors.push({ path: 'reactanceOhmPerM', message: 'must be 0 or more' });
  }
  if (!positive(raw.faultVoltageV) || raw.faultVoltageV > 1000) {
    errors.push({ path: 'faultVoltageV', message: 'must be above 0 and at most 1000' });
  }
  const multiples = raw.tripMultiples;
  let tripMultiples: CableSettings['tripMultiples'] | undefined;
  if (!isRecord(multiples)) {
    errors.push({ path: 'tripMultiples', message: `must be an object with ${TRIP_CURVES.join(', ')}` });
  } else {
    unknownKeys(multiples, TRIP_CURVES, 'tripMultiples', errors);
    for (const curve of TRIP_CURVES) {
      if (!positive(multiples[curve]) || multiples[curve] > 100) errors.push({ path: `tripMultiples.${curve}`, message: 'must be above 0 and at most 100' });
    }
    if (TRIP_CURVES.every((curve) => positive(multiples[curve]) && multiples[curve] <= 100)) tripMultiples = multiples as CableSettings['tripMultiples'];
  }
  if (errors.length > 0 || !ampacity || !limit || !tripMultiples) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      ampacity,
      voltageDropLimitPercent: limit,
      resistivityOhmMm2PerM: raw.resistivityOhmMm2PerM as number,
      reactanceOhmPerM: raw.reactanceOhmPerM as number,
      faultVoltageV: raw.faultVoltageV as number,
      tripMultiples,
    },
  };
}

/** The text the settings dialog shows; each row of amperes stays on one line. */
export function cableSettingsToText(settings: CableSettings): string {
  return JSON.stringify(settings, null, 2).replace(/\[[^\]]*\]/g, (list) => list.replace(/\s+/g, ' '));
}
