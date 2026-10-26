import { describe, expect, it } from 'vitest';
import libraryText from '../libraries/generic-iec.json?raw';
import { KIND_LABELS, groupByKind, matchesQuery } from '../src/library/catalog';
import { MODULE_KINDS, type ModuleDef } from '../src/library/types';
import { parseLibraryJson } from '../src/library/validate';

const parsed = parseLibraryJson(libraryText);
if (!parsed.ok) throw new Error('bundled library must be valid');
const modules = parsed.library.modules;
const search = (query: string) => modules.filter((m) => matchesQuery(m, query));
const names = (list: ModuleDef[]) => list.map((m) => m.name);

describe('matchesQuery', () => {
  it('matches everything for a blank query', () => {
    expect(search('')).toHaveLength(modules.length);
    expect(search('   ')).toHaveLength(modules.length);
  });

  it('finds a module by its name, in any letter case', () => {
    expect(names(search('mcb 1p c16'))).toEqual(['MCB 1P C16']);
    expect(names(search('MCB 1P C16'))).toEqual(['MCB 1P C16']);
  });

  it('needs every word, in any order', () => {
    const found = search('c16 2p');
    expect(names(found)).toContain('MCB 2P C16');
    expect(found.every((m) => m.poles === 2 && m.id.includes('c16'))).toBe(true);
  });

  it('counts the poles of a device, so a 1P+N device answers to 2p', () => {
    expect(names(search('2p c16'))).toContain('RCBO 1P+N C16 30mA');
    expect(search('2p c16')).toEqual(search('c16 2p'));
  });

  it('finds by rating, sensitivity and curve as people write them', () => {
    expect(search('16a').every((m) => m.ratedCurrentA === 16)).toBe(true);
    expect(search('300ma').every((m) => m.residualCurrentMa === 300)).toBe(true);
    expect(search('300ma').length).toBeGreaterThan(0);
    expect(new Set(search('d').filter((m) => m.kind === 'breaker').map((m) => m.curve)).has('D')).toBe(true);
  });

  it('finds by kind, by the plural label and by id', () => {
    expect(search('rcbo').every((m) => m.kind === 'rcbo' || m.name.toLowerCase().includes('rcbo'))).toBe(true);
    expect(names(search('surge')).every((n) => n.startsWith('SPD'))).toBe(true);
    expect(names(search('main-switch-3p-63'))).toEqual(['Main switch 3P 63A']);
  });

  it('finds by part number when a module has one', () => {
    const withSku: ModuleDef = { id: 'x', kind: 'breaker', name: 'Plain', widthUnits: 1, poles: 1, sku: 'ZX-9000' };
    expect(matchesQuery(withSku, 'zx-9')).toBe(true);
    expect(matchesQuery(withSku, 'zx-8')).toBe(false);
  });

  it('matches nothing when one word is absent', () => {
    expect(search('mcb 1p c16 zzz')).toEqual([]);
  });
});

describe('groupByKind', () => {
  it('orders the groups like the kinds are defined and leaves out empty ones', () => {
    const kinds = groupByKind(modules).map((g) => g.kind);
    expect(kinds).toEqual(MODULE_KINDS.filter((k) => modules.some((m) => m.kind === k)));
    expect(kinds).not.toContain('meter');
  });

  it('keeps every module exactly once and the order the library gave', () => {
    const groups = groupByKind(modules);
    expect(groups.flatMap((g) => g.modules)).toHaveLength(modules.length);
    const breakers = groups.find((g) => g.kind === 'breaker')!.modules.map((m) => m.id);
    expect(breakers).toEqual(modules.filter((m) => m.kind === 'breaker').map((m) => m.id));
  });

  it('has a label for every kind', () => {
    for (const kind of MODULE_KINDS) expect(KIND_LABELS[kind]).toBeTruthy();
  });

  it('handles an empty list', () => {
    expect(groupByKind([])).toEqual([]);
  });
});
