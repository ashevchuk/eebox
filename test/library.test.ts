import { describe, expect, it } from 'vitest';
import genericIecText from '../libraries/generic-iec.json?raw';
import { MemoryLibraryStorage, importLibraryText, seedBundledLibrary } from '../src/library/storage';
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
    lib.modules.push({ id: 'm2', kind: 'breaker', name: 'M2', widthUnits: 0.05, poles: 1 });
    expect(errorPaths(lib)).toEqual(['modules[1].widthUnits']);
  });

  it('accepts a width that is a fraction of a unit, as a relay of 22.5 mm is', () => {
    const lib = minimalLibrary();
    lib.modules.push({ id: 'm2', kind: 'relay', name: 'M2', widthUnits: 1.2857, poles: 1 });
    expect(validateLibrary(lib).ok).toBe(true);
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

describe('importLibraryText', () => {
  const BUNDLED = 'generic-iec';
  const mine = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...minimalLibrary(), ...extra });
  const always = async () => true;
  const never = async () => false;
  const ids = async (storage: MemoryLibraryStorage) => (await storage.list()).map((l) => l.id);

  it('stores a valid library', async () => {
    const storage = new MemoryLibraryStorage();
    const outcome = await importLibraryText(storage, mine(), BUNDLED, always);
    expect(outcome.kind).toBe('imported');
    expect(await ids(storage)).toEqual(['mine']);
  });

  it('leaves storage untouched on an invalid library, and reports why', async () => {
    const storage = new MemoryLibraryStorage();
    await importLibraryText(storage, mine(), BUNDLED, always);
    const outcome = await importLibraryText(storage, '{"schemaVersion": 1}', BUNDLED, always);
    expect(outcome.kind).toBe('invalid');
    if (outcome.kind === 'invalid') expect(outcome.errors.length).toBeGreaterThan(0);
    expect(await ids(storage)).toEqual(['mine']);
  });

  it('says so, without asking, when the same library is imported again', async () => {
    const storage = new MemoryLibraryStorage();
    await importLibraryText(storage, mine(), BUNDLED, always);
    let asked = false;
    const outcome = await importLibraryText(storage, mine(), BUNDLED, async () => ((asked = true), true));
    expect(outcome.kind).toBe('same');
    expect(asked).toBe(false);
  });

  it('replaces a different library with the same id after the user agrees, and shows what differs', async () => {
    const storage = new MemoryLibraryStorage();
    await importLibraryText(storage, mine(), BUNDLED, always);
    const updated = mine({ name: 'Mine v2', version: '2', modules: [{ id: 'm1', kind: 'breaker', name: 'M1', widthUnits: 2, poles: 1 }] });
    let shown: unknown;
    const outcome = await importLibraryText(storage, updated, BUNDLED, async (_incoming, _before, diff) => ((shown = diff), true));
    expect(outcome.kind).toBe('replaced');
    expect((await storage.list())[0]?.name).toBe('Mine v2');
    expect(shown).toMatchObject({ modules: { changed: ['M1'] }, metadata: ['name', 'version'] });
  });

  it('keeps the existing library when the user declines the replacement', async () => {
    const storage = new MemoryLibraryStorage();
    await importLibraryText(storage, mine(), BUNDLED, always);
    const outcome = await importLibraryText(storage, mine({ name: 'Other' }), BUNDLED, never);
    expect(outcome.kind).toBe('kept');
    expect((await storage.list())[0]?.name).toBe('Mine');
  });

  it('refuses the id of the bundled library, stored or not', async () => {
    const storage = new MemoryLibraryStorage();
    const outcome = await importLibraryText(storage, mine({ id: BUNDLED }), BUNDLED, always);
    expect(outcome.kind).toBe('reserved');
    expect(await ids(storage)).toEqual([]);
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

describe('library metadata', () => {
  const withMeta = (meta: Record<string, unknown>) => ({ ...minimalLibrary(), ...meta });

  it('accepts and keeps version, vendor, url and description in a fixed order', () => {
    const result = validateLibrary(
      withMeta({ description: 'Generic devices', url: 'https://example.com/lib', vendor: 'Example Ltd', version: '2.1' }),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(Object.keys(result.library)).toEqual([
      'schemaVersion', 'id', 'name', 'version', 'vendor', 'url', 'description', 'modules', 'enclosures',
    ]);
  });

  it('round-trips the metadata through export', () => {
    const first = validateLibrary(withMeta({ version: '3', vendor: 'V', url: 'http://example.com', description: 'D' }));
    if (!first.ok) throw new Error('should load');
    expect(parseLibraryJson(exportLibraryJson(first.library))).toEqual(first);
  });

  it('accepts a $schema pointer and drops it, so editors can validate the file', () => {
    const result = validateLibrary(withMeta({ $schema: './library.schema.json' }));
    expect(result.ok && '$schema' in result.library).toBe(false);
    expect(result.ok).toBe(true);
  });

  it.each([
    ['url', 'javascript:alert(1)', 'must start with http'],
    ['url', 'data:text/html,<script>', 'must start with http'],
    ['url', 'not a url', 'without spaces'],
    ['url', 'https://' + 'a'.repeat(300), 'at most 300'],
    ['url', 'ftp://example.com', 'must start with http'],
    ['version', ' 1', 'surrounding spaces'],
    ['version', 'x'.repeat(41), '1 to 40'],
    ['vendor', 'a\nb', '1 to 60'],
    ['description', 'line one\nline two', 'one line'],
    ['description', 'x'.repeat(301), '1 to 300'],
  ])('rejects a bad %s (%j)', (field, value, message) => {
    const result = validateLibrary(withMeta({ [field]: value }));
    if (result.ok) throw new Error('expected a failure');
    expect(result.errors.map((e) => e.path)).toEqual([field]);
    expect(result.errors[0]?.message).toContain(message);
  });
});


describe('price and currency of a module', () => {
  const withModule = (extra: Record<string, unknown>) => {
    const lib = minimalLibrary();
    lib.modules.push({ id: 'm2', kind: 'breaker', name: 'M2', widthUnits: 1, poles: 1, ...extra } as never);
    return lib;
  };

  it('are accepted: a price from zero up, and a currency of letters', () => {
    expect(validateLibrary(withModule({ price: 12.5, currency: 'EUR' })).ok).toBe(true);
    expect(validateLibrary(withModule({ price: 0 })).ok).toBe(true);
  });

  it('are refused when the price is negative, not a number or absurd, and when the currency is not letters', () => {
    expect(errorPaths(withModule({ price: -1 }))).toEqual(['modules[1].price']);
    expect(errorPaths(withModule({ price: '5' }))).toEqual(['modules[1].price']);
    expect(errorPaths(withModule({ price: 1e9 }))).toEqual(['modules[1].price']);
    expect(errorPaths(withModule({ currency: '€' }))).toEqual(['modules[1].currency']);
    expect(errorPaths(withModule({ currency: 'EUROPEAN-X' }))).toEqual(['modules[1].currency']);
  });
});
