import { describe, expect, it } from 'vitest';
import { MAX_SNIPPETS, makeSnippet, type Snippet } from '../src/layout/snippets';
import type { KeyValueStore } from '../src/project/autosave';
import { loadSnippets, parseSnippetList, planSnippetImport, saveSnippets } from '../src/project/snippetStorage';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const snippet = (id: string, itemId = 'p1'): Snippet => {
  const project = { panel: panelOf([place(itemId, 'breaker16', 0, 0)]), schematic: emptySchematic() };
  const result = makeSnippet(project, resolve, { placementIds: [itemId], combIds: [] }, id, 1, []);
  if (!result.ok) throw new Error(result.error);
  return { ...result.snippet, id };
};

describe('stored snippets', () => {
  it('are read back as they were saved', () => {
    const store = memory();
    expect(saveSnippets(store, [snippet('a'), snippet('b')])).toBe(true);
    expect(loadSnippets(store).snippets.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('are none when nothing is stored, and a stored list that does not read is reported, not used', () => {
    const store = memory();
    expect(loadSnippets(store)).toEqual({ snippets: [] });
    store.setItem('eebox:snippets', '{"not":"a list"}');
    expect(loadSnippets(store).problem).toContain('stored snippets ignored');
    store.setItem('eebox:snippets', 'garbage');
    expect(loadSnippets(store).problem).toContain('stored snippets ignored');
  });

  it('are refused one by one when the file inside does not load or the id could be a path', () => {
    const good = snippet('a');
    const bad = parseSnippetList([{ ...good, file: { format: 'x' } }, { ...good, id: '../a' }, { ...good, extra: 1 }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const paths = bad.errors.map((e) => e.path);
      expect(paths.some((p) => p.startsWith('snippets[0].file'))).toBe(true);
      expect(paths).toContain('snippets[1].id');
      expect(paths).toContain('snippets[2].extra');
    }
  });

  it('are limited in number', () => {
    const many = Array.from({ length: MAX_SNIPPETS + 1 }, (_, i) => snippet(`s${i}`));
    expect(parseSnippetList(many).ok).toBe(false);
  });
});

describe('snippet import plan', () => {
  it('leaves an identical snippet, adds a new one, renames one whose id is taken by another', () => {
    const existing = [snippet('snippet-1')];
    const other = { ...snippet('snippet-1', 'p9'), name: 'Other' };
    const plan = planSnippetImport(existing, [snippet('snippet-1'), snippet('fresh'), other]);
    expect(plan.unchanged).toBe(1);
    expect(plan.put.map((s) => s.id)).toEqual(['fresh', 'snippet-2']);
  });

  it('stops at the limit and says how many were left out', () => {
    const existing = Array.from({ length: MAX_SNIPPETS - 1 }, (_, i) => snippet(`s${i}`));
    const plan = planSnippetImport(existing, [snippet('x1'), snippet('x2'), snippet('x3')]);
    expect(plan.added).toBe(1);
    expect(plan.skipped).toBe(2);
  });
});
