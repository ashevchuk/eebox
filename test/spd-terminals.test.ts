import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { terminalsOf } from '../src/electrical/terminals';
import type { Library } from '../src/library/types';

const surgeProtectors = (JSON.parse(raw) as Library).modules.filter((m) => m.kind === 'spd');

describe('the bundled surge protectors', () => {
  it('are the four variants', () => {
    expect(surgeProtectors.map((m) => m.id)).toEqual(['spd-t2-1p', 'spd-t2-1pn', 'spd-t2-3p', 'spd-t2-3pn']);
  });

  it('take the lines in on top and have one earth terminal below, so nothing passes through them', () => {
    const lines = { 'spd-t2-1p': ['L'], 'spd-t2-1pn': ['L', 'N'], 'spd-t2-3p': ['L1', 'L2', 'L3'], 'spd-t2-3pn': ['L1', 'L2', 'L3', 'N'] } as Record<string, string[]>;
    for (const def of surgeProtectors) {
      const terminals = terminalsOf(def);
      expect(terminals.filter((t) => t.side === 'top').map((t) => t.conductor), def.id).toEqual(lines[def.id]);
      expect(terminals.filter((t) => t.side === 'bottom').map((t) => t.conductor), def.id).toEqual(['PE']);
    }
  });

  it('keep the earth terminal within the width of the device', () => {
    for (const def of surgeProtectors) {
      const earth = terminalsOf(def).find((t) => t.conductor === 'PE')!;
      expect(earth.unit).toBeGreaterThanOrEqual(0);
      expect(earth.unit).toBeLessThanOrEqual(def.widthUnits - 1);
    }
  });
});
