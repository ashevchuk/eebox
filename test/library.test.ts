import { describe, expect, it } from 'vitest';
import genericIecText from '../libraries/generic-iec.json?raw';
import { MemoryLibraryStorage, importLibrary, seedBundledLibrary } from '../src/library/storage';
import type { Library } from '../src/library/types';
import { exportLibraryJson, parseLibraryJson, validateLibrary } from '../src/library/validate';

const minimalLibrary = () => ({
  schemaVersion: 1,
  id: 'mine',
  name: 'Mine',
  modules: [{ id: 'm1', kind: 'breaker', name: 'M1', widthUnits: 1, poles: 1 }],
});

function errorPaths(raw: unknown): string[] {
  const result = validateLibrary(raw);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors.map((e) => e.path);
}

describe('library validation', () => {
  it('accepts the bundled generic library', () => {
    const result = parseLibraryJson(genericIecText);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.library.modules.length).toBeGreaterThan(0);
      expect(result.library.enclosures.length).toBeGreaterThan(0);
    }
  });

  it('defaults a missing enclosures list to empty', () => {
    const result = validateLibrary(minimalLibrary());
    expect(result.ok && result.library.enclosures).toEqual([]);
  });

  it('reports the path of a bad nested field', () => {
    const lib = minimalLibrary();
    lib.modules.push({ id: 'm2', kind: 'breaker', name: 'M2', widthUnits: 1.5, poles: 1 });
    expect(errorPaths(lib)).toEqual(['modules[1].widthUnits']);
  });

  it('reports every problem, not only the first', () => {
    const lib = { ...minimalLibrary(), name: '', modules: [{ id: 'x y', kind: 'toaster' }] };
    expect(errorPaths(lib)).toEqual(
      expect.arrayContaining([
        'name',
        'modules[0].id',
        'modules[0].kind',
        'modules[0].name',
        'modules[0].widthUnits',
        'modules[0].poles',
      ]),
    );
  });

  it('rejects unknown fields instead of dropping them', () => {
    const lib = minimalLibrary();
    Object.assign(lib.modules[0]!, { ratedCurrent: 16 });
    expect(errorPaths(lib)).toEqual(['modules[0].ratedCurrent']);
  });

  it('rejects duplicate module ids', () => {
    const lib = minimalLibrary();
    lib.modules.push({ ...lib.modules[0]! });
    expect(errorPaths(lib)).toEqual(['modules[1].id']);
  });

  it('rejects a newer schemaVersion', () => {
    expect(errorPaths({ ...minimalLibrary(), schemaVersion: 2 })).toEqual(['schemaVersion']);
  });

  it('rejects non-JSON text with a root-level error', () => {
    const result = parseLibraryJson('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('');
  });

  it('rejects a non-object root', () => {
    expect(errorPaths([])).toEqual(['']);
  });
});

describe('library export/import', () => {
  it('round-trips the bundled library unchanged', () => {
    const first = parseLibraryJson(genericIecText);
    if (!first.ok) throw new Error('bundled library must be valid');
    const second = parseLibraryJson(exportLibraryJson(first.library));
    expect(second).toEqual(first);
  });
});

describe('importLibrary', () => {
  it('stores a valid library', async () => {
    const storage = new MemoryLibraryStorage();
    const result = await importLibrary(storage, genericIecText);
    expect(result.ok).toBe(true);
    expect((await storage.list()).map((l) => l.id)).toEqual(['generic-iec']);
  });

  it('leaves storage untouched on an invalid library', async () => {
    const storage = new MemoryLibraryStorage();
    await importLibrary(storage, genericIecText);
    const result = await importLibrary(storage, '{"schemaVersion": 1}');
    expect(result.ok).toBe(false);
    expect((await storage.list()).map((l) => l.id)).toEqual(['generic-iec']);
  });

  it('replaces a library that has the same id', async () => {
    const storage = new MemoryLibraryStorage();
    await importLibrary(storage, genericIecText);
    const replacement = { ...minimalLibrary(), id: 'generic-iec' };
    await importLibrary(storage, JSON.stringify(replacement));
    const [stored] = await storage.list();
    expect(stored?.name).toBe('Mine');
    expect(await storage.list()).toHaveLength(1);
  });
});

describe('enclosure bounds', () => {
  const withRails = (railLengthsUnits: unknown) => ({
    ...minimalLibrary(),
    enclosures: [{ id: 'e', name: 'E', railLengthsUnits }],
  });

  it('rejects rails long enough to freeze the renderer', () => {
    expect(errorPaths(withRails([1_000_000_000]))).toEqual(['enclosures[0].railLengthsUnits']);
  });

  it('rejects too many rails and an empty rail list', () => {
    expect(errorPaths(withRails(Array(21).fill(12)))).toEqual(['enclosures[0].railLengthsUnits']);
    expect(errorPaths(withRails([]))).toEqual(['enclosures[0].railLengthsUnits']);
  });

  it('accepts the largest allowed enclosure', () => {
    expect(validateLibrary(withRails(Array(20).fill(144))).ok).toBe(true);
  });
});

describe('seedBundledLibrary', () => {
  const countingStorage = () => {
    const inner = new MemoryLibraryStorage();
    const puts: string[] = [];
    return {
      puts,
      list: () => inner.list(),
      remove: (id: string) => inner.remove(id),
      put: (library: Library) => (puts.push(library.id), inner.put(library)),
    };
  };
  const bundled = () => {
    const parsed = parseLibraryJson(genericIecText);
    if (!parsed.ok) throw new Error('bundled library must be valid');
    return parsed.library;
  };

  it('stores the bundled library in an empty storage', async () => {
    const storage = countingStorage();
    await seedBundledLibrary(storage, genericIecText);
    expect((await storage.list()).map((l) => l.id)).toEqual(['generic-iec']);
  });

  it('replaces an outdated copy so new modules reach existing users', async () => {
    const storage = countingStorage();
    await storage.put({ ...bundled(), modules: bundled().modules.slice(0, 2) });
    await seedBundledLibrary(storage, genericIecText);
    expect((await storage.list())[0]?.modules).toHaveLength(bundled().modules.length);
  });

  it('does not write when the stored copy is current', async () => {
    const storage = countingStorage();
    await seedBundledLibrary(storage, genericIecText);
    storage.puts.length = 0;
    await seedBundledLibrary(storage, genericIecText);
    expect(storage.puts).toEqual([]);
  });

  it('does not bring back a removed bundled library while other libraries exist', async () => {
    const storage = countingStorage();
    await storage.put({ ...bundled(), id: 'mine', name: 'Mine' });
    await seedBundledLibrary(storage, genericIecText);
    expect((await storage.list()).map((l) => l.id)).toEqual(['mine']);
  });

  it('leaves other libraries alone when it replaces its own', async () => {
    const storage = countingStorage();
    await storage.put({ ...bundled(), id: 'mine', name: 'Mine' });
    await storage.put({ ...bundled(), name: 'Old name' });
    await seedBundledLibrary(storage, genericIecText);
    const names = Object.fromEntries((await storage.list()).map((l) => [l.id, l.name]));
    expect(names).toEqual({ mine: 'Mine', 'generic-iec': bundled().name });
  });

  it('reports a broken bundled library instead of ignoring it', async () => {
    await expect(seedBundledLibrary(new MemoryLibraryStorage(), '{"schemaVersion":1}')).rejects.toThrow('bundled library is invalid');
  });
});
