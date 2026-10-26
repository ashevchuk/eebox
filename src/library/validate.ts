import { isStoredLabel } from '../layout/labels';
import { MAX_LABEL_LENGTH, MAX_RAILS, MAX_RAIL_LENGTH_UNITS } from '../layout/limits';
import { MIN_WIDTH_UNITS } from '../layout/units';
import { parseExpression } from './logicExpression';
import { positionProblem } from './positions';
import {
  CONDUCTORS,
  MODULE_KINDS,
  SCHEMA_VERSION,
  TERMINAL_SIDES,
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

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const nonEmptyString: FieldCheck = (v) =>
  typeof v === 'string' && v.trim() !== '' ? null : 'must be a non-empty string';

export const identifier: FieldCheck = (v) =>
  typeof v === 'string' && ID_PATTERN.test(v)
    ? null
    : 'must start with a letter or digit and contain only letters, digits, ".", "_", "-"';

export const labelCheck: FieldCheck = (v) =>
  isStoredLabel(v)
    ? null
    : `must be 1 to ${MAX_LABEL_LENGTH} characters, without leading or trailing spaces or control characters`;

export const positiveInteger: FieldCheck = (v) =>
  Number.isInteger(v) && (v as number) > 0 ? null : 'must be a positive integer';

/** A width in units of 17.5 mm; it may be a fraction, since a relay is 22.5 mm and a block 29 mm. */
export const widthCheck: FieldCheck = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_WIDTH_UNITS && v <= MAX_RAIL_LENGTH_UNITS
    ? null
    : `must be a number of units from ${MIN_WIDTH_UNITS} to ${MAX_RAIL_LENGTH_UNITS} (1 unit is 17.5 mm)`;

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
  v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= MAX_RAIL_LENGTH_UNITS)
    ? null
    : `must be 1 to ${MAX_RAILS} rail lengths, each a number of units from 1 to ${MAX_RAIL_LENGTH_UNITS}`;

export const MAX_PRICE = 10_000_000;
export const CURRENCY_PATTERN = /^[A-Za-z]{1,8}$/;
const priceCheck: FieldCheck = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE ? null : `must be a number from 0 to ${MAX_PRICE}`;
const currencyCheck: FieldCheck = (v) =>
  typeof v === 'string' && CURRENCY_PATTERN.test(v) ? null : 'must be 1 to 8 letters, such as EUR';

export const MODULE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  kind: { required: true, check: oneOf(MODULE_KINDS) },
  name: { required: true, check: nonEmptyString },
  widthUnits: { required: true, check: widthCheck },
  poles: { required: true, check: oneOf([1, 2, 3, 4]) },
  sku: { required: false, check: nonEmptyString },
  ratedCurrentA: { required: false, check: positiveNumber },
  curve: { required: false, check: oneOf(TRIP_CURVES) },
  breakingCapacityKA: { required: false, check: positiveNumber },
  residualCurrentMa: { required: false, check: positiveNumber },
  price: { required: false, check: priceCheck },
  currency: { required: false, check: currencyCheck },
  terminals: { required: false, check: (v) => (Array.isArray(v) ? null : 'must be an array') },
  comb: { required: false, check: (v) => (isRecord(v) ? null : 'must be an object') },
  resizable: { required: false, check: (v) => (isRecord(v) ? null : 'must be an object') },
  logic: { required: false, check: (v) => (isRecord(v) ? null : 'must be an object') },
};

export const MAX_LOGIC_INPUTS = 8;
export const MAX_LOGIC_CONTACTS = 32;
export const MAX_INPUT_TERMINALS = 8;

export const LOGIC_SPEC: FieldSpec = {
  inputs: { required: true, check: (v) => (isRecord(v) ? null : 'must be an object') },
  contacts: { required: true, check: (v) => (Array.isArray(v) ? null : 'must be an array') },
};
export const LOGIC_INPUT_SPEC: FieldSpec = {
  terminals: { required: true, check: (v) => (Array.isArray(v) ? null : 'must be an array') },
  when: { required: true, check: oneOf(['all', 'any']) },
};
export const LOGIC_CONTACT_SPEC: FieldSpec = {
  between: { required: true, check: (v) => (Array.isArray(v) && v.length === 2 ? null : 'must list two terminals') },
  closedWhen: { required: true, check: nonEmptyString },
};

export const MAX_TERMINALS_PER_MODULE = 64;
export const MAX_TERMINAL_GROUP = 48;
export const MAX_COMB_PATTERN = 8;

const finiteNumber: FieldCheck = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : 'must be a number');

export const TERMINAL_SPEC: FieldSpec = {
  name: { required: true, check: identifier },
  conductor: { required: true, check: oneOf(CONDUCTORS) },
  side: { required: true, check: oneOf(TERMINAL_SIDES) },
  net: { required: false, check: identifier },
  unit: { required: false, check: finiteNumber },
  count: {
    required: false,
    check: (v) =>
      Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_TERMINAL_GROUP
        ? null
        : `must be a whole number from 1 to ${MAX_TERMINAL_GROUP}`,
  },
};

const boundedUnits: FieldCheck = widthCheck;

export const RESIZE_SPEC: FieldSpec = {
  minUnits: { required: true, check: boundedUnits },
  maxUnits: { required: true, check: boundedUnits },
};

export const COMB_SPEC: FieldSpec = {
  pattern: {
    required: true,
    check: (v) =>
      Array.isArray(v) &&
      v.length >= 1 &&
      v.length <= MAX_COMB_PATTERN &&
      v.every((c) => (CONDUCTORS as readonly unknown[]).includes(c))
        ? null
        : `must list 1 to ${MAX_COMB_PATTERN} conductors out of: ${CONDUCTORS.join(', ')}`,
  },
  side: { required: true, check: oneOf(TERMINAL_SIDES) },
};

/** Validates the width range of a resizable module and returns its narrowest width, if it has a valid one. */
function checkResizable(def: Record<string, unknown>, path: string, errors: ValidationError[]): number | undefined {
  if (def.resizable === undefined) return undefined;
  const spec = validateObject(def.resizable, RESIZE_SPEC, `${path}.resizable`, errors);
  if (!spec) return undefined;
  const { minUnits, maxUnits } = spec as { minUnits: number; maxUnits: number };
  if (maxUnits < minUnits) {
    errors.push({ path: `${path}.resizable.maxUnits`, message: 'must not be less than minUnits' });
    return undefined;
  }
  const width = def.widthUnits as number;
  if (width < minUnits || width > maxUnits) {
    errors.push({ path: `${path}.widthUnits`, message: 'must lie within the resizable range' });
  }
  return minUnits;
}

/** A position is a number of units from the left edge, or from the right when it is negative on a resizable module. */
function checkUnit(unit: number, narrowest: number | undefined, width: number, path: string, errors: ValidationError[]): void {
  const problem = positionProblem(unit, narrowest, width);
  if (problem) errors.push({ path, message: problem });
}

/** Checks that need more than one field of a module: terminals against width, combs against kind. */
export function validateModuleDeep(
  def: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
): void {
  const isComb = def.kind === 'comb';
  if (isComb && def.comb === undefined) errors.push({ path: `${path}.comb`, message: 'is required for kind "comb"' });
  if (!isComb && def.comb !== undefined) errors.push({ path: `${path}.comb`, message: 'is only allowed for kind "comb"' });
  if (isComb && def.terminals !== undefined) errors.push({ path: `${path}.terminals`, message: 'a comb has no terminals' });
  if (def.comb !== undefined) validateObject(def.comb, COMB_SPEC, `${path}.comb`, errors);
  const narrowest = checkResizable(def, path, errors);
  if (def.logic !== undefined && !Array.isArray(def.terminals)) {
    errors.push({ path: `${path}.logic`, message: 'needs explicit terminals to refer to' });
  }
  if (!Array.isArray(def.terminals)) return;

  const width = def.widthUnits as number;
  const ids = new Set<string>();
  let total = 0;
  def.terminals.forEach((entry, index) => {
    const entryPath = `${path}.terminals[${index}]`;
    const t = validateObject(entry, TERMINAL_SPEC, entryPath, errors);
    if (!t) return;
    const count = (t.count as number | undefined) ?? 1;
    total += count;
    if (t.unit !== undefined && count > 1) errors.push({ path: `${entryPath}.unit`, message: 'cannot be combined with count' });
    if (t.unit !== undefined) checkUnit(t.unit as number, narrowest, width, `${entryPath}.unit`, errors);
    for (let i = 0; i < count; i++) {
      const name = count > 1 ? `${t.name as string}${i + 1}` : (t.name as string);
      const id = `${t.side as string}:${name}`;
      if (ids.has(id)) errors.push({ path: `${entryPath}.name`, message: `duplicate terminal "${name}" on the ${t.side as string} side` });
      ids.add(id);
    }
  });
  if (total > MAX_TERMINALS_PER_MODULE) {
    errors.push({ path: `${path}.terminals`, message: `at most ${MAX_TERMINALS_PER_MODULE} terminals per module` });
  }
  if (def.logic !== undefined) validateLogic(def.logic, ids, `${path}.logic`, errors);
}

function validateLogic(raw: unknown, terminalIds: Set<string>, path: string, errors: ValidationError[]): void {
  const logic = validateObject(raw, LOGIC_SPEC, path, errors);
  if (!logic) return;
  const inputs = logic.inputs as Record<string, unknown>;
  const names = Object.keys(inputs);
  if (names.length > MAX_LOGIC_INPUTS) errors.push({ path: `${path}.inputs`, message: `at most ${MAX_LOGIC_INPUTS} inputs` });
  const knownTerminal = (id: unknown, at: string) => {
    if (typeof id !== 'string' || !terminalIds.has(id)) errors.push({ path: at, message: `"${String(id)}" is not a terminal of this module` });
  };
  for (const name of names) {
    const inputPath = `${path}.inputs.${name}`;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) errors.push({ path: inputPath, message: 'the name must be letters, digits and _, starting with a letter' });
    const input = validateObject(inputs[name], LOGIC_INPUT_SPEC, inputPath, errors);
    if (!input) continue;
    const terminals = input.terminals as unknown[];
    if (terminals.length < 1 || terminals.length > MAX_INPUT_TERMINALS) {
      errors.push({ path: `${inputPath}.terminals`, message: `must list 1 to ${MAX_INPUT_TERMINALS} terminals` });
    }
    terminals.forEach((id, i) => knownTerminal(id, `${inputPath}.terminals[${i}]`));
  }
  const contacts = logic.contacts as unknown[];
  if (contacts.length > MAX_LOGIC_CONTACTS) errors.push({ path: `${path}.contacts`, message: `at most ${MAX_LOGIC_CONTACTS} contacts` });
  contacts.forEach((entry, index) => {
    const contactPath = `${path}.contacts[${index}]`;
    const contact = validateObject(entry, LOGIC_CONTACT_SPEC, contactPath, errors);
    if (!contact) return;
    (contact.between as unknown[]).forEach((id, i) => knownTerminal(id, `${contactPath}.between[${i}]`));
    const parsed = parseExpression(contact.closedWhen as string);
    if (!parsed.ok) {
      errors.push({ path: `${contactPath}.closedWhen`, message: parsed.message });
      return;
    }
    for (const name of parsed.names) {
      if (!names.includes(name)) errors.push({ path: `${contactPath}.closedWhen`, message: `"${name}" is not an input` });
    }
  });
}

export const ENCLOSURE_SPEC: FieldSpec = {
  id: { required: true, check: identifier },
  name: { required: true, check: nonEmptyString },
  railLengthsUnits: { required: true, check: railLengthsCheck },
};

export const MAX_VERSION_LENGTH = 40;
export const MAX_URL_LENGTH = 300;
export const MAX_DESCRIPTION_LENGTH = 300;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const versionCheck: FieldCheck = (v) =>
  typeof v === 'string' && v.trim() === v && v.length >= 1 && v.length <= MAX_VERSION_LENGTH && !CONTROL_CHARACTERS.test(v)
    ? null
    : `must be 1 to ${MAX_VERSION_LENGTH} characters, without control characters or surrounding spaces`;

/** Shown as a link, so only the web schemes are allowed: no javascript: or data: URLs. */
export const urlCheck: FieldCheck = (v) => {
  if (typeof v !== 'string' || v.length > MAX_URL_LENGTH || /\s/.test(v) || CONTROL_CHARACTERS.test(v)) {
    return `must be an http or https address of at most ${MAX_URL_LENGTH} characters, without spaces`;
  }
  try {
    const { protocol } = new URL(v);
    return protocol === 'http:' || protocol === 'https:' ? null : 'must start with http:// or https://';
  } catch {
    return 'must be a valid address';
  }
};

const descriptionCheck: FieldCheck = (v) =>
  typeof v === 'string' && v.trim() === v && v.length >= 1 && v.length <= MAX_DESCRIPTION_LENGTH && !CONTROL_CHARACTERS.test(v)
    ? null
    : `must be 1 to ${MAX_DESCRIPTION_LENGTH} characters on one line, without surrounding spaces`;

export const LIBRARY_SPEC: FieldSpec = {
  $schema: { required: false, check: (v) => (typeof v === 'string' && v.length <= MAX_URL_LENGTH ? null : 'must be a string') },
  version: { required: false, check: versionCheck },
  vendor: { required: false, check: labelCheck },
  url: { required: false, check: urlCheck },
  description: { required: false, check: descriptionCheck },
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
  deepCheck?: (item: Record<string, unknown>, path: string, errors: ValidationError[]) => void,
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
    deepCheck?.(item, itemPath, errors);
    items.push(item as T);
  });
  return items;
}

export function validateLibrary(raw: unknown): ParseResult {
  const errors: ValidationError[] = [];
  const root = validateObject(raw, LIBRARY_SPEC, '', errors);
  const rootRecord = isRecord(raw) ? raw : {};
  const modules = validateList<ModuleDef>(rootRecord.modules, MODULE_SPEC, 'modules', errors, validateModuleDeep);
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
      ...(root.version !== undefined ? { version: root.version as string } : {}),
      ...(root.vendor !== undefined ? { vendor: root.vendor as string } : {}),
      ...(root.url !== undefined ? { url: root.url as string } : {}),
      ...(root.description !== undefined ? { description: root.description as string } : {}),
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
