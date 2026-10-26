import { describe, expect, it } from 'vitest';
import { unitsFromMm } from '../src/layout/units';
import { edgeMargin, fixedRange, isValidPosition } from '../src/library/positions';
import { blockTerminals } from '../src/library/terminalLayouts';
import { validateLibrary } from '../src/library/validate';

const clamp = (widthMm: number) => {
  const widthUnits = unitsFromMm(widthMm);
  const terminals = blockTerminals({ top: 1, bottom: 1, conductor: 'L', joined: true }, widthUnits, false);
  return validateLibrary({ schemaVersion: 1, id: 'clamps', name: 'Clamps', modules: [{ id: 'clamp', kind: 'terminal', name: 'Clamp', widthUnits, poles: 1, terminals }] });
};

describe('terminals on very narrow modules', () => {
  it('keep the usual margin of 0.15 unit from 0.6 units up and a quarter of the width below that', () => {
    expect(edgeMargin(1)).toBe(0.15);
    expect(edgeMargin(0.6)).toBe(0.15);
    expect(edgeMargin(0.4)).toBeCloseTo(0.1);
    expect(fixedRange(1)).toEqual({ min: -0.35, max: 0.35 });
  });

  it('let a feed-through clamp of 5.2 mm hold its two terminals', () => {
    expect(clamp(5.2).ok).toBe(true);
    expect(clamp(6.2).ok).toBe(true);
  });

  it('still refuse a position outside the module, however narrow it is', () => {
    const width = unitsFromMm(5.2);
    expect(isValidPosition(-0.5, undefined, width)).toBe(false);
    expect(isValidPosition(width, undefined, width)).toBe(false);
    expect(isValidPosition(-0.35, undefined, width)).toBe(true);
  });
});
