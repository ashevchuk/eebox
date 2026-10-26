import {
  CROSS_SECTIONS_MM2,
  INSTALL_METHODS,
  parseCableSettings,
  type CableSettings,
  type InstallMethod,
  type LoadedConductors,
} from '../electrical/cables';
import { TRIP_CURVES, type TripCurve } from '../library/types';

export const LOADED_CONDUCTOR_COUNTS: readonly LoadedConductors[] = [2, 3];

export type ScalarField = 'lighting' | 'other' | 'resistivity' | 'reactance' | 'faultVoltage';

/** What is typed in the form: every number as the text the person entered. */
export interface CableDraft {
  ampacity: Record<InstallMethod, Record<LoadedConductors, string[]>>;
  scalars: Record<ScalarField, string>;
  trip: Record<TripCurve, string>;
}

export const ampacityId = (method: InstallMethod, loaded: LoadedConductors, index: number) => `a:${method}:${loaded}:${index}`;
export const scalarId = (field: ScalarField) => `f:${field}`;
export const tripId = (curve: TripCurve) => `t:${curve}`;

const text = (value: number) => String(value);

export function draftOf(settings: CableSettings): CableDraft {
  const ampacity = {} as CableDraft['ampacity'];
  for (const method of INSTALL_METHODS) {
    ampacity[method] = { 2: settings.ampacity[method][2].map(text), 3: settings.ampacity[method][3].map(text) };
  }
  return {
    ampacity,
    scalars: {
      lighting: text(settings.voltageDropLimitPercent.lighting),
      other: text(settings.voltageDropLimitPercent.other),
      resistivity: text(settings.resistivityOhmMm2PerM),
      reactance: text(settings.reactanceOhmPerM),
      faultVoltage: text(settings.faultVoltageV),
    },
    trip: Object.fromEntries(TRIP_CURVES.map((curve) => [curve, text(settings.tripMultiples[curve])])) as CableDraft['trip'],
  };
}

/** A number as people type it: a decimal comma is fine, blank or anything else is not a number. */
export function numberOf(raw: string): number {
  const cleaned = raw.trim().replace(',', '.');
  return cleaned === '' ? Number.NaN : Number(cleaned);
}

export interface DraftProblem {
  /** Id of the cell or field that is wrong. */
  id: string;
  message: string;
}

export interface DraftCheck {
  /** The settings the draft stands for; null while any of it is wrong. */
  settings: CableSettings | null;
  problems: DraftProblem[];
}

function candidateOf(draft: CableDraft): unknown {
  const n = (value: string) => numberOf(value);
  const ampacity: Record<string, Record<number, number[]>> = {};
  for (const method of INSTALL_METHODS) {
    ampacity[method] = { 2: draft.ampacity[method][2].map(n), 3: draft.ampacity[method][3].map(n) };
  }
  return {
    ampacity,
    voltageDropLimitPercent: { lighting: n(draft.scalars.lighting), other: n(draft.scalars.other) },
    resistivityOhmMm2PerM: n(draft.scalars.resistivity),
    reactanceOhmPerM: n(draft.scalars.reactance),
    faultVoltageV: n(draft.scalars.faultVoltage),
    tripMultiples: Object.fromEntries(TRIP_CURVES.map((curve) => [curve, n(draft.trip[curve])])),
  };
}

const SCALAR_OF_PATH: Record<string, ScalarField> = {
  'voltageDropLimitPercent.lighting': 'lighting',
  'voltageDropLimitPercent.other': 'other',
  resistivityOhmMm2PerM: 'resistivity',
  reactanceOhmPerM: 'reactance',
  faultVoltageV: 'faultVoltage',
};

/** The cells of one row that break the rule: each is a number above 0 and larger than the one before it. */
function badCells(values: number[]): Array<[number, string]> {
  return values.flatMap((v, i): Array<[number, string]> => {
    if (!Number.isFinite(v) || v <= 0) return [[i, 'must be a number above 0']];
    if (i > 0 && v <= values[i - 1]!) return [[i, 'must be larger than the cell to its left']];
    return [];
  });
}

/** Checks the draft with the same rules as the file parser, and says which cell or field each problem is in. */
export function checkDraft(draft: CableDraft): DraftCheck {
  const candidate = candidateOf(draft) as { ampacity: Record<InstallMethod, Record<LoadedConductors, number[]>> };
  const parsed = parseCableSettings(JSON.stringify(candidate));
  if (parsed.ok) return { settings: parsed.settings, problems: [] };

  const problems: DraftProblem[] = [];
  for (const { path, message } of parsed.errors) {
    const scalar = SCALAR_OF_PATH[path];
    if (scalar) {
      problems.push({ id: scalarId(scalar), message });
      continue;
    }
    const trip = /^tripMultiples\.(\w+)$/.exec(path);
    if (trip) {
      problems.push({ id: tripId(trip[1] as TripCurve), message });
      continue;
    }
    const row = /^ampacity\.(\w+)\.(\d)$/.exec(path);
    if (row) {
      const method = row[1] as InstallMethod;
      const loaded = Number(row[2]) as LoadedConductors;
      const cells = badCells(candidate.ampacity[method][loaded]);
      if (cells.length === 0) problems.push({ id: ampacityId(method, loaded, 0), message });
      for (const [index, why] of cells) problems.push({ id: ampacityId(method, loaded, index), message: why });
      continue;
    }
    problems.push({ id: '', message: `${path || '(settings)'}: ${message}` });
  }
  return { settings: null, problems };
}

/** Ids of the cells and fields that differ from the given settings, so the form can show what was changed. */
export function changedIds(draft: CableDraft, reference: CableSettings): Set<string> {
  const base = draftOf(reference);
  const changed = new Set<string>();
  const differs = (a: string, b: string) => !(numberOf(a) === numberOf(b));
  for (const method of INSTALL_METHODS) {
    for (const loaded of LOADED_CONDUCTOR_COUNTS) {
      draft.ampacity[method][loaded].forEach((value, i) => {
        if (differs(value, base.ampacity[method][loaded][i]!)) changed.add(ampacityId(method, loaded, i));
      });
    }
  }
  for (const field of Object.keys(draft.scalars) as ScalarField[]) if (differs(draft.scalars[field], base.scalars[field])) changed.add(scalarId(field));
  for (const curve of TRIP_CURVES) if (differs(draft.trip[curve], base.trip[curve])) changed.add(tripId(curve));
  return changed;
}

export const SECTION_COLUMNS = CROSS_SECTIONS_MM2;
