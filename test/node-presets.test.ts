import { describe, expect, it } from 'vitest';
import { earthingProblem } from '../src/electrical/earthing';
import { FREE_NODE_PRESETS } from '../src/electrical/nodeTerminals';
import { CONDUCTORS, type Conductor } from '../src/library/types';

describe('the presets of sources and loads', () => {
  const presets = Object.entries(FREE_NODE_PRESETS) as Array<[string, { kind: string; conductors: readonly Conductor[]; earthing?: Parameters<typeof earthingProblem>[0] }]>;

  it('use each conductor once, and only known ones', () => {
    for (const [, preset] of presets) {
      expect(new Set(preset.conductors).size).toBe(preset.conductors.length);
      expect(preset.conductors.every((c) => CONDUCTORS.includes(c))).toBe(true);
    }
  });

  it('give a source that states its earthing system the conductors of that system', () => {
    const stated = presets.filter(([, p]) => p.earthing);
    expect(stated.map(([name]) => name)).toEqual(['sourcePen1', 'sourcePen']);
    for (const [, preset] of stated) expect(earthingProblem(preset.earthing!, preset.conductors)).toBeNull();
  });
});
