import { unitsFromMm } from '../layout/units';
import { blockTerminals } from './terminalLayouts';
import { CONDUCTORS, MODULE_KINDS, SCHEMA_VERSION, TRIP_CURVES, type Conductor, type Library, type ModuleDef, type ModuleKind, type TripCurve } from './types';
import { validateLibrary, type ValidationError } from './validate';

const DELIMITERS = [';', '\t', ','] as const;

/** The delimiter a table uses: the one that occurs most in its header line outside quotes. */
function delimiterOf(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  let inQuotes = false;
  const counts = new Map<string, number>();
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (DELIMITERS as readonly string[]).includes(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return [...DELIMITERS].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? ',';
}

/** Splits a table in the usual quoting: fields may be quoted, hold the delimiter and line breaks, and double a quote to hold one. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const delimiter = delimiterOf(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Column names people use for each field, compared without case, spaces and punctuation. */
const COLUMNS: Record<string, string[]> = {
  name: ['name', 'title', 'description', 'product'],
  id: ['id', 'code'],
  sku: ['sku', 'partnumber', 'part', 'article', 'orderno', 'ordernumber', 'catalogno', 'mpn'],
  kind: ['kind', 'type', 'category'],
  poles: ['poles', 'pole', 'polecount'],
  widthMm: ['widthmm', 'mm', 'widthinmm'],
  widthUnits: ['widthunits', 'units', 'modules', 'widthmodules', 'width'],
  ratedCurrentA: ['ratedcurrenta', 'ratedcurrent', 'currenta', 'current', 'in', 'rating', 'amps'],
  curve: ['curve', 'tripcurve', 'characteristic'],
  breakingCapacityKA: ['breakingcapacityka', 'breakingcapacity', 'icn', 'icu'],
  residualCurrentMa: ['residualcurrentma', 'residualcurrent', 'idn', 'sensitivity'],
  price: ['price', 'unitprice', 'cost'],
  currency: ['currency', 'cur'],
  top: ['topterminals', 'top', 'inputs', 'terminalstop'],
  bottom: ['bottomterminals', 'bottom', 'outputs', 'terminalsbottom'],
  conductor: ['conductor', 'wire'],
  joined: ['joined', 'connected', 'bus', 'distribution'],
};

const normalise = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

function fieldOf(header: string): string | undefined {
  const key = normalise(header);
  return Object.entries(COLUMNS).find(([, names]) => names.includes(key))?.[0];
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const YES = new Set(['yes', 'y', 'true', '1', 'x', 'so', 'tak']);

export interface CsvImport {
  /** The id and name the library gets. */
  id: string;
  name: string;
}

export type CsvResult = { ok: true; library: Library; skippedColumns: string[] } | { ok: false; errors: ValidationError[] };

/**
 * Builds a library from a table of parts, one module per row. The first row names the columns. Only a
 * name and a width (in mm or in units) are needed; the terminals come from the poles, or from counts
 * of terminals on the top and the bottom if the table gives them, which is how a terminal block is told.
 */
export function libraryFromCsv(text: string, options: CsvImport): CsvResult {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, errors: [{ path: '', message: 'the table needs a header row and at least one row of parts' }] };
  const [header, ...rows] = table as [string[], ...string[][]];
  const fields = header.map(fieldOf);
  const skippedColumns = header.filter((_h, i) => fields[i] === undefined && header[i]!.trim() !== '');
  const errors: ValidationError[] = [];
  const decimalComma = delimiterOf(text.replace(/^﻿/, '')) !== ',';

  const taken = new Set<string>();
  const modules: ModuleDef[] = [];
  rows.forEach((cells, index) => {
    const at = `row ${index + 2}`;
    const get = (field: string) => cells[fields.indexOf(field)]?.trim() ?? '';
    const fail = (message: string) => errors.push({ path: at, message });
    const number = (field: string): number | undefined | null => {
      const raw = get(field);
      if (raw === '') return undefined;
      const value = Number(decimalComma ? raw.replace(',', '.') : raw);
      return Number.isFinite(value) ? value : null;
    };

    const name = get('name');
    if (name === '') return fail('the name is empty');
    const kind = (get('kind').toLowerCase() || 'other') as ModuleKind;
    if (!MODULE_KINDS.includes(kind)) return fail(`unknown kind "${get('kind')}"; use ${MODULE_KINDS.join(', ')}`);

    const widthMm = number('widthMm');
    const widthUnitsRaw = number('widthUnits');
    if (widthMm === null || widthUnitsRaw === null) return fail('the width is not a number');
    const widthUnits = widthMm !== undefined ? unitsFromMm(widthMm) : widthUnitsRaw;
    if (widthUnits === undefined) return fail('the width is missing: give it in mm or in units');

    const poles = number('poles') ?? 1;
    if (![1, 2, 3, 4].includes(poles as number)) return fail('the poles must be 1, 2, 3 or 4');

    const optional = (field: 'ratedCurrentA' | 'breakingCapacityKA' | 'residualCurrentMa' | 'price') => {
      const value = number(field);
      if (value === null) fail(`${field} is not a number`);
      return value ?? undefined;
    };
    const rated = optional('ratedCurrentA');
    const breaking = optional('breakingCapacityKA');
    const residual = optional('residualCurrentMa');
    const price = optional('price');
    const curveText = get('curve').toUpperCase();
    if (curveText !== '' && !(TRIP_CURVES as readonly string[]).includes(curveText)) return fail(`unknown curve "${get('curve')}"`);

    const top = number('top') ?? 0;
    const bottom = number('bottom') ?? 0;
    const conductorText = get('conductor').toUpperCase() || 'L';
    if (!(CONDUCTORS as readonly string[]).includes(conductorText)) return fail(`unknown conductor "${get('conductor')}"`);
    if (top === null || bottom === null) return fail('the terminal counts are not numbers');

    const sku = get('sku');
    let id = get('id') || slug(sku || name) || `part-${index + 1}`;
    for (let n = 2; taken.has(id); n++) id = `${get('id') || slug(sku || name) || `part-${index + 1}`}-${n}`;
    taken.add(id);

    const terminals = top + bottom > 0
      ? blockTerminals({ top, bottom, conductor: conductorText as Conductor, joined: YES.has(get('joined').toLowerCase()) }, widthUnits, false)
      : undefined;
    modules.push({
      id,
      kind,
      name,
      widthUnits,
      poles: poles as ModuleDef['poles'],
      ...(sku ? { sku } : {}),
      ...(rated !== undefined ? { ratedCurrentA: rated } : {}),
      ...(curveText ? { curve: curveText as TripCurve } : {}),
      ...(breaking !== undefined ? { breakingCapacityKA: breaking } : {}),
      ...(residual !== undefined ? { residualCurrentMa: residual } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(get('currency') ? { currency: get('currency').toUpperCase() } : {}),
      ...(terminals ? { terminals } : {}),
    });
  });
  if (errors.length > 0) return { ok: false, errors };

  const library: Library = { schemaVersion: SCHEMA_VERSION, id: options.id, name: options.name, modules, enclosures: [] };
  const checked = validateLibrary(library);
  if (!checked.ok) {
    return { ok: false, errors: checked.errors.map((e) => ({ path: modulePath(e.path, modules), message: e.message })) };
  }
  return { ok: true, library: checked.library, skippedColumns };
}

/** Says which row a problem found by the library validator belongs to: row 2 is the first part. */
function modulePath(path: string, modules: ModuleDef[]): string {
  const match = /^modules\[(\d+)\]\.?(.*)$/.exec(path);
  if (!match) return path;
  const row = Number(match[1]) + 2;
  return `row ${row}${match[2] ? ` ${match[2]}` : ''} (${modules[Number(match[1])]?.name ?? ''})`;
}
