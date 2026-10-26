import { describe, expect, it } from 'vitest';
import { defaultPoleConductors, terminalId, terminalsOf } from '../src/electrical/terminals';
import { familyOf, type ModuleDef } from '../src/library/types';
import { parseLibraryJson, validateLibrary } from '../src/library/validate';
import genericIecText from '../libraries/generic-iec.json?raw';

const def = (overrides: Partial<ModuleDef> = {}): ModuleDef => ({
  id: 'm',
  kind: 'breaker',
  name: 'M',
  widthUnits: 3,
  poles: 3,
  ...overrides,
});

const summary = (module: ModuleDef) =>
  terminalsOf(module).map((t) => `${t.side}:${t.name}@${t.unit}${t.net ? `~${t.net}` : ''}`);

describe('conductors', () => {
  it('puts L, L1..L3 in the phase family, and N and PE in their own', () => {
    expect(['L', 'L1', 'L2', 'L3'].map((c) => familyOf(c as 'L'))).toEqual(Array(4).fill('phase'));
    expect(familyOf('N')).toBe('N');
    expect(familyOf('PE')).toBe('PE');
  });

  it('derives the poles of standard devices', () => {
    expect(defaultPoleConductors(1)).toEqual(['L']);
    expect(defaultPoleConductors(2)).toEqual(['L', 'N']);
    expect(defaultPoleConductors(3)).toEqual(['L1', 'L2', 'L3']);
    expect(defaultPoleConductors(4)).toEqual(['L1', 'L2', 'L3', 'N']);
  });
});

describe('terminalsOf', () => {
  it('gives a 3-pole module a phase terminal per unit on both sides', () => {
    expect(summary(def())).toEqual([
      'top:L1@0', 'top:L2@1', 'top:L3@2',
      'bottom:L1@0', 'bottom:L2@1', 'bottom:L3@2',
    ]);
  });

  it('spreads poles over a wider module', () => {
    expect(summary(def({ widthUnits: 4 })).slice(0, 3)).toEqual(['top:L1@0', 'top:L2@1', 'top:L3@2']);
    expect(summary(def({ widthUnits: 6, poles: 2 })).slice(0, 2)).toEqual(['top:L@0', 'top:N@3']);
  });

  it('gives a single-pole module one terminal per side', () => {
    expect(summary(def({ widthUnits: 1, poles: 1 }))).toEqual(['top:L@0', 'bottom:L@0']);
  });

  it('uses explicit terminals instead of the derived ones', () => {
    const contactor = def({
      terminals: [
        { name: 'L1', conductor: 'L1', side: 'top', unit: 0 },
        { name: 'A1', conductor: 'L', side: 'top', unit: 2 },
      ],
    });
    expect(summary(contactor)).toEqual(['top:L1@0', 'top:A1@2']);
  });

  it('expands a counted group, numbers it and spreads it over the width', () => {
    const bar = def({
      widthUnits: 6,
      poles: 1,
      kind: 'busbar',
      terminals: [{ name: 'N', conductor: 'N', side: 'top', net: 'N', count: 6 }],
    });
    expect(summary(bar)).toEqual(['top:N1@0~N', 'top:N2@1~N', 'top:N3@2~N', 'top:N4@3~N', 'top:N5@4~N', 'top:N6@5~N']);
  });

  it('shares a unit between terminals when there are more than units', () => {
    const bar = def({ widthUnits: 2, terminals: [{ name: 'X', conductor: 'N', side: 'top', count: 4 }] });
    expect(terminalsOf(bar).map((t) => t.unit)).toEqual([0, 0, 1, 1]);
  });

  it('gives a comb no terminals and builds ids from side and name', () => {
    expect(terminalsOf(def({ kind: 'comb', comb: { pattern: ['L'], side: 'top' } }))).toEqual([]);
    expect(terminalId('top', 'L1')).toBe('top:L1');
  });
});

const library = (module: Record<string, unknown>) => ({
  schemaVersion: 1,
  id: 'lib',
  name: 'Lib',
  modules: [{ id: 'm', kind: 'breaker', name: 'M', widthUnits: 3, poles: 3, ...module }],
});

function errorPaths(raw: unknown): string[] {
  const result = validateLibrary(raw);
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors.map((e) => e.path);
}

describe('terminal and comb validation', () => {
  it('accepts the bundled library with bars, combs and a contactor', () => {
    const result = parseLibraryJson(genericIecText);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const kinds = new Set(result.library.modules.map((m) => m.kind));
    expect(kinds).toContain('comb');
    expect(kinds).toContain('busbar');
  });

  it('reports a bad conductor with the path of the terminal', () => {
    const lib = library({ terminals: [{ name: 'L1', conductor: 'L1', side: 'top' }, { name: 'X', conductor: 'Q', side: 'top' }] });
    expect(errorPaths(lib)).toEqual(['modules[0].terminals[1].conductor']);
  });

  it('rejects a unit outside the module and a unit on a counted group', () => {
    expect(errorPaths(library({ terminals: [{ name: 'L1', conductor: 'L1', side: 'top', unit: 3 }] }))).toEqual([
      'modules[0].terminals[0].unit',
    ]);
    expect(errorPaths(library({ terminals: [{ name: 'N', conductor: 'N', side: 'top', unit: 1, count: 2 }] }))).toEqual([
      'modules[0].terminals[0].unit',
    ]);
  });

  it('rejects duplicate terminals, also across a counted group', () => {
    const lib = library({
      terminals: [
        { name: 'N', conductor: 'N', side: 'top', count: 2 },
        { name: 'N1', conductor: 'N', side: 'top' },
      ],
    });
    expect(errorPaths(lib)).toEqual(['modules[0].terminals[1].name']);
  });

  it('allows the same name on opposite sides', () => {
    const lib = library({
      terminals: [
        { name: 'L1', conductor: 'L1', side: 'top' },
        { name: 'L1', conductor: 'L1', side: 'bottom' },
      ],
    });
    expect(validateLibrary(lib).ok).toBe(true);
  });

  it('caps the number of terminals per module', () => {
    const lib = library({ terminals: Array.from({ length: 2 }, (_, i) => ({ name: `T${i}`, conductor: 'N', side: 'top', count: 40 })) });
    expect(errorPaths(lib)).toEqual(['modules[0].terminals']);
  });

  it('requires a comb spec on a comb, and forbids one elsewhere', () => {
    expect(errorPaths(library({ kind: 'comb' }))).toEqual(['modules[0].comb']);
    expect(errorPaths(library({ comb: { pattern: ['L'], side: 'top' } }))).toEqual(['modules[0].comb']);
  });

  it('rejects terminals on a comb and a bad comb pattern', () => {
    const comb = { kind: 'comb', comb: { pattern: ['L'], side: 'top' } };
    expect(errorPaths(library({ ...comb, terminals: [{ name: 'L', conductor: 'L', side: 'top' }] }))).toEqual([
      'modules[0].terminals',
    ]);
    expect(errorPaths(library({ kind: 'comb', comb: { pattern: [], side: 'top' } }))).toEqual(['modules[0].comb.pattern']);
    expect(errorPaths(library({ kind: 'comb', comb: { pattern: ['L'], side: 'left' } }))).toEqual(['modules[0].comb.side']);
  });

  it('rejects unknown fields inside terminals', () => {
    const lib = library({ terminals: [{ name: 'L1', conductor: 'L1', side: 'top', colour: 'red' }] });
    expect(errorPaths(lib)).toEqual(['modules[0].terminals[0].colour']);
  });
});

describe('resizable modules', () => {
  const bar = (overrides: Partial<ModuleDef> = {}): ModuleDef => ({
    id: 'bar',
    kind: 'busbar',
    name: 'Bar',
    widthUnits: 6,
    poles: 1,
    resizable: { minUnits: 2, maxUnits: 24 },
    terminals: [
      { name: 'N', conductor: 'N', side: 'top', net: 'N', count: 6 },
      { name: 'Nb', conductor: 'N', side: 'bottom', net: 'N', count: 6 },
    ],
    ...overrides,
  });

  it('keeps the terminals of the definition at its own width', () => {
    expect(terminalsOf(bar())).toHaveLength(12);
    expect(terminalsOf(bar(), 6)).toEqual(terminalsOf(bar()));
  });

  it('scales every terminal group with the width of the placed copy', () => {
    expect(terminalsOf(bar(), 9).filter((t) => t.side === 'top')).toHaveLength(9);
    expect(terminalsOf(bar(), 12)).toHaveLength(24);
    expect(terminalsOf(bar(), 3).filter((t) => t.side === 'bottom')).toHaveLength(3);
  });

  it('keeps the numbering stable so that wires on the first terminals survive', () => {
    const wider = terminalsOf(bar(), 9).map((t) => t.id);
    const narrower = terminalsOf(bar(), 3).map((t) => t.id);
    for (const id of terminalsOf(bar()).map((t) => t.id).filter((id) => /[1-3]$/.test(id))) {
      expect(wider).toContain(id);
      expect(narrower).toContain(id);
    }
  });

  it('spreads the scaled terminals over the new width', () => {
    const top = terminalsOf(bar(), 12).filter((t) => t.side === 'top');
    expect(top.map((t) => t.unit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => Math.floor((i * 12) / 12)));
    expect(Math.max(...top.map((t) => t.unit))).toBeLessThan(12);
  });

  it('never scales a group below one terminal', () => {
    expect(terminalsOf(bar({ resizable: { minUnits: 1, maxUnits: 24 } }), 1).filter((t) => t.side === 'top')).toHaveLength(1);
  });

  it('keeps a single terminal single when the copy is wider, and scales only groups with a count', () => {
    const relay: ModuleDef = {
      id: 'r', kind: 'relay', name: 'R', widthUnits: 1, poles: 2, resizable: { minUnits: 1, maxUnits: 4 },
      terminals: [
        { name: 'A1', conductor: 'L', side: 'top' },
        { name: '14', conductor: 'C', side: 'bottom' },
        { name: 'G', conductor: 'N', side: 'bottom', count: 2 },
      ],
    };
    expect(terminalsOf(relay, 1).map((t) => t.id)).toEqual(['top:A1', 'bottom:14', 'bottom:G1', 'bottom:G2']);
    expect(terminalsOf(relay, 3).map((t) => t.id)).toEqual(['top:A1', 'bottom:14', 'bottom:G1', 'bottom:G2', 'bottom:G3', 'bottom:G4', 'bottom:G5', 'bottom:G6']);
  });

  it('does not scale a module that is not resizable', () => {
    const fixed = bar({ resizable: undefined });
    expect(terminalsOf(fixed, 12)).toHaveLength(12);
  });

  it('spreads the poles of a resizable module without terminals over the width', () => {
    const plain: ModuleDef = { id: 'p', kind: 'busbar', name: 'P', widthUnits: 3, poles: 3, resizable: { minUnits: 3, maxUnits: 12 } };
    expect(terminalsOf(plain, 9).filter((t) => t.side === 'top').map((t) => t.unit)).toEqual([0, 3, 6]);
  });
});

describe('resizable validation', () => {
  const lib = (module: Record<string, unknown>) => ({
    schemaVersion: 1, id: 'lib', name: 'Lib',
    modules: [{ id: 'm', kind: 'busbar', name: 'M', widthUnits: 6, poles: 1, resizable: { minUnits: 2, maxUnits: 24 }, ...module }],
  });
  const errorPaths = (raw: unknown) => {
    const result = validateLibrary(raw);
    if (result.ok) throw new Error('expected validation to fail');
    return result.errors.map((e) => e.path);
  };

  it('accepts busbars and combs', () => {
    expect(validateLibrary(lib({})).ok).toBe(true);
    expect(validateLibrary(lib({ kind: 'comb', comb: { pattern: ['L'], side: 'top' } })).ok).toBe(true);
  });

  it('accepts it on any kind of module, because devices of one kind differ in width between makes', () => {
    expect(validateLibrary(lib({ kind: 'breaker' })).ok).toBe(true);
    expect(validateLibrary(lib({ kind: 'relay', widthUnits: 2, resizable: { minUnits: 1, maxUnits: 4 } })).ok).toBe(true);
  });

  it('rejects a reversed or out-of-bounds range and a width outside it', () => {
    expect(errorPaths(lib({ resizable: { minUnits: 8, maxUnits: 4 } }))).toEqual(['modules[0].resizable.maxUnits']);
    expect(errorPaths(lib({ resizable: { minUnits: 0, maxUnits: 4 } }))).toEqual(['modules[0].resizable.minUnits']);
    expect(errorPaths(lib({ resizable: { minUnits: 1, maxUnits: 1000 } }))).toEqual(['modules[0].resizable.maxUnits']);
    expect(errorPaths(lib({ resizable: { minUnits: 8, maxUnits: 12 } }))).toEqual(['modules[0].widthUnits']);
  });

  it('rejects unknown and missing range fields', () => {
    expect(errorPaths(lib({ resizable: { minUnits: 2 } }))).toEqual(['modules[0].resizable.maxUnits']);
    expect(errorPaths(lib({ resizable: { minUnits: 2, maxUnits: 4, step: 2 } }))).toEqual(['modules[0].resizable.step']);
  });

  const withUnit = (unit: number, module: Record<string, unknown> = {}) =>
    lib({ terminals: [{ name: 'N', conductor: 'N', side: 'top', unit }], ...module });
  const unitErrors = (unit: number, module: Record<string, unknown> = {}) => errorPaths(withUnit(unit, module));
  const accepts = (unit: number, module: Record<string, unknown> = {}) => validateLibrary(withUnit(unit, module)).ok;

  it('accepts a position counted from the left or, when negative, from the right, within the narrowest width', () => {
    for (const unit of [0, 1, -1, -2]) expect(accepts(unit), String(unit)).toBe(true);
  });

  it('rejects a position that would not exist at the narrowest width', () => {
    expect(unitErrors(2)).toEqual(['modules[0].terminals[0].unit']);
    expect(unitErrors(-3)).toEqual(['modules[0].terminals[0].unit']);
    expect(unitErrors(0.5)).toEqual(['modules[0].terminals[0].unit']);
  });

  it('keeps negative positions for resizable modules: a fixed module has no right edge to count from', () => {
    const fixed = { resizable: undefined, kind: 'breaker', widthUnits: 3 };
    expect(accepts(2, fixed)).toBe(true);
    expect(unitErrors(3, fixed)).toEqual(['modules[0].terminals[0].unit']);
    expect(unitErrors(-1, fixed)).toEqual(['modules[0].terminals[0].unit']);
  });

  it('places a negative position at the right edge of every width', () => {
    const relay: ModuleDef = {
      id: 'r', kind: 'relay', name: 'R', widthUnits: 1, poles: 2, resizable: { minUnits: 1, maxUnits: 4 },
      terminals: [{ name: 'A1', conductor: 'L', side: 'top', unit: 0 }, { name: '14', conductor: 'C', side: 'bottom', unit: -1 }],
    };
    const unitOf = (width: number, id: string) => terminalsOf(relay, width).find((t) => t.id === id)?.unit;
    expect([1, 2, 4].map((w) => unitOf(w, 'bottom:14'))).toEqual([0, 1, 3]);
    expect([1, 2, 4].map((w) => unitOf(w, 'top:A1'))).toEqual([0, 0, 0]);
  });

  it('marks the bundled bars and combs as resizable', () => {
    const parsed = parseLibraryJson(genericIecText);
    if (!parsed.ok) throw new Error('bundled library must be valid');
    const resizable = parsed.library.modules.filter((m) => m.kind === 'busbar' || m.kind === 'comb');
    expect(resizable.length).toBeGreaterThan(0);
    expect(resizable.every((m) => m.resizable !== undefined)).toBe(true);
  });
});
