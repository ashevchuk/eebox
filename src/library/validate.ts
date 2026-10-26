import { MAX_RAILS, MAX_RAIL_LENGTH_UNITS } from '../layout/limits';
import {
  MODULE_KINDS,
  SCHEMA_VERSION,
  TRIP_CURVES,
  type EnclosureDef,
  type Library,
  type ModuleDef,
} from './types';

export interface ValidationError {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; library: Library }
  | { ok: false; errors: ValidationError[] };

export type FieldCheck = (value: unknown) => string | null;
export type FieldSpec = Record<string, { required: boolean; check: FieldCheck }>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const nonEmptyString: FieldCheck = (v) =>
  typeof v === 'string' && v.trim() !== '' ? null : 'must be a non-empty string';

export const identifier: FieldCheck = (v) =>
  typeof v === 'string' && ID_PATTERN.test(v)
    ? null
    : 'must start with a letter or digit and contain only letters, digits, ".", "_", "-"';

export const positiveInteger: FieldCheck = (v) =>
  Number.isInteger(v) && (v as number) > 0 ? null : 'must be a positive integer';

export const positiveNumber: FieldCheck = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : 'must be a positive number';

export const oneOf =
  (allowed: readonly unknown[]): FieldCheck =>
  (v) =>
    allowed.includes(v) ? null : `must be one of: ${allowed.join(', ')}`;

export const railLengthsCheck: FieldCheck = (v) =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= MAX_RAILS &&
  v.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_RAIL_LENGTH_UNITS)
    ? null
    : `must be 1 to ${MAX_RAILS} rail lengths, each a whole number of units from 1 to ${MAX_RAIL_LENGTH_UNITS}`;

export const MODULE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  kind: { required: true, check: oneOf(MODULE_KINDS) },
  name: { required: true, check: nonEmptyString },
  widthUnits: { required: true, check: positiveInteger },
  poles: { required: true, check: oneOf([1, 2, 3, 4]) },
  sku: { required: false, check: nonEmptyString },
  ratedCurrentA: { required: false, check: positiveNumber },
  curve: { required: false, check: oneOf(TRIP_CURVES) },
  breakingCapacityKA: { required: false, check: positiveNumber },
  residualCurrentMa: { required: false, check: positiveNumber },
};

const ENCLOSURE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  name: { required: true, check: nonEmptyString },
  railLengthsUnits: { required: true, check: railLengthsCheck },
};

const LIBRARY_SPEC: FieldSpec = {
  schemaVersion: {
    required: true,
    check: (v) =>
      v === SCHEMA_VERSION ? null : `unsupported schemaVersion, this build reads ${SCHEMA_VERSION}`,
  },
  id: { required: true, check: identifier },
  name: { required: true, check: nonEmptyString },
  modules: { required: true, check: (v) => (Array.isArray(v) ? null : 'must be an array') },
  enclosures: { required: false, check: (v) => (Array.isArray(v) ? null : 'must be an array') },
};

export function validateObject(
  raw: unknown,
  spec: FieldSpec,
  path: string,
  errors: ValidationError[],
): Record<string, unknown> | undefined {
  if (!isRecord(raw)) {
    errors.push({ path, message: 'must be an object' });
    return undefined;
  }
  const before = errors.length;
  const at = (key: string) => (path === '' ? key : `${path}.${key}`);
  for (const key of Object.keys(raw)) {
    if (!(key in spec)) errors.push({ path: at(key), message: 'unknown field' });
  }
  for (const [key, { required, check }] of Object.entries(spec)) {
    const value = raw[key];
    if (value === undefined) {
      if (required) errors.push({ path: at(key), message: 'is required' });
      continue;
    }
    const problem = check(value);
    if (problem) errors.push({ path: at(key), message: problem });
  }
  return errors.length === before ? raw : undefined;
}

export function validateList<T>(
  raw: unknown,
  spec: FieldSpec,
  path: string,
  errors: ValidationError[],
): T[] {
  const items: T[] = [];
  const seenIds = new Set<string>();
  if (!Array.isArray(raw)) return items;
  raw.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const item = validateObject(entry, spec, itemPath, errors);
    if (!item) return;
    const id = item.id as string;
    if (seenIds.has(id)) {
      errors.push({ path: `${itemPath}.id`, message: `duplicate id "${id}"` });
      return;
    }
    seenIds.add(id);
    items.push(item as T);
  });
  return items;
}

export function validateLibrary(raw: unknown): ParseResult {
  const errors: ValidationError[] = [];
  const root = validateObject(raw, LIBRARY_SPEC, '', errors);
  const rootRecord = isRecord(raw) ? raw : {};
  const modules = validateList<ModuleDef>(rootRecord.modules, MODULE_SPEC, 'modules', errors);
  const enclosures = validateList<EnclosureDef>(
    rootRecord.enclosures ?? [],
    ENCLOSURE_SPEC,
    'enclosures',
    errors,
  );
  if (!root || errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    library: {
      schemaVersion: SCHEMA_VERSION,
      id: root.id as string,
      name: root.name as string,
      modules,
      enclosures,
    },
  };
}

export function parseLibraryJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `invalid JSON: ${(e as Error).message}` }] };
  }
  return validateLibrary(raw);
}

export function exportLibraryJson(library: Library): string {
  return `${JSON.stringify(library, null, 2)}\n`;
}
