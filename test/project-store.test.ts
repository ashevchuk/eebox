import { describe, expect, it } from 'vitest';
import { buildProjectFile } from '../src/project/file';
import { MemoryProjectStore, newProjectId, newestFirst, type StoredProject } from '../src/project/projectStore';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

function stored(id: string, savedAt: number, title = id): StoredProject {
  const panel = panelOf([place('p1', 'breaker16', 0, 0)]);
  return { id, title, savedAt, file: buildProjectFile({ panel, schematic: emptySchematic() }, resolve) };
}

describe('project store', () => {
  it('lists the newest project first, and equal times by id', () => {
    const list = [stored('b', 1), stored('c', 5), stored('a', 1)];
    expect(newestFirst(list).map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(list.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('picks the first project id that is free', () => {
    expect(newProjectId([])).toBe('project-1');
    expect(newProjectId([stored('project-1', 0), stored('project-3', 0)])).toBe('project-2');
  });

  it('keeps what was put, replaces one id, and removes', async () => {
    const store = new MemoryProjectStore();
    await store.put(stored('x', 1, 'First'));
    await store.put(stored('y', 2));
    await store.put(stored('x', 3, 'Second'));
    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all.find((p) => p.id === 'x')?.title).toBe('Second');
    await store.remove('x');
    expect((await store.list()).map((p) => p.id)).toEqual(['y']);
  });

  it('hands out copies, so a change to a listed project does not reach the store', async () => {
    const store = new MemoryProjectStore();
    await store.put(stored('x', 1, 'Kept'));
    (await store.list())[0]!.title = 'Changed';
    expect((await store.list())[0]!.title).toBe('Kept');
  });
});
