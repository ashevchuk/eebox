import { describe, expect, it } from 'vitest';
import { GENERATOR } from '../src/generator';
import { makeSnippet, type Snippet } from '../src/layout/snippets';
import { planSnippetImport } from '../src/project/snippetStorage';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const snippet = (id: string): Snippet => {
  const project = { panel: panelOf([place('p1', 'breaker16', 0, 0)]), schematic: emptySchematic() };
  const result = makeSnippet(project, resolve, { placementIds: ['p1'], combIds: [] }, id, 1, []);
  if (!result.ok) throw new Error(result.error);
  return { ...result.snippet, id };
};
const writtenBy = (s: Snippet, generator: string | null): Snippet => {
  const { generator: _current, ...file } = s.file;
  return { ...s, file: generator === null ? file : { ...file, generator } };
};

describe('importing snippets written by another release', () => {
  it('carries the mark of this build when it is made', () => {
    expect(snippet('a').file.generator).toBe(GENERATOR);
  });

  it('leaves a snippet that is already there, whichever release wrote either copy', () => {
    const stored = [writtenBy(snippet('a'), 'eebox 0.5.0')];
    for (const incoming of [writtenBy(snippet('a'), 'eebox 0.9.0'), writtenBy(snippet('a'), null), snippet('a')]) {
      const plan = planSnippetImport(stored, [incoming]);
      expect(plan).toMatchObject({ unchanged: 1, added: 0 });
      expect(plan.put).toEqual([]);
    }
  });
});
