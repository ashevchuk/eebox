import { describe, expect, it } from 'vitest';
import libraryText from '../libraries/generic-iec.json?raw';
import { MODULE_KINDS, type Library, type ModuleDef } from '../src/library/types';
import { parseLibraryJson } from '../src/library/validate';
import {
  addEnclosure,
  addModule,
  applyEditorAction,
  applyEditorEdit,
  copyLibrary,
  describeEditor,
  duplicateModule,
  newLibrary,
  uniqueId,
  validateDraft,
  type EditorState,
  type EditorTarget,
} from '../src/ui/libraryEditor';

const parsed = parseLibraryJson(libraryText);
if (!parsed.ok) throw new Error('bundled library must be valid');
const bundled = parsed.library;

const state = (draft: Library, target: EditorTarget = { kind: 'library' }): EditorState => ({ draft, target });
const moduleOf = (draft: Library, id: string): ModuleDef => draft.modules.find((m) => m.id === id)!;

function edit(s: EditorState, key: string, raw: string) {
  const result = applyEditorEdit(s, key, raw);
  if (!result.ok) throw new Error(result.message);
  return result;
}
function act(s: EditorState, key: string) {
  const result = applyEditorAction(s, key);
  if (!result.ok) throw new Error(result.message);
  return result;
}
const refused = (result: { ok: boolean; message?: string }) => {
  if (result.ok) throw new Error('expected a refusal');
  return result.message;
};
const errorPaths = (draft: Library) => validateDraft(draft).map((e) => e.path);
const fieldKeys = (s: EditorState) => describeEditor(s).fields.map((f) => f.key);
const field = (s: EditorState, key: string) => describeEditor(s).fields.find((f) => f.key === key);

/** A library with one breaker, one bar, one comb and one enclosure to edit. */
const sample = (): Library => ({
  ...newLibrary('mine', 'Mine'),
  modules: [
    { id: 'mcb', kind: 'breaker', name: 'MCB', widthUnits: 1, poles: 1, ratedCurrentA: 16, curve: 'C' },
    {
      id: 'bar', kind: 'busbar', name: 'Bar', widthUnits: 6, poles: 1, resizable: { minUnits: 2, maxUnits: 24 },
      terminals: [{ name: 'N', conductor: 'N', side: 'top', net: 'N', count: 6 }],
    },
    { id: 'comb', kind: 'comb', name: 'Comb', widthUnits: 6, poles: 1, comb: { pattern: ['L'], side: 'top' } },
  ],
  enclosures: [{ id: 'box', name: 'Box', railLengthsUnits: [12, 12] }],
});

describe('creating libraries and items', () => {
  it('starts a valid empty library', () => {
    expect(validateDraft(newLibrary('mine', 'Mine'))).toEqual([]);
  });

  it('makes ids unique by numbering', () => {
    expect(uniqueId('a', [])).toBe('a');
    expect(uniqueId('a', ['a'])).toBe('a-2');
    expect(uniqueId('a', ['a', 'a-2', 'a-3'])).toBe('a-4');
  });

  it('copies a library, such as the bundled one, without sharing anything with it', () => {
    const copy = copyLibrary(bundled, 'my-iec', 'My IEC');
    expect(copy).toMatchObject({ id: 'my-iec', name: 'My IEC', version: bundled.version });
    expect(copy.modules).toEqual(bundled.modules);
    copy.modules[0]!.name = 'changed';
    expect(bundled.modules[0]!.name).not.toBe('changed');
    expect(validateDraft(copy)).toEqual([]);
  });

  it.each(MODULE_KINDS)('adds a valid new module of kind %s', (kind) => {
    const { draft, id } = addModule(newLibrary('mine', 'Mine'), kind);
    expect(moduleOf(draft, id).kind).toBe(kind);
    expect(validateDraft(draft)).toEqual([]);
  });

  it('gives each new module its own id', () => {
    let draft = newLibrary('mine', 'Mine');
    for (let i = 0; i < 3; i++) draft = addModule(draft, 'breaker').draft;
    expect(draft.modules.map((m) => m.id)).toEqual(['new-module', 'new-module-2', 'new-module-3']);
  });

  it('makes a new comb a comb with pins, and a new bar a bar whose terminals scale', () => {
    const comb = moduleOf(...(([d, id]) => [d, id] as const)([addModule(newLibrary('a', 'A'), 'comb').draft, 'new-module'] as const));
    expect(comb.comb).toEqual({ pattern: ['L'], side: 'top' });
    expect(comb.resizable).toBeDefined();
    const bar = addModule(newLibrary('a', 'A'), 'busbar').draft.modules[0]!;
    expect(bar.terminals).toHaveLength(2);
    expect(bar.resizable).toBeDefined();
  });

  it('duplicates a module right after the original, with its own id and name, and a deep copy', () => {
    const { draft, id } = duplicateModule(sample(), 'bar')!;
    expect(draft.modules.map((m) => m.id)).toEqual(['mcb', 'bar', 'bar-copy', 'comb']);
    expect(moduleOf(draft, id).name).toBe('Bar (copy)');
    expect(validateDraft(draft)).toEqual([]);
    moduleOf(draft, id).terminals![0]!.count = 99;
    expect(moduleOf(draft, 'bar').terminals![0]!.count).toBe(6);
    expect(duplicateModule(sample(), 'zzz')).toBeNull();
  });

  it('adds a valid enclosure with its own id', () => {
    const first = addEnclosure(newLibrary('a', 'A'));
    const second = addEnclosure(first.draft);
    expect(second.draft.enclosures.map((e) => e.id)).toEqual(['new-enclosure', 'new-enclosure-2']);
    expect(validateDraft(second.draft)).toEqual([]);
  });
});

describe('describing what is being edited', () => {
  it('describes the library with its metadata and a summary', () => {
    const s = state({ ...sample(), version: '3', vendor: 'V' });
    expect(describeEditor(s).title).toBe('Library');
    expect(fieldKeys(s)).toEqual(['id', 'name', 'version', 'vendor', 'url', 'description', 'summary']);
    expect(field(s, 'version')?.value).toBe('3');
    expect(field(s, 'summary')?.value).toBe('3 modules, 1 enclosures');
  });

  it('describes a breaker without comb fields, and says its terminals come from the pole count', () => {
    const s = state(sample(), { kind: 'module', id: 'mcb' });
    expect(describeEditor(s).title).toBe('MCB');
    expect(fieldKeys(s)).not.toContain('combPattern');
    expect(field(s, 'terminalsSummary')?.value).toBe('from the pole count: top L · bottom L');
    expect(field(s, 'ratedCurrentA')?.value).toBe(16);
    expect(field(s, 'curve')).toMatchObject({ kind: 'select', value: 'C', options: ['', 'B', 'C', 'D', 'K', 'Z'] });
    expect(field(s, 'poles')).toMatchObject({ kind: 'select', value: '1' });
    expect(field(s, 'sku')?.value).toBe('');
  });

  it('shows empty optional numbers as empty fields', () => {
    const s = state(sample(), { kind: 'module', id: 'comb' });
    expect(field(s, 'ratedCurrentA')?.value).toBe('');
    expect(field(s, 'resizeMin')?.value).toBe('');
  });

  it('lists six fields and a remove button for every listed terminal', () => {
    const s = state(sample(), { kind: 'module', id: 'bar' });
    expect(fieldKeys(s).filter((k) => k.startsWith('t.0.'))).toEqual(['t.0.name', 't.0.conductor', 't.0.side', 't.0.net', 't.0.unit', 't.0.count']);
    const actions = describeEditor(s).actions.map((a) => a.key);
    expect(actions).toEqual(expect.arrayContaining(['duplicate', 'remove', 'removeTerminal:0', 'addTerminal', 'defaultTerminals']));
  });

  it('describes a comb by its pins and side, and offers no terminal actions', () => {
    const s = state(sample(), { kind: 'module', id: 'comb' });
    expect(field(s, 'combPattern')?.value).toBe('L');
    expect(field(s, 'combSide')).toMatchObject({ kind: 'select', value: 'top' });
    expect(fieldKeys(s)).not.toContain('terminalsSummary');
    expect(describeEditor(s).actions.map((a) => a.key)).toEqual(['duplicate', 'remove']);
  });

  it('describes an enclosure by its rail lengths', () => {
    const s = state(sample(), { kind: 'enclosure', id: 'box' });
    expect(field(s, 'rails')?.value).toBe('12 12');
    expect(field(s, 'rows')?.value).toBe(2);
    expect(describeEditor(s).actions.map((a) => a.key)).toEqual(['remove']);
  });

  it('falls back to the library when the target no longer exists', () => {
    expect(describeEditor(state(sample(), { kind: 'module', id: 'gone' })).title).toBe('Library');
    expect(describeEditor(state(sample(), { kind: 'enclosure', id: 'gone' })).title).toBe('Library');
  });
});

describe('editing the library', () => {
  it('sets id and name trimmed, and sets or clears the optional fields', () => {
    let s = state(sample());
    s = state(edit(s, 'id', ' mine-2 ').draft);
    s = state(edit(s, 'name', ' Mine two ').draft);
    s = state(edit(s, 'version', '2').draft);
    s = state(edit(s, 'url', 'https://example.com').draft);
    expect(s.draft).toMatchObject({ id: 'mine-2', name: 'Mine two', version: '2', url: 'https://example.com' });
    s = state(edit(s, 'version', '  ').draft);
    expect('version' in s.draft).toBe(false);
  });

  it('refuses an unknown property', () => {
    expect(refused(applyEditorEdit(state(sample()), 'summary', 'x'))).toBe('That property cannot be edited.');
  });

  it('does not touch the draft it was given', () => {
    const draft = sample();
    const snapshot = structuredClone(draft);
    applyEditorEdit(state(draft), 'name', 'Changed');
    applyEditorEdit(state(draft, { kind: 'module', id: 'bar' }), 'widthUnits', '9');
    applyEditorAction(state(draft, { kind: 'module', id: 'bar' }), 'addTerminal');
    expect(draft).toEqual(snapshot);
  });
});

describe('editing a module', () => {
  const on = (id: string) => state(sample(), { kind: 'module', id });

  it('renames the id and follows it with the target', () => {
    const result = edit(on('mcb'), 'id', ' mcb-16 ');
    expect(result.draft.modules[0]!.id).toBe('mcb-16');
    expect(result.target).toEqual({ kind: 'module', id: 'mcb-16' });
  });

  it('sets the name, width, poles, part number and curve', () => {
    let s = on('mcb');
    for (const [key, raw] of [['name', ' MCB 2P '], ['widthUnits', '2'], ['poles', '2'], ['sku', ' X-1 '], ['curve', 'D']] as const) {
      s = state(edit(s, key, raw).draft, s.target);
    }
    expect(moduleOf(s.draft, 'mcb')).toMatchObject({ name: 'MCB 2P', widthUnits: 2, poles: 2, sku: 'X-1', curve: 'D' });
    s = state(edit(s, 'curve', '').draft, s.target);
    s = state(edit(s, 'sku', '').draft, s.target);
    expect('curve' in moduleOf(s.draft, 'mcb')).toBe(false);
    expect('sku' in moduleOf(s.draft, 'mcb')).toBe(false);
  });

  it('sets and clears the decimal ratings, and refuses text that is not a number', () => {
    let s = on('mcb');
    s = state(edit(s, 'ratedCurrentA', '12.5').draft, s.target);
    s = state(edit(s, 'breakingCapacityKA', '6').draft, s.target);
    s = state(edit(s, 'residualCurrentMa', '30').draft, s.target);
    expect(moduleOf(s.draft, 'mcb')).toMatchObject({ ratedCurrentA: 12.5, breakingCapacityKA: 6, residualCurrentMa: 30 });
    s = state(edit(s, 'ratedCurrentA', '').draft, s.target);
    expect('ratedCurrentA' in moduleOf(s.draft, 'mcb')).toBe(false);
    expect(refused(applyEditorEdit(s, 'ratedCurrentA', 'abc'))).toBe('Enter a number.');
  });

  it('wants a number for the width, accepts a fraction, and does not let it be cleared', () => {
    expect(refused(applyEditorEdit(on('mcb'), 'widthUnits', ''))).toBe('Enter a number.');
    expect(refused(applyEditorEdit(on('mcb'), 'widthUnits', 'x'))).toBe('Enter a number.');
    expect(moduleOf(edit(on('mcb'), 'widthUnits', '1.5').draft, 'mcb').widthUnits).toBe(1.5);
  });

  it('sets the width from millimetres, so that a relay of 22.5 mm is 22.5 mm wide', () => {
    expect(moduleOf(edit(on('mcb'), 'widthMm', '22.5').draft, 'mcb').widthUnits).toBe(1.2857);
    expect(moduleOf(edit(on('mcb'), 'widthMm', '35').draft, 'mcb').widthUnits).toBe(2);
    expect(moduleOf(edit(on('mcb'), 'widthMm', '29').draft, 'mcb').widthUnits).toBe(1.6571);
    expect(refused(applyEditorEdit(on('mcb'), 'widthMm', 'wide'))).toBe('Enter a number.');
  });

  it('shows the width in millimetres next to the width in units', () => {
    const fields = describeEditor(on('mcb')).fields;
    expect(fields.find((f) => f.key === 'widthUnits')?.value).toBe(1);
    expect(fields.find((f) => f.key === 'widthMm')?.value).toBe(17.5);
  });

  it('sets a price and upper-cases a currency, and clears both with an empty field', () => {
    let s = on('mcb');
    s = state(edit(s, 'price', '12.5').draft, s.target);
    s = state(edit(s, 'currency', 'eur').draft, s.target);
    expect(moduleOf(s.draft, 'mcb')).toMatchObject({ price: 12.5, currency: 'EUR' });
    s = state(edit(s, 'price', '').draft, s.target);
    s = state(edit(s, 'currency', '').draft, s.target);
    expect('price' in moduleOf(s.draft, 'mcb')).toBe(false);
    expect('currency' in moduleOf(s.draft, 'mcb')).toBe(false);
  });

  it('refuses a price that is not a number, and shows the price and the currency', () => {
    expect(refused(applyEditorEdit(on('mcb'), 'price', 'cheap'))).toBe('Enter a number.');
    expect(fieldKeys(on('mcb'))).toEqual(expect.arrayContaining(['price', 'currency']));
  });

  it('makes a module resizable by giving a range, and fixed again by clearing it', () => {
    let s = on('mcb');
    s = state(edit(s, 'resizeMin', '1').draft, s.target);
    expect(moduleOf(s.draft, 'mcb').resizable).toEqual({ minUnits: 1, maxUnits: 1 });
    s = state(edit(s, 'resizeMax', '8').draft, s.target);
    expect(moduleOf(s.draft, 'mcb').resizable).toEqual({ minUnits: 1, maxUnits: 8 });
    s = state(edit(s, 'resizeMin', '').draft, s.target);
    expect('resizable' in moduleOf(s.draft, 'mcb')).toBe(false);
    expect(refused(applyEditorEdit(s, 'resizeMin', 'one'))).toBe('Enter a number.');
  });

  it('turns a module into a comb with a default pin spec and no terminals, and back', () => {
    const toComb = edit(on('bar'), 'kind', 'comb');
    const comb = moduleOf(toComb.draft, 'bar');
    expect(comb.comb).toEqual({ pattern: ['L'], side: 'top' });
    expect('terminals' in comb).toBe(false);
    expect(validateDraft(toComb.draft)).toEqual([]);
    const back = edit(state(toComb.draft, on('bar').target), 'kind', 'breaker');
    expect('comb' in moduleOf(back.draft, 'bar')).toBe(false);
    expect(moduleOf(back.draft, 'bar').resizable).toEqual({ minUnits: 2, maxUnits: 24 });
    expect(validateDraft(back.draft)).toEqual([]);
  });

  it('keeps a resizable range when the kind changes, whatever the new kind', () => {
    expect(moduleOf(edit(on('comb'), 'kind', 'busbar').draft, 'comb').resizable).toBeUndefined();
    expect(moduleOf(edit(on('bar'), 'kind', 'busbar').draft, 'bar').resizable).toBeDefined();
  });

  it('reads the pin pattern in any case, separated by spaces or commas, and refuses unknown conductors', () => {
    const s = on('comb');
    expect(moduleOf(edit(s, 'combPattern', 'l1, l2  L3').draft, 'comb').comb?.pattern).toEqual(['L1', 'L2', 'L3']);
    expect(refused(applyEditorEdit(s, 'combPattern', 'L1 Q'))).toBe('Unknown conductor "Q"; use L, L1, L2, L3, N, PE, PEN, C, DCP, DCN.');
    expect(moduleOf(edit(s, 'combSide', 'bottom').draft, 'comb').comb).toEqual({ pattern: ['L'], side: 'bottom' });
  });

  it('edits each field of a listed terminal', () => {
    let s = on('bar');
    for (const [key, raw] of [['t.0.name', ' PE '], ['t.0.conductor', 'PE'], ['t.0.side', 'bottom'], ['t.0.net', 'PE'], ['t.0.unit', ''], ['t.0.count', '4']] as const) {
      s = state(edit(s, key, raw).draft, s.target);
    }
    expect(moduleOf(s.draft, 'bar').terminals![0]).toEqual({ name: 'PE', conductor: 'PE', side: 'bottom', net: 'PE', count: 4 });
    s = state(edit(s, 't.0.net', ' ').draft, s.target);
    expect('net' in moduleOf(s.draft, 'bar').terminals![0]!).toBe(false);
  });

  it('refuses a terminal that is not there, a bad number in it, and an unknown field of it', () => {
    expect(refused(applyEditorEdit(on('bar'), 't.5.name', 'x'))).toBe('That terminal does not exist.');
    expect(refused(applyEditorEdit(on('bar'), 't.0.count', '1.5'))).toBe('Enter a whole number.');
    expect(refused(applyEditorEdit(on('bar'), 't.0.colour', 'red'))).toBe('That property cannot be edited.');
    expect(refused(applyEditorEdit(on('mcb'), 't.0.name', 'x'))).toBe('That terminal does not exist.');
  });
});

describe('module and terminal actions', () => {
  const on = (id: string) => state(sample(), { kind: 'module', id });

  it('duplicates a module and moves the target to the copy', () => {
    const result = act(on('mcb'), 'duplicate');
    expect(result.draft.modules.map((m) => m.id)).toEqual(['mcb', 'mcb-copy', 'bar', 'comb']);
    expect(result.target).toEqual({ kind: 'module', id: 'mcb-copy' });
  });

  it('removes a module and falls back to the library', () => {
    const result = act(on('mcb'), 'remove');
    expect(result.draft.modules.map((m) => m.id)).toEqual(['bar', 'comb']);
    expect(result.target).toEqual({ kind: 'library' });
  });

  it('starts a terminal list from the derived terminals, so nothing is lost, then adds one', () => {
    const result = act(on('mcb'), 'addTerminal');
    expect(moduleOf(result.draft, 'mcb').terminals).toEqual([
      { name: 'L', conductor: 'L', side: 'top' },
      { name: 'L', conductor: 'L', side: 'bottom' },
      { name: 'T3', conductor: 'L', side: 'top' },
    ]);
    expect(validateDraft(result.draft)).toEqual([]);
  });

  it('adds a terminal to an existing list, with a name that is not taken', () => {
    const once = act(on('bar'), 'addTerminal');
    const twice = act(state(once.draft, on('bar').target), 'addTerminal');
    expect(moduleOf(twice.draft, 'bar').terminals!.map((t) => t.name)).toEqual(['N', 'T2', 'T3']);
    expect(validateDraft(twice.draft)).toEqual([]);
  });

  it('removes a terminal, and goes back to the pole count after the last one', () => {
    const added = act(on('bar'), 'addTerminal');
    const removedOne = act(state(added.draft, on('bar').target), 'removeTerminal:1');
    expect(moduleOf(removedOne.draft, 'bar').terminals).toHaveLength(1);
    const removedAll = act(state(removedOne.draft, on('bar').target), 'removeTerminal:0');
    expect('terminals' in moduleOf(removedAll.draft, 'bar')).toBe(false);
  });

  it('goes back to the pole count on request', () => {
    expect('terminals' in moduleOf(act(on('bar'), 'defaultTerminals').draft, 'bar')).toBe(false);
  });

  it('refuses terminal actions on a comb, unknown actions, and a module that is gone', () => {
    expect(refused(applyEditorAction(on('comb'), 'addTerminal'))).toBe('A comb has no terminals.');
    expect(refused(applyEditorAction(on('mcb'), 'explode'))).toBe('That action is not available here.');
    expect(refused(applyEditorAction(on('gone'), 'remove'))).toBe('That module does not exist.');
    expect(refused(applyEditorAction(state(sample()), 'remove'))).toBe('That action is not available here.');
  });
});

describe('editing an enclosure', () => {
  const on = () => state(sample(), { kind: 'enclosure', id: 'box' });

  it('renames id and name, following the id with the target', () => {
    const result = edit(on(), 'id', 'big-box');
    expect(result.draft.enclosures[0]!.id).toBe('big-box');
    expect(result.target).toEqual({ kind: 'enclosure', id: 'big-box' });
    expect(edit(on(), 'name', ' Big ').draft.enclosures[0]!.name).toBe('Big');
  });

  it('reads the rail lengths from a list', () => {
    expect(edit(on(), 'rails', '18, 18  24').draft.enclosures[0]!.railLengthsUnits).toEqual([18, 18, 24]);
  });

  it('refuses a list that is empty, too long, not a number or out of range', () => {
    expect(refused(applyEditorEdit(on(), 'rails', ' '))).toMatch(/List 1 to 20/);
    expect(refused(applyEditorEdit(on(), 'rails', Array(21).fill('12').join(' ')))).toMatch(/List 1 to 20/);
    expect(refused(applyEditorEdit(on(), 'rails', '12 x'))).toMatch(/number from 1 to 144/);
    expect(refused(applyEditorEdit(on(), 'rails', '12 500'))).toMatch(/number from 1 to 144/);
    expect(edit(on(), 'rails', '12 14.5').draft.enclosures[0]!.railLengthsUnits).toEqual([12, 14.5]);
  });

  it('removes the enclosure and falls back to the library', () => {
    const result = act(on(), 'remove');
    expect(result.draft.enclosures).toEqual([]);
    expect(result.target).toEqual({ kind: 'library' });
  });
});

describe('what the validator says about a draft', () => {
  it('has no complaints about the sample, and reports a chain of edits with paths', () => {
    expect(validateDraft(sample())).toEqual([]);
    let s = state(sample(), { kind: 'module', id: 'bar' });
    s = state(edit(s, 'widthUnits', '40').draft, s.target);
    expect(errorPaths(s.draft)).toEqual(['modules[1].widthUnits']);
    s = state(edit(s, 'name', ' ').draft, s.target);
    // Field errors come first; the rules that tie fields together are checked once the fields are fine.
    expect(errorPaths(s.draft)).toEqual(['modules[1].name']);
  });

  it('flags a duplicate id created by renaming', () => {
    const result = edit(state(sample(), { kind: 'module', id: 'bar' }), 'id', 'mcb');
    expect(errorPaths(result.draft)).toEqual(['modules[1].id']);
  });

  it('flags a position on a resizable bar only when it would not exist at its narrowest width', () => {
    let s = state(sample(), { kind: 'module', id: 'bar' });
    s = state(edit(s, 't.0.count', '').draft, s.target);
    s = state(edit(s, 't.0.unit', '1').draft, s.target);
    expect(errorPaths(s.draft)).toEqual([]);
    s = state(edit(s, 't.0.unit', '-1').draft, s.target);
    expect(errorPaths(s.draft)).toEqual([]);
    s = state(edit(s, 't.0.unit', '4').draft, s.target);
    expect(errorPaths(s.draft)).toEqual(['modules[1].terminals[0].unit']);
  });

  it('accepts every kind a person can build from the new-item defaults, ready to save', () => {
    let draft = newLibrary('mine', 'Mine');
    for (const kind of MODULE_KINDS) draft = addModule(draft, kind).draft;
    draft = addEnclosure(draft).draft;
    expect(validateDraft(draft)).toEqual([]);
  });
});

