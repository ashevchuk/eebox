import { describe, expect, it } from 'vitest';
import { describeDiff, diffLibraries, isUnchanged, planImport } from '../src/library/compare';
import type { Library, ModuleDef } from '../src/library/types';

const mod = (id: string, name = id.toUpperCase(), extra: Partial<ModuleDef> = {}): ModuleDef => ({
  id, kind: 'breaker', name, widthUnits: 1, poles: 1, ...extra,
});
const library = (modules: ModuleDef[], extra: Partial<Library> = {}): Library => ({
  schemaVersion: 1, id: 'mine', name: 'Mine', modules, enclosures: [], ...extra,
});

describe('diffLibraries', () => {
  it('finds nothing between equal libraries, whatever the field order', () => {
    const a = library([mod('a', 'A', { sku: 'S', ratedCurrentA: 16 })]);
    const b = library([{ ratedCurrentA: 16, sku: 'S', poles: 1, widthUnits: 1, name: 'A', kind: 'breaker', id: 'a' }]);
    expect(isUnchanged(diffLibraries(a, b))).toBe(true);
  });

  it('names the modules added, removed and changed', () => {
    const before = library([mod('a'), mod('b'), mod('c')]);
    const after = library([mod('a'), mod('c', 'C2', { widthUnits: 2 }), mod('d')]);
    expect(diffLibraries(before, after).modules).toEqual({ added: ['D'], removed: ['B'], changed: ['C2'] });
  });

  it('treats a changed id as one removed and one added module', () => {
    const diff = diffLibraries(library([mod('a')]), library([mod('a2', 'A')]));
    expect(diff.modules).toEqual({ added: ['A'], removed: ['A'], changed: [] });
  });

  it('reports enclosures and library fields too', () => {
    const before = library([], { enclosures: [{ id: 'e', name: 'E', railLengthsUnits: [12] }], version: '1' });
    const after = library([], { enclosures: [{ id: 'e', name: 'E', railLengthsUnits: [18] }], version: '2', vendor: 'V' });
    const diff = diffLibraries(before, after);
    expect(diff.enclosures.changed).toEqual(['E']);
    expect(diff.metadata).toEqual(['version', 'vendor']);
  });
});

describe('planImport', () => {
  const stored = [library([mod('a')])];

  it('adds a library with an unknown id', () => {
    expect(planImport(stored, library([], { id: 'other' }), 'generic')).toEqual({ kind: 'new' });
    expect(planImport([], library([]), 'generic')).toEqual({ kind: 'new' });
  });

  it('says so when the same library is imported again', () => {
    expect(planImport(stored, library([mod('a')]), 'generic')).toEqual({ kind: 'same' });
  });

  it('asks before replacing a library with the same id that differs, and says how', () => {
    const plan = planImport(stored, library([mod('a'), mod('b')], { version: '2' }), 'generic');
    if (plan.kind !== 'replace') throw new Error(plan.kind);
    expect(plan.before).toBe(stored[0]);
    expect(plan.diff.modules.added).toEqual(['B']);
    expect(plan.diff.metadata).toEqual(['version']);
  });

  it('refuses the id of the bundled library, even when nothing is stored under it', () => {
    expect(planImport(stored, library([], { id: 'generic' }), 'generic')).toEqual({ kind: 'reserved' });
    expect(planImport([library([], { id: 'generic' })], library([], { id: 'generic' }), 'generic')).toEqual({ kind: 'reserved' });
  });
});

describe('describeDiff', () => {
  it('lists counts and the first few names', () => {
    const text = describeDiff({
      modules: { added: ['A', 'B', 'C', 'D', 'E'], removed: ['X'], changed: [] },
      enclosures: { added: [], removed: [], changed: ['Box'] },
      metadata: ['version'],
    });
    expect(text).toBe('5 modules added (A, B, C, …); 1 module removed (X); 1 enclosure changed (Box); version changed');
  });

  it('says there are no differences when there are none', () => {
    expect(describeDiff({ modules: { added: [], removed: [], changed: [] }, enclosures: { added: [], removed: [], changed: [] }, metadata: [] })).toBe('no differences');
  });
});
