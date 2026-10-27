import { terminalsOf } from '../electrical/terminals';
import { MAX_RAIL_LENGTH_UNITS, MAX_RAILS } from '../layout/limits';
import {
  CONDUCTORS,
  MODULE_KINDS,
  TERMINAL_SIDES,
  TRIP_CURVES,
  type Conductor,
  type EnclosureDef,
  type Library,
  type ModuleDef,
  type ModuleKind,
  type TerminalDef,
} from '../library/types';
import { SCHEMA_VERSION } from '../library/types';
import { mmFromUnits, roundUnits, unitsFromMm } from '../layout/units';
import { validateLibrary, type ValidationError } from '../library/validate';
import type { InspectorAction, InspectorField, InspectorView } from './inspector';

export type EditorTarget =
  | { kind: 'library' }
  | { kind: 'module'; id: string }
  | { kind: 'enclosure'; id: string };

export interface EditorState {
  /** What is being edited. It may be invalid for a while; `validateDraft` says what is wrong. */
  draft: Library;
  target: EditorTarget;
}

export type EditorResult =
  | { ok: true; draft: Library; target?: EditorTarget }
  | { ok: false; message: string };

const fail = (message: string): EditorResult => ({ ok: false, message });

export function newLibrary(id: string, name: string): Library {
  return { schemaVersion: SCHEMA_VERSION, id, name, modules: [], enclosures: [] };
}

/** A copy that can be edited and saved under its own id, for example of the bundled library. */
export function copyLibrary(source: Library, id: string, name: string): Library {
  return { ...structuredClone(source), id, name };
}

export function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

export function validateDraft(draft: Library): ValidationError[] {
  const result = validateLibrary(draft);
  return result.ok ? [] : result.errors;
}

/** Copy of an object with one optional field set, or removed when the value is undefined. */
function withOptional<T extends object>(object: T, key: string, value: unknown): T {
  const { [key as keyof T]: _old, ...rest } = object;
  return (value === undefined ? rest : { ...rest, [key]: value }) as T;
}

const replaceModule = (draft: Library, id: string, change: (m: ModuleDef) => ModuleDef): Library => ({
  ...draft,
  modules: draft.modules.map((m) => (m.id === id ? change(m) : m)),
});

const replaceEnclosure = (draft: Library, id: string, change: (e: EnclosureDef) => EnclosureDef): Library => ({
  ...draft,
  enclosures: draft.enclosures.map((e) => (e.id === id ? change(e) : e)),
});

const DEFAULT_COMB = { pattern: ['L'] as Conductor[], side: 'top' as const };
const DEFAULT_BAR_TERMINALS: TerminalDef[] = [
  { name: 'N', conductor: 'N', side: 'top', net: 'N', count: 6 },
  { name: 'Nb', conductor: 'N', side: 'bottom', net: 'N', count: 6 },
];

function defaultModule(kind: ModuleKind, id: string): ModuleDef {
  const base: ModuleDef = { id, kind, name: `New ${kind}`, widthUnits: 1, poles: 1 };
  if (kind === 'comb') {
    return { ...base, name: 'New comb', widthUnits: 6, comb: { ...DEFAULT_COMB, pattern: [...DEFAULT_COMB.pattern] }, resizable: { minUnits: 2, maxUnits: 54 } };
  }
  if (kind === 'busbar') {
    return { ...base, name: 'New bar', widthUnits: 6, terminals: structuredClone(DEFAULT_BAR_TERMINALS), resizable: { minUnits: 2, maxUnits: 24 } };
  }
  return base;
}

export function addModule(draft: Library, kind: ModuleKind): { draft: Library; id: string } {
  const id = uniqueId('new-module', draft.modules.map((m) => m.id));
  return { draft: { ...draft, modules: [...draft.modules, defaultModule(kind, id)] }, id };
}

export function duplicateModule(draft: Library, id: string): { draft: Library; id: string } | null {
  const index = draft.modules.findIndex((m) => m.id === id);
  if (index < 0) return null;
  const original = draft.modules[index]!;
  const copyId = uniqueId(`${id}-copy`, draft.modules.map((m) => m.id));
  const copy: ModuleDef = { ...structuredClone(original), id: copyId, name: `${original.name} (copy)` };
  const modules = [...draft.modules];
  modules.splice(index + 1, 0, copy);
  return { draft: { ...draft, modules }, id: copyId };
}

export function addEnclosure(draft: Library): { draft: Library; id: string } {
  const id = uniqueId('new-enclosure', draft.enclosures.map((e) => e.id));
  const enclosure: EnclosureDef = { id, name: 'New enclosure', railLengthsUnits: [12] };
  return { draft: { ...draft, enclosures: [...draft.enclosures, enclosure] }, id };
}

const text = (key: string, label: string, value: string, placeholder?: string): InspectorField => ({
  key, label, kind: 'text', value, ...(placeholder ? { placeholder } : {}),
});
const integer = (key: string, label: string, value: number | '', hint?: string): InspectorField => ({
  key, label, kind: 'integer', value, min: 0, ...(hint ? { hint } : {}),
});
const number = (key: string, label: string, value: number | '', hint?: string): InspectorField => ({
  key, label, kind: 'number', value, min: 0, ...(hint ? { hint } : {}),
});
const select = (key: string, label: string, value: string, options: readonly string[]): InspectorField => ({
  key, label, kind: 'select', value, options,
});
const readonly = (key: string, label: string, value: string | number): InspectorField => ({
  key, label, kind: 'readonly', value,
});

const optional = (value: number | undefined): number | '' => value ?? '';

function summariseTerminals(module: ModuleDef): string {
  if (module.kind === 'comb') return 'a comb has none: its pins follow the pattern';
  const names = (side: 'top' | 'bottom') => terminalsOf(module).filter((t) => t.side === side).map((t) => t.name);
  const describe = (list: string[]) => (list.length > 8 ? `${list.length}` : list.join(' '));
  return `${module.terminals ? 'listed below' : 'from the pole count'}: top ${describe(names('top'))} · bottom ${describe(names('bottom'))}`;
}

function moduleView(module: ModuleDef): InspectorView {
  const fields: InspectorField[] = [
    text('id', 'Id', module.id),
    text('name', 'Name', module.name),
    text('shortName', 'Short name', module.shortName ?? '', 'drawn on the face instead of the name'),
    select('kind', 'Kind', module.kind, MODULE_KINDS),
    number('widthUnits', 'Width', module.widthUnits, 'units of 17.5 mm; a fraction is fine'),
    number('widthMm', 'Width, mm', mmFromUnits(module.widthUnits), 'the real width of the device; this and the line above are one setting'),
    select('poles', 'Poles', String(module.poles), ['1', '2', '3', '4']),
    text('sku', 'Part number', module.sku ?? ''),
    number('ratedCurrentA', 'Rated current', optional(module.ratedCurrentA), 'A'),
    select('curve', 'Trip curve', module.curve ?? '', ['', ...TRIP_CURVES]),
    number('breakingCapacityKA', 'Breaking capacity', optional(module.breakingCapacityKA), 'kA'),
    number('residualCurrentMa', 'Residual current', optional(module.residualCurrentMa), 'mA'),
    number('price', 'Price', optional(module.price), 'what one costs; empty for none'),
    text('currency', 'Currency', module.currency ?? '', 'EUR'),
    number('resizeMin', 'Narrowest copy', optional(module.resizable?.minUnits), 'units; empty both for a fixed width'),
    number('resizeMax', 'Widest copy', optional(module.resizable?.maxUnits), 'units; a placed copy can have any width in the range'),
  ];
  const actions: InspectorAction[] = [
    ...(module.kind === 'comb' ? [] : [{ key: DESIGN_ACTION, label: 'Open in designer' }]),
    { key: 'duplicate', label: 'Duplicate' },
    { key: 'remove', label: 'Remove' },
  ];
  if (module.kind === 'comb') {
    fields.push(
      text('combPattern', 'Pin pattern', (module.comb?.pattern ?? []).join(' '), 'L1 L2 L3'),
      select('combSide', 'Side', module.comb?.side ?? 'top', TERMINAL_SIDES),
    );
  } else {
    fields.push(readonly('terminalsSummary', 'Terminals', summariseTerminals(module)));
    (module.terminals ?? []).forEach((t, i) => {
      const n = i + 1;
      fields.push(
        text(`t.${i}.name`, `T${n} name`, t.name),
        select(`t.${i}.conductor`, `T${n} conductor`, t.conductor, CONDUCTORS),
        select(`t.${i}.side`, `T${n} side`, t.side, TERMINAL_SIDES),
        text(`t.${i}.net`, `T${n} net`, t.net ?? ''),
        { key: `t.${i}.unit`, label: `T${n} position`, kind: 'number', value: optional(t.unit), hint: 'units from the left, decimals allowed, negative from the right; empty spreads evenly' },
        integer(`t.${i}.count`, `T${n} copies`, optional(t.count), 'repeats with numbered names'),
      );
      actions.push({ key: `removeTerminal:${i}`, label: `Remove T${n}` });
    });
    actions.push({ key: 'addTerminal', label: 'Add terminal' });
    if (module.terminals) actions.push({ key: 'defaultTerminals', label: 'Use pole count' });
  }
  return { title: module.name || module.id, fields, actions };
}

export function describeEditor({ draft, target }: EditorState): InspectorView {
  if (target.kind === 'module') {
    const module = draft.modules.find((m) => m.id === target.id);
    if (module) return moduleView(module);
  }
  if (target.kind === 'enclosure') {
    const enclosure = draft.enclosures.find((e) => e.id === target.id);
    if (enclosure) {
      return {
        title: enclosure.name || enclosure.id,
        actions: [{ key: 'remove', label: 'Remove' }],
        fields: [
          text('id', 'Id', enclosure.id),
          text('name', 'Name', enclosure.name),
          text('rails', 'Rail lengths', enclosure.railLengthsUnits.join(' '), '18 18'),
          readonly('rows', 'Rows', enclosure.railLengthsUnits.length),
        ],
      };
    }
  }
  return {
    title: 'Library',
    actions: [],
    fields: [
      text('id', 'Id', draft.id),
      text('name', 'Name', draft.name),
      text('version', 'Version', draft.version ?? ''),
      text('vendor', 'Vendor', draft.vendor ?? ''),
      text('url', 'Source link', draft.url ?? '', 'https://'),
      text('description', 'Description', draft.description ?? ''),
      readonly('summary', 'Contents', `${draft.modules.length} modules, ${draft.enclosures.length} enclosures`),
    ],
  };
}

const NOT_A_NUMBER = 'Enter a number.';
const NOT_AN_INTEGER = 'Enter a whole number.';

function optionalNumber(raw: string, whole: boolean): { ok: true; value: number | undefined } | { ok: false; message: string } {
  if (raw.trim() === '') return { ok: true, value: undefined };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { ok: false, message: NOT_A_NUMBER };
  if (whole && !Number.isInteger(value)) return { ok: false, message: NOT_AN_INTEGER };
  return { ok: true, value };
}

const optionalText = (raw: string) => (raw.trim() === '' ? undefined : raw.trim());

function parseConductors(raw: string): Conductor[] | string {
  const tokens = raw.split(/[\s,]+/).filter(Boolean).map((t) => t.toUpperCase());
  const bad = tokens.find((t) => !(CONDUCTORS as readonly string[]).includes(t));
  return bad ? `Unknown conductor "${bad}"; use ${CONDUCTORS.join(', ')}.` : (tokens as Conductor[]);
}

function parseRails(raw: string): number[] | string {
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const numbers = tokens.map(Number);
  if (numbers.length === 0 || numbers.length > MAX_RAILS) return `List 1 to ${MAX_RAILS} rail lengths.`;
  if (numbers.some((n) => !Number.isFinite(n) || n < 1 || n > MAX_RAIL_LENGTH_UNITS)) {
    return `Each rail length is a number from 1 to ${MAX_RAIL_LENGTH_UNITS}.`;
  }
  return numbers;
}

/** Changing the kind keeps the module consistent: a comb needs its pin spec, others must not have one. */
function withKind(module: ModuleDef, kind: ModuleKind): ModuleDef {
  let next: ModuleDef = { ...module, kind };
  if (kind === 'comb') {
    next = withOptional(withOptional(next, 'terminals', undefined), 'comb', next.comb ?? { ...DEFAULT_COMB, pattern: [...DEFAULT_COMB.pattern] });
  } else {
    next = withOptional(next, 'comb', undefined);
  }
  return next;
}

function editTerminal(module: ModuleDef, index: number, field: string, raw: string): EditorResult | ModuleDef {
  const terminals = module.terminals;
  const current = terminals?.[index];
  if (!terminals || !current) return fail('That terminal does not exist.');
  let next: TerminalDef;
  if (field === 'name') next = { ...current, name: raw.trim() };
  else if (field === 'conductor') next = { ...current, conductor: raw as Conductor };
  else if (field === 'side') next = { ...current, side: raw as TerminalDef['side'] };
  else if (field === 'net') next = withOptional(current, 'net', optionalText(raw));
  else if (field === 'unit' || field === 'count') {
    const parsed = optionalNumber(raw, field === 'count');
    if (!parsed.ok) return fail(parsed.message);
    next = withOptional(current, field, parsed.value);
  } else return fail('That property cannot be edited.');
  return { ...module, terminals: terminals.map((t, i) => (i === index ? next : t)) };
}

function editModule(state: EditorState, id: string, key: string, raw: string): EditorResult {
  const { draft } = state;
  const apply = (change: (m: ModuleDef) => ModuleDef, target?: EditorTarget): EditorResult => ({
    ok: true,
    draft: replaceModule(draft, id, change),
    ...(target ? { target } : {}),
  });
  const numeric = (field: 'ratedCurrentA' | 'breakingCapacityKA' | 'residualCurrentMa' | 'price'): EditorResult => {
    const parsed = optionalNumber(raw, false);
    return parsed.ok ? apply((m) => withOptional(m, field, parsed.value)) : fail(parsed.message);
  };

  switch (key) {
    case 'id':
      return apply((m) => ({ ...m, id: raw.trim() }), { kind: 'module', id: raw.trim() });
    case 'name':
      return apply((m) => ({ ...m, name: raw.trim() }));
    case 'shortName':
      return apply((m) => withOptional(m, 'shortName', optionalText(raw)));
    case 'kind':
      return apply((m) => withKind(m, raw as ModuleKind));
    case 'widthUnits':
    case 'widthMm': {
      const parsed = optionalNumber(raw, false);
      if (!parsed.ok || parsed.value === undefined) return fail(parsed.ok ? NOT_A_NUMBER : parsed.message);
      const units = key === 'widthMm' ? unitsFromMm(parsed.value) : roundUnits(parsed.value);
      return apply((m) => ({ ...m, widthUnits: units }));
    }
    case 'poles':
      return apply((m) => ({ ...m, poles: Number(raw) as ModuleDef['poles'] }));
    case 'sku':
      return apply((m) => withOptional(m, 'sku', optionalText(raw)));
    case 'curve':
      return apply((m) => withOptional(m, 'curve', raw === '' ? undefined : raw));
    case 'ratedCurrentA':
    case 'breakingCapacityKA':
    case 'residualCurrentMa':
    case 'price':
      return numeric(key);
    case 'currency':
      return apply((m) => withOptional(m, 'currency', optionalText(raw)?.toUpperCase()));
    case 'resizeMin':
    case 'resizeMax': {
      const parsed = optionalNumber(raw, false);
      if (!parsed.ok) return fail(parsed.message);
      return apply((m) => {
        const { minUnits, maxUnits } = m.resizable ?? {};
        const min = key === 'resizeMin' ? parsed.value : minUnits;
        const max = key === 'resizeMax' ? parsed.value : maxUnits;
        if (parsed.value === undefined) return withOptional(m, 'resizable', undefined);
        return { ...m, resizable: { minUnits: min ?? m.widthUnits, maxUnits: max ?? m.widthUnits } };
      });
    }
    case 'combPattern': {
      const pattern = parseConductors(raw);
      if (typeof pattern === 'string') return fail(pattern);
      return apply((m) => ({ ...m, comb: { side: m.comb?.side ?? 'top', pattern } }));
    }
    case 'combSide':
      return apply((m) => ({ ...m, comb: { pattern: m.comb?.pattern ?? ['L'], side: raw as 'top' | 'bottom' } }));
  }
  const terminal = /^t\.(\d+)\.(\w+)$/.exec(key);
  if (terminal) {
    const module = draft.modules.find((m) => m.id === id);
    if (!module) return fail('That module does not exist.');
    const edited = editTerminal(module, Number(terminal[1]), terminal[2]!, raw);
    return 'ok' in edited ? edited : apply(() => edited);
  }
  return fail('That property cannot be edited.');
}

/** Applies one edited field. Only text that cannot be read as a value is refused here; the rest is the validator's business. */
export function applyEditorEdit(state: EditorState, key: string, raw: string): EditorResult {
  const { draft, target } = state;
  if (target.kind === 'module') return editModule(state, target.id, key, raw);
  if (target.kind === 'enclosure') {
    const apply = (change: (e: EnclosureDef) => EnclosureDef, next?: EditorTarget): EditorResult => ({
      ok: true,
      draft: replaceEnclosure(draft, target.id, change),
      ...(next ? { target: next } : {}),
    });
    if (key === 'id') return apply((e) => ({ ...e, id: raw.trim() }), { kind: 'enclosure', id: raw.trim() });
    if (key === 'name') return apply((e) => ({ ...e, name: raw.trim() }));
    if (key === 'rails') {
      const rails = parseRails(raw);
      return typeof rails === 'string' ? fail(rails) : apply((e) => ({ ...e, railLengthsUnits: rails }));
    }
    return fail('That property cannot be edited.');
  }
  if (key === 'id') return { ok: true, draft: { ...draft, id: raw.trim() } };
  if (key === 'name') return { ok: true, draft: { ...draft, name: raw.trim() } };
  if (['version', 'vendor', 'url', 'description'].includes(key)) {
    return { ok: true, draft: withOptional(draft, key, optionalText(raw)) };
  }
  return fail('That property cannot be edited.');
}

/** The button that opens the module designer; only a view can do that, so the model refuses it. */
export const DESIGN_ACTION = 'designModule';

/** Runs a button of the editor: duplicating or removing the item, or changing the list of terminals. */
export function applyEditorAction(state: EditorState, key: string): EditorResult {
  const { draft, target } = state;
  if (key === DESIGN_ACTION) return fail('The designer is opened by the editor window.');
  if (target.kind === 'enclosure' && key === 'remove') {
    return { ok: true, draft: { ...draft, enclosures: draft.enclosures.filter((e) => e.id !== target.id) }, target: { kind: 'library' } };
  }
  if (target.kind !== 'module') return fail('That action is not available here.');
  const module = draft.modules.find((m) => m.id === target.id);
  if (!module) return fail('That module does not exist.');

  if (key === 'remove') {
    return { ok: true, draft: { ...draft, modules: draft.modules.filter((m) => m.id !== target.id) }, target: { kind: 'library' } };
  }
  if (key === 'duplicate') {
    const copy = duplicateModule(draft, target.id);
    return copy ? { ok: true, draft: copy.draft, target: { kind: 'module', id: copy.id } } : fail('That module does not exist.');
  }
  if (module.kind === 'comb') return fail('A comb has no terminals.');
  const setTerminals = (terminals: TerminalDef[] | undefined): EditorResult => ({
    ok: true,
    draft: replaceModule(draft, module.id, (m) => withOptional(m, 'terminals', terminals && terminals.length > 0 ? terminals : undefined)),
  });
  if (key === 'defaultTerminals') return setTerminals(undefined);
  if (key === 'addTerminal') {
    const listed: TerminalDef[] =
      module.terminals ?? terminalsOf(module).map((t) => ({ name: t.name, conductor: t.conductor, side: t.side }));
    const taken = listed.map((t) => `${t.side}:${t.name}`);
    let n = listed.length + 1;
    while (taken.includes(`top:T${n}`)) n++;
    return setTerminals([...listed, { name: `T${n}`, conductor: 'L', side: 'top' }]);
  }
  const removal = /^removeTerminal:(\d+)$/.exec(key);
  if (removal && module.terminals) {
    return setTerminals(module.terminals.filter((_t, i) => i !== Number(removal[1])));
  }
  return fail('That action is not available here.');
}
