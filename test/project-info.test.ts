import { describe, expect, it } from 'vitest';
import { INFO_KEYS, MAX_NOTES_CHARS, STATUSES, infoCheck, setInfoField, stampOf } from '../src/layout/info';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const panel = () => panelOf([place('p1', 'breaker16', 0, 0)]);
const set = (p: ReturnType<typeof panel>, key: string, text: string) => {
  const result = setInfoField(p, key, text);
  if (!result.ok) throw new Error(result.error);
  return result.panel;
};

describe('the info of a project', () => {
  it('has no info until something is stated, and none again when everything is taken away', () => {
    expect(panel().info).toBeUndefined();
    const stated = set(panel(), 'revision', ' B ');
    expect(stated.info).toEqual({ revision: 'B' });
    expect(set(stated, 'revision', '   ').info).toBeUndefined();
    expect('info' in set(stated, 'revision', '')).toBe(false);
  });

  it('keeps the other fields when one is changed, and leaves the rest of the panel alone', () => {
    let p = set(panel(), 'author', 'A. Designer');
    p = set(p, 'status', 'for review');
    p = set(p, 'author', 'B. Designer');
    expect(p.info).toEqual({ author: 'B. Designer', status: 'for review' });
    expect(p.placements).toEqual(panel().placements);
  });

  it('takes only a status from the list, a label of the right size, and notes that may run over lines', () => {
    for (const status of STATUSES) expect(set(panel(), 'status', status).info?.status).toBe(status);
    expect(setInfoField(panel(), 'status', 'maybe')).toEqual({ ok: false, error: 'invalid-value' });
    expect(setInfoField(panel(), 'author', 'x'.repeat(61))).toEqual({ ok: false, error: 'invalid-value' });
    expect(setInfoField(panel(), 'author', 'tab\there')).toEqual({ ok: false, error: 'invalid-value' });
    expect(set(panel(), 'notes', 'Replace C16 by B16.\r\nAdd an RCD.').info?.notes).toBe('Replace C16 by B16.\nAdd an RCD.');
    expect(setInfoField(panel(), 'notes', 'x'.repeat(MAX_NOTES_CHARS + 1))).toEqual({ ok: false, error: 'invalid-value' });
    expect(setInfoField(panel(), 'colour', 'red')).toEqual({ ok: false, error: 'unknown-field' });
  });

  it('makes a stamp of the revision and the status', () => {
    expect(stampOf(undefined)).toBe('');
    expect(stampOf({ revision: 'B' })).toBe('rev B');
    expect(stampOf({ revision: 'B', status: 'approved', author: 'x' })).toBe('rev B · approved');
    expect(stampOf({ status: 'draft' })).toBe('draft');
  });

  it('names every field it can hold', () => {
    expect([...INFO_KEYS].sort()).toEqual(['approver', 'author', 'date', 'notes', 'revision', 'status']);
  });
});

describe('the info in a project file', () => {
  const file = (info?: unknown) => {
    const built = buildProjectFile({ panel: { ...panel(), ...(info === undefined ? {} : { info: info as never }) }, schematic: emptySchematic() }, resolve);
    return JSON.stringify(built);
  };

  it('is written and read back', () => {
    const parsed = parseProjectJson(file({ revision: 'B', status: 'approved', notes: 'ok\nbut check the earth' }));
    expect(parsed.ok && parsed.file.project.panel.info).toEqual({ revision: 'B', status: 'approved', notes: 'ok\nbut check the earth' });
  });

  it('is not required', () => {
    const parsed = parseProjectJson(file());
    expect(parsed.ok && parsed.file.project.panel.info).toBeUndefined();
  });

  it('is refused when it is not an object of known fields with good values, and the message says which', () => {
    expect(infoCheck({ status: 'maybe' })).toContain('status');
    expect(infoCheck({ revision: '' })).toContain('revision');
    expect(infoCheck({ surprise: 'x' })).toContain('unknown field');
    expect(infoCheck([])).toBe('must be an object');
    const parsed = parseProjectJson(file({ status: 'maybe' }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.some((e) => e.path.includes('info'))).toBe(true);
  });
});

describe('the info in the inspector', () => {
  const ctx = (p: ReturnType<typeof panel>) => ({ project: { panel: p, schematic: emptySchematic() }, selection: {}, mode: 'panel' as const, resolve, snapshot: {}, fromLibraries: resolve });

  it('is shown as fields of the panel, with a list for the status and a long field for the notes', async () => {
    const { inspect } = await import('../src/ui/inspector');
    const fields = inspect(ctx(panel()))!.fields.filter((f) => f.key.startsWith('info.'));
    expect(fields.map((f) => f.key)).toEqual(['info.revision', 'info.author', 'info.date', 'info.status', 'info.approver', 'info.notes']);
    expect(fields.find((f) => f.key === 'info.status')).toMatchObject({ kind: 'select', options: ['', ...STATUSES] });
    expect(fields.find((f) => f.key === 'info.notes')?.kind).toBe('longtext');
  });

  it('is edited through the inspector, and a wrong value is refused with words that say what is allowed', async () => {
    const { applyEdit } = await import('../src/ui/inspector');
    const ok = applyEdit(ctx(panel()), 'info.status', 'approved');
    expect(ok.ok && ok.project.panel.info).toEqual({ status: 'approved' });
    const refused = applyEdit(ctx(panel()), 'info.status', 'perhaps');
    expect(!refused.ok && refused.message).toContain('for review');
    const long = applyEdit(ctx(panel()), 'info.notes', 'x'.repeat(MAX_NOTES_CHARS + 1));
    expect(!long.ok && long.message).toContain(String(MAX_NOTES_CHARS));
  });

  it('lists what is stated as rows of a title block, in the order of one', async () => {
    const { infoRows } = await import('../src/layout/info');
    expect(infoRows(undefined)).toEqual([]);
    expect(infoRows({ notes: 'n', status: 'draft', revision: 'B', author: 'A' })).toEqual([['Revision', 'B'], ['Author', 'A'], ['Status', 'draft'], ['Notes', 'n']]);
  });
});
