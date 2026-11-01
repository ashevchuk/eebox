import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { terminalsOf } from '../src/electrical/terminals';
import type { Library } from '../src/library/types';
import { validateLibrary } from '../src/library/validate';
import { fitTerminalsToWidth } from '../src/ui/moduleDesigner';

const ID = 'spd-t1-3pn';
const bundled = JSON.parse(raw) as Library;
const original = bundled.modules.find((m) => m.id === ID)!;
const draftAt = (widthUnits: number, terminals = original.terminals): Library => ({ ...bundled, id: 'mine', modules: [{ ...original, widthUnits, terminals }] });
const errorsOf = (library: Library) => {
  const result = validateLibrary(library);
  return result.ok ? [] : result.errors.map((e) => e.message);
};

describe('making a module of a fixed width narrower', () => {
  it('leaves terminals out of range, which the validator refuses', () => {
    expect(errorsOf(draftAt(4)).length).toBeGreaterThan(0);
  });

  it('is answered by scaling the layout to the new width, so the library validates and the lines stay apart', () => {
    const fitted = fitTerminalsToWidth(draftAt(4), ID, 8);
    expect(errorsOf(fitted)).toEqual([]);
    const tops = terminalsOf(fitted.modules[0]!).filter((t) => t.side === 'top').map((t) => t.unit);
    expect(new Set(tops).size).toBe(4);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    const earth = terminalsOf(fitted.modules[0]!).find((t) => t.side === 'bottom')!;
    expect(earth.unit).toBeCloseTo(1.5, 3);
  });

  it('changes nothing when the terminals still fit, or when the module grows', () => {
    const wide = draftAt(12);
    expect(fitTerminalsToWidth(wide, ID, 8)).toBe(wide);
    const roomy = draftAt(7.2);
    expect(fitTerminalsToWidth(roomy, ID, 8)).toBe(roomy);
  });

  it('leaves a resizable module to the repair that counts from the edge', () => {
    const resizable: Library = { ...draftAt(4), modules: [{ ...draftAt(4).modules[0]!, resizable: { minUnits: 2, maxUnits: 12 } }] };
    expect(fitTerminalsToWidth(resizable, ID, 8)).toBe(resizable);
  });
});
