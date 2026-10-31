import { describe, expect, it } from 'vitest';
import genericIecText from '../libraries/generic-iec.json?raw';
import { MemoryLibraryStorage, removeInvalidLibraries } from '../src/library/storage';
import { parseLibraryJson } from '../src/library/validate';
import type { Library } from '../src/library/types';

const bundled = (): Library => {
  const parsed = parseLibraryJson(genericIecText);
  if (!parsed.ok) throw new Error('bundled library must be valid');
  return parsed.library;
};

describe('removeInvalidLibraries', () => {
  it('keeps valid libraries and removes the ones the validator refuses, naming them', async () => {
    const storage = new MemoryLibraryStorage();
    const good = bundled();
    const { heightMm: _height, ...withoutHeight } = good.modules[0]!;
    const bad = { ...good, id: 'old', name: 'Old library', modules: [withoutHeight] } as unknown as Library;
    await storage.put(good);
    await storage.put(bad);

    const removed = await removeInvalidLibraries(storage);

    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('Old library');
    expect(removed[0]).toContain('heightMm');
    expect((await storage.list()).map((l) => l.id)).toEqual([good.id]);
  });

  it('reports nothing when every library is valid', async () => {
    const storage = new MemoryLibraryStorage();
    await storage.put(bundled());
    expect(await removeInvalidLibraries(storage)).toEqual([]);
  });
});
