import { describe, expect, it } from 'vitest';
import type { Library, ModuleDef } from '../src/library/types';
import { duplicateModule, removeModule } from '../src/ui/libraryEditor';

const module = (id: string): ModuleDef => ({ id, kind: 'other', name: `Module ${id}`, widthUnits: 1, poles: 1 });
const library = (...ids: string[]): Library => ({ schemaVersion: 1, id: 'mine', name: 'Mine', modules: ids.map(module), enclosures: [] });

describe('taking a module out of a library', () => {
  it('leaves the others in their order', () => {
    expect(removeModule(library('a', 'b', 'c'), 'b')?.modules.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('can empty a library, which is still a library', () => {
    expect(removeModule(library('a'), 'a')?.modules).toEqual([]);
  });

  it('says there is nothing to take out when there is no such module', () => {
    expect(removeModule(library('a'), 'z')).toBeNull();
  });

  it('does not change the library it is given', () => {
    const original = library('a', 'b');
    removeModule(original, 'a');
    expect(original.modules).toHaveLength(2);
  });
});

describe('making a copy of a module next to it', () => {
  it('puts it right after the original, named and numbered so that it is told from it', () => {
    const copy = duplicateModule(library('a', 'b'), 'a')!;
    expect(copy.draft.modules.map((m) => m.id)).toEqual(['a', 'a-copy', 'b']);
    expect(copy.draft.modules[1]!.name).toBe('Module a (copy)');
    expect(duplicateModule(copy.draft, 'a')!.id).toBe('a-copy-2');
  });

  it('is nothing for a module that is not there', () => {
    expect(duplicateModule(library('a'), 'z')).toBeNull();
  });
});
