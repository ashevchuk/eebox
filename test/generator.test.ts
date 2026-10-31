import { describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { GENERATOR, generatorCheck, versionHint, withoutGenerator } from '../src/generator';
import { exportLibraryJson, parseLibraryJson, validateLibrary } from '../src/library/validate';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { planProjectFiles } from '../src/project/projectImport';
import { buildWorkspace, parseWorkspace, workspaceToText } from '../src/project/workspace';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const project = () => ({ panel: { ...panelOf([place('p1', 'breaker16', 0, 0)]), title: 'A' }, schematic: emptySchematic() });
const projectText = (generator?: string | null) => {
  const file: Record<string, unknown> = { ...buildProjectFile(project(), resolve) };
  if (generator === null) delete file.generator;
  else if (generator !== undefined) file.generator = generator;
  return JSON.stringify(file);
};
const emptyWorkspace = () => buildWorkspace({ savedAt: 1, current: null, projects: [], libraries: [], snippets: [], settings: {} });

describe('the mark of the author', () => {
  it('names this build by the version of package.json', () => {
    expect(GENERATOR).toBe(`eebox ${version}`);
  });

  it('is a name and a version, and nothing else', () => {
    for (const ok of ['eebox 0.7.0', 'eebox 12.34.56', 'eebox 1.0.0-beta.1']) expect(generatorCheck(ok)).toBeNull();
    for (const bad of ['eebox', 'eebox 1.2', 'other 1.0.0', 'eebox 1.0.0 extra', '', 7, null, {}]) expect(generatorCheck(bad)).not.toBeNull();
  });

  it('is left out of a file when what it holds is compared', () => {
    const marked = { format: 'x', generator: 'eebox 0.7.0' };
    const bare = { format: 'x' };
    expect(withoutGenerator(marked)).toEqual({ format: 'x' });
    expect(withoutGenerator(bare)).toEqual({ format: 'x' });
  });
});

describe('a project file', () => {
  it('is written with the mark of this build', () => {
    expect(buildProjectFile(project(), resolve).generator).toBe(GENERATOR);
  });

  it('is read with or without a mark, and the mark that was read is kept', () => {
    const marked = parseProjectJson(projectText('eebox 0.5.0'));
    expect(marked.ok && marked.file.generator).toBe('eebox 0.5.0');
    const bare = parseProjectJson(projectText(null));
    expect(bare.ok).toBe(true);
    expect(bare.ok && 'generator' in bare.file).toBe(false);
  });

  it('is refused with a mark that is not one', () => {
    const result = parseProjectJson(projectText('mine'));
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(['generator']);
  });

  it('is the same project to the list whichever version wrote it', () => {
    const stored = [{ id: 'p1', title: 'A', savedAt: 1, file: JSON.parse(projectText('eebox 0.5.0')) }];
    const plan = planProjectFiles(stored, [{ name: 'a.json', text: projectText('eebox 0.9.0') }], 2);
    expect(plan.put).toEqual([]);
    expect(plan.results[0]).toMatchObject({ outcome: 'unchanged' });
  });
});

describe('a backup', () => {
  it('is written with the mark of this build, and read with or without one', () => {
    expect(emptyWorkspace().generator).toBe(GENERATOR);
    const text = workspaceToText(emptyWorkspace());
    expect(parseWorkspace(text).ok).toBe(true);
    const { generator: _gone, ...bare } = emptyWorkspace();
    expect(parseWorkspace(JSON.stringify(bare)).ok).toBe(true);
  });

  it('keeps the mark of the file that was read, not the mark of this build', () => {
    const result = parseWorkspace(JSON.stringify({ ...emptyWorkspace(), generator: 'eebox 0.5.0' }));
    expect(result.ok && result.workspace.generator).toBe('eebox 0.5.0');
    const { generator: _gone, ...bare } = emptyWorkspace();
    const unmarked = parseWorkspace(JSON.stringify(bare));
    expect(unmarked.ok && 'generator' in unmarked.workspace).toBe(false);
  });

  it('is refused with a mark that is not one', () => {
    const result = parseWorkspace(JSON.stringify({ ...emptyWorkspace(), generator: 'mine' }));
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(['generator']);
  });
});

describe('a library file', () => {
  const library = { schemaVersion: 1, id: 'x', name: 'X', modules: [] };

  it('is written with the mark of this build, in place of any earlier one', () => {
    const parsed = validateLibrary({ ...library, generator: 'eebox 0.5.0' });
    if (!parsed.ok) throw new Error('should load');
    expect(JSON.parse(exportLibraryJson(parsed.library)).generator).toBe(GENERATOR);
  });

  it('is read with or without a mark', () => {
    expect(validateLibrary(library).ok).toBe(true);
    const marked = parseLibraryJson(JSON.stringify({ ...library, generator: 'eebox 0.5.0' }));
    expect(marked.ok && marked.library.generator).toBe('eebox 0.5.0');
    expect(validateLibrary({ ...library, generator: 'mine' }).ok).toBe(false);
  });
});

describe('the sentence about a refused file', () => {
  it('says which version wrote a file of another version', () => {
    expect(versionHint(projectText('eebox 0.5.0'), 'eebox 0.7.0')).toBe('The file was written by eebox 0.5.0; this is eebox 0.7.0.');
  });

  it('says nothing about a file of this version, which is wrong for another reason', () => {
    expect(versionHint(projectText('eebox 0.7.0'), 'eebox 0.7.0')).toBeNull();
  });

  it('says that a file does not tell, when it does not', () => {
    expect(versionHint(projectText(null), 'eebox 0.7.0')).toBe('The file does not say which version wrote it; this is eebox 0.7.0.');
  });

  it('says nothing when there is nothing it can read', () => {
    for (const text of ['', 'nope', '[]', '7', 'null', projectText('mine')]) expect(versionHint(text, 'eebox 0.7.0')).toBeNull();
  });
});
