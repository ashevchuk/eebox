import { describe, expect, it } from 'vitest';
import libraryText from '../libraries/generic-iec.json?raw';
import { genericEnclosures, genericLibraryText, genericModules } from '../src/library/genericSeries';
import { terminalsOf } from '../src/electrical/terminals';
import { parseLibraryJson } from '../src/library/validate';

const parsed = parseLibraryJson(libraryText);
if (!parsed.ok) throw new Error(`the bundled library is invalid: ${JSON.stringify(parsed.errors)}`);
const library = parsed.library;
const byId = new Map(library.modules.map((m) => [m.id, m]));

/** Ids of the very first bundled library: projects and links may still refer to them. */
const ORIGINAL_MODULE_IDS = [
  'mcb-1p-b10', 'mcb-1p-c16', 'mcb-2p-c25', 'mcb-3p-c32', 'rcd-2p-40-30', 'rcd-4p-63-30',
  'rcbo-1pn-c16-30', 'main-switch-3p-63', 'contactor-3p-25-230', 'n-bar-12', 'pe-bar-12',
  'comb-3ph-12', 'comb-1ph-12', 'comb-lpn-12',
];

describe('the bundled library', () => {
  it('is exactly what the generator writes; run `npm run gen:library` after changing the series', () => {
    expect(libraryText).toBe(genericLibraryText());
  });

  it('is valid and has metadata that says where the numbers come from', () => {
    expect(library.version).toBe('2');
    expect(library.description).toMatch(/not taken from any manufacturer/);
  });

  it('keeps every id of the first version, with the same kind and name', () => {
    const original: Record<string, [string, string]> = {
      'mcb-1p-b10': ['breaker', 'MCB 1P B10'],
      'mcb-3p-c32': ['breaker', 'MCB 3P C32'],
      'rcd-2p-40-30': ['rcd', 'RCD 2P 40A 30mA'],
      'rcbo-1pn-c16-30': ['rcbo', 'RCBO 1P+N C16 30mA'],
      'main-switch-3p-63': ['switch', 'Main switch 3P 63A'],
      'contactor-3p-25-230': ['contactor', 'Contactor 3P 25A, 230V coil'],
      'n-bar-12': ['busbar', 'Neutral bar 12 terminals'],
      'comb-lpn-12': ['comb', 'Comb L+N, 12 units'],
    };
    for (const id of ORIGINAL_MODULE_IDS) expect(byId.has(id)).toBe(true);
    for (const [id, [kind, name]] of Object.entries(original)) expect(byId.get(id)).toMatchObject({ kind, name });
    for (const id of ['enc-1x12', 'enc-2x18', 'enc-3x24']) {
      expect(library.enclosures.some((e) => e.id === id)).toBe(true);
    }
  });

  it('has unique ids and the number of items the series define', () => {
    expect(new Set(library.modules.map((m) => m.id)).size).toBe(library.modules.length);
    expect(library.modules).toHaveLength(genericModules().length);
    expect(library.enclosures).toHaveLength(genericEnclosures().length);
    expect(library.modules.length).toBeGreaterThan(200);
  });

  it('holds no manufacturer data: no part numbers, no vendor, no link', () => {
    expect(library.modules.some((m) => m.sku !== undefined)).toBe(false);
    expect(library.vendor).toBeUndefined();
    expect(library.url).toBeUndefined();
  });

  it('uses only the standard rating series', () => {
    const ratings = (kind: string) => new Set(library.modules.filter((m) => m.kind === kind).map((m) => m.ratedCurrentA));
    expect([...ratings('breaker')].sort((a, b) => a! - b!)).toEqual([6, 10, 13, 16, 20, 25, 32, 40, 50, 63]);
    expect([...ratings('rcd')].sort((a, b) => a! - b!)).toEqual([25, 40, 63, 80, 100]);
    expect([...new Set(library.modules.filter((m) => m.residualCurrentMa).map((m) => m.residualCurrentMa))].sort((a, b) => a! - b!)).toEqual([30, 100, 300]);
    expect([...new Set(library.modules.filter((m) => m.kind === 'breaker').map((m) => m.curve))].sort()).toEqual(['B', 'C', 'D']);
  });

  it('gives each device a name and an id that agree with its fields', () => {
    for (const m of library.modules.filter((x) => x.kind === 'breaker')) {
      expect(m.id).toBe(`mcb-${m.poles}p-${m.curve!.toLowerCase()}${m.ratedCurrentA}`);
      expect(m.name).toBe(`MCB ${m.poles}P ${m.curve}${m.ratedCurrentA}`);
      expect(m.widthUnits).toBe(m.poles);
    }
    for (const m of library.modules.filter((x) => x.kind === 'rcd')) {
      expect(m.id).toBe(`rcd-${m.poles}p-${m.ratedCurrentA}-${m.residualCurrentMa}`);
      expect(m.widthUnits).toBe(m.poles);
    }
  });

  it('covers every pole count with the conductors people expect', () => {
    const conductors = (id: string) => terminalsOf(byId.get(id)!).filter((t) => t.side === 'top').map((t) => t.conductor);
    expect(conductors('mcb-1p-c16')).toEqual(['L']);
    expect(conductors('mcb-2p-c16')).toEqual(['L', 'N']);
    expect(conductors('mcb-3p-c16')).toEqual(['L1', 'L2', 'L3']);
    expect(conductors('mcb-4p-c16')).toEqual(['L1', 'L2', 'L3', 'N']);
    expect(conductors('rcbo-1pn-c16-30')).toEqual(['L', 'N']);
  });

  it('lets bars and combs be resized and gives combs the patterns of the devices they serve', () => {
    for (const m of library.modules.filter((x) => x.kind === 'busbar' || x.kind === 'comb')) {
      expect(m.resizable).toBeDefined();
    }
    expect(byId.get('comb-3phn-12')?.comb?.pattern).toEqual(['L1', 'L2', 'L3', 'N']);
  });

  it('offers enclosures from one to five rows', () => {
    const rows = new Set(library.enclosures.map((e) => e.railLengthsUnits.length));
    expect([...rows].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(library.enclosures.every((e) => new Set(e.railLengthsUnits).size === 1)).toBe(true);
  });
});
