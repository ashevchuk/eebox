import { describe, expect, it } from 'vitest';
import { LENGTH_UNIT_FIELD, applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { loadLengthUnit, saveLengthUnit } from '../src/project/lengthUnitStorage';
import type { KeyValueStore } from '../src/project/autosave';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const context = (lengthUnit?: 'units' | 'mm'): InspectContext => ({
  project: { panel: panelOf([place('p1', 'breaker16', 0, 4)]), schematic: emptySchematic() },
  selection: { placementId: 'p1' },
  mode: 'panel',
  resolve,
  snapshot: {},
  fromLibraries: resolve,
  lengthUnit,
});
const fieldOf = (c: InspectContext, key: string) => inspect(c)!.fields.find((f) => f.key === key);

describe('length unit in the inspector', () => {
  it('shows the position in module units by default and in millimetres on request', () => {
    expect(fieldOf(context(), 'slot')?.value).toBe(4);
    expect(fieldOf(context('mm'), 'slot')?.value).toBe(70);
  });

  it('gives the limits in the unit that is shown', () => {
    const units = fieldOf(context(), 'slot');
    const mm = fieldOf(context('mm'), 'slot');
    expect(mm?.max).toBeCloseTo((units?.max ?? 0) * 17.5, 2);
  });

  it('offers the choice of unit and shows the current one', () => {
    expect(fieldOf(context('mm'), LENGTH_UNIT_FIELD)).toMatchObject({ kind: 'select', value: 'mm', options: ['units', 'mm'] });
    expect(fieldOf(context(), LENGTH_UNIT_FIELD)?.value).toBe('units');
  });

  it('reads a typed position as millimetres and stores module units', () => {
    const result = applyEdit(context('mm'), 'slot', '87.5');
    expect(result.ok && result.project.panel.placements[0]?.slot).toBe(5);
  });

  it('reads a typed position as module units when millimetres are not asked for', () => {
    const result = applyEdit(context(), 'slot', '5');
    expect(result.ok && result.project.panel.placements[0]?.slot).toBe(5);
  });

  it('keeps the choice of unit, and falls back to units when what is stored is not a unit', () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    expect(loadLengthUnit(store)).toBe('units');
    saveLengthUnit(store, 'mm');
    expect(loadLengthUnit(store)).toBe('mm');
    data.set('eebox:length-unit', 'furlongs');
    expect(loadLengthUnit(store)).toBe('units');
  });
});
