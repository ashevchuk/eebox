import { describe, expect, it } from 'vitest';
import { terminalsOf } from '../src/electrical/terminals';
import { sideRange } from '../src/library/positions';
import { validateLibrary } from '../src/library/validate';

const bar = (extra: Record<string, unknown> = {}, terminals: unknown[] = [{ name: 'N', conductor: 'N', side: 'top', unit: 0.35 }, { name: 'M', conductor: 'N', side: 'top', unit: 0.65 }]) => ({
  id: 'bar',
  kind: 'busbar',
  name: 'Bar',
  widthUnits: 0.7,
  heightMm: 90,
  mounting: 'rail',
  poles: 1,
  sideTerminals: true,
  terminals,
  ...extra,
});
const check = (module: Record<string, unknown>) => validateLibrary({ schemaVersion: 1, id: 'lib', name: 'Lib', modules: [module] });
const paths = (module: Record<string, unknown>) => {
  const result = check(module);
  return result.ok ? [] : result.errors.map((e) => e.path);
};

describe('a module with its terminals down the sides', () => {
  it('is valid with a position from the top edge for each terminal', () => {
    expect(check(bar()).ok).toBe(true);
  });

  it('counts the positions from the top edge, so the range follows the height and not the width', () => {
    expect(sideRange(90).min).toBe(0.15);
    expect(sideRange(90).max).toBeCloseTo(90 / 17.5 - 0.15, 5);
    expect(paths(bar({}, [{ name: 'N', conductor: 'N', side: 'top', unit: 4.9 }]))).toEqual([]);
    expect(paths(bar({}, [{ name: 'N', conductor: 'N', side: 'top', unit: 5.1 }]))).toEqual(['modules[0].terminals[0].unit']);
    expect(paths(bar({}, [{ name: 'N', conductor: 'N', side: 'top', unit: 0.1 }]))).toEqual(['modules[0].terminals[0].unit']);
    expect(paths(bar({ heightMm: 60 }, [{ name: 'N', conductor: 'N', side: 'top', unit: 3.2 }]))).toEqual([]);
    expect(paths(bar({ heightMm: 60 }, [{ name: 'N', conductor: 'N', side: 'top', unit: 3.3 }]))).toEqual(['modules[0].terminals[0].unit']);
  });

  it('needs a position on every terminal and no group', () => {
    expect(paths(bar({}, [{ name: 'N', conductor: 'N', side: 'top' }]))).toEqual(['modules[0].terminals[0].unit']);
    expect(paths(bar({}, [{ name: 'N', conductor: 'N', side: 'top', count: 4 }]))).toEqual(['modules[0].terminals[0].unit', 'modules[0].terminals[0].count']);
  });

  it('needs explicit terminals and cannot be resizable', () => {
    expect(paths(bar({ terminals: undefined }))).toEqual(['modules[0].sideTerminals']);
    expect(paths(bar({ resizable: { minUnits: 0.7, maxUnits: 2 } }))).toEqual(['modules[0].sideTerminals']);
    expect(paths(bar({ sideTerminals: 'yes' }))).toEqual(['modules[0].sideTerminals']);
  });

  it('keeps the positions it is given, so terminalsOf reads them as distances from the top', () => {
    const def = check(bar());
    if (!def.ok) throw new Error('invalid');
    expect(terminalsOf(def.library.modules[0]!).map((t) => [t.name, t.side, t.unit])).toEqual([['N', 'top', 0.35], ['M', 'top', 0.65]]);
  });
});
