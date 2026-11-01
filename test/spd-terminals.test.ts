import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { terminalsOf } from '../src/electrical/terminals';
import { isValidPosition } from '../src/library/positions';
import type { Library } from '../src/library/types';

const surgeProtectors = (JSON.parse(raw) as Library).modules.filter((m) => m.kind === 'spd');
const byId = (id: string) => surgeProtectors.find((m) => m.id === id)!;

const AC_LINES: Record<string, string[]> = { '1p': ['L'], '1pn': ['L', 'N'], '3p': ['L1', 'L2', 'L3'], '3pn': ['L1', 'L2', 'L3', 'N'] };

describe('the bundled surge protectors', () => {
  it('cover the types: spark gap, combined, varistor and fine protection, and the DC ones for PV', () => {
    expect(surgeProtectors.map((m) => m.id)).toEqual([
      'spd-t1-1p', 'spd-t1-1pn', 'spd-t1-3p', 'spd-t1-3pn',
      'spd-t12-1p', 'spd-t12-1pn', 'spd-t12-3p', 'spd-t12-3pn',
      'spd-t2-1p', 'spd-t2-1pn', 'spd-t2-3p', 'spd-t2-3pn',
      'spd-t3-1p', 'spd-t3-1pn',
      'spd-pv-t2', 'spd-pv-t12',
    ]);
  });

  it('name what they are made of, so that the types can be told apart in the palette', () => {
    expect(byId('spd-t1-3pn').name).toBe('SPD type 1 (spark gap) 3P+N');
    expect(byId('spd-t12-3pn').name).toBe('SPD type 1+2 (combined) 3P+N');
    expect(byId('spd-t2-3pn').name).toBe('SPD type 2 (varistor) 3P+N');
    expect(byId('spd-t3-1p').name).toBe('SPD type 3 (fine protection) 1P');
  });

  it('take the AC lines in on top and have one earth terminal below, so nothing passes through them', () => {
    for (const def of surgeProtectors.filter((m) => !m.id.startsWith('spd-pv-'))) {
      const terminals = terminalsOf(def);
      expect(terminals.filter((t) => t.side === 'top').map((t) => t.conductor), def.id).toEqual(AC_LINES[def.id.split('-').slice(2).join('-')]);
      expect(terminals.filter((t) => t.side === 'bottom').map((t) => t.conductor), def.id).toEqual(['PE']);
    }
  });

  it('take the plus and the minus of a PV string in on top and have one earth terminal below', () => {
    for (const id of ['spd-pv-t2', 'spd-pv-t12']) {
      const terminals = terminalsOf(byId(id));
      expect(terminals.filter((t) => t.side === 'top').map((t) => t.conductor), id).toEqual(['DCP', 'DCN']);
      expect(terminals.filter((t) => t.side === 'bottom').map((t) => t.conductor), id).toEqual(['PE']);
    }
  });

  it('keep every terminal on the device and the lines apart from each other', () => {
    for (const def of surgeProtectors) {
      const terminals = terminalsOf(def);
      for (const t of terminals) {
        expect(isValidPosition(t.unit, undefined, def.widthUnits), `${def.id} ${t.id}`).toBe(true);
      }
      const tops = terminals.filter((t) => t.side === 'top').map((t) => t.unit);
      expect(new Set(tops).size, def.id).toBe(tops.length);
    }
  });
});
