import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import { addPlate, addRail, railOfRowNumber, rowNumber, rowsOnPlateOf } from '../src/layout/plates';

function twoPlates() {
  let panel = createPanel([10, 10]);
  const added = addPlate(panel, 'Door', 300, 300);
  if (!added.ok || !added.id) throw new Error('plate not added');
  panel = added.panel;
  const rail = addRail(panel, added.id);
  if (!rail.ok) throw new Error('rail not added');
  return rail.panel;
}

describe('row numbers', () => {
  it('count from 1 on every plate', () => {
    const panel = twoPlates();
    expect(panel.rails.map((_r, i) => rowNumber(panel, i))).toEqual([1, 2, 1]);
  });

  it('count the rows of the plate of a row', () => {
    const panel = twoPlates();
    expect([0, 1, 2].map((i) => rowsOnPlateOf(panel, i))).toEqual([2, 2, 1]);
  });

  it('turn a number on a plate into the index in the panel, or refuse one the plate has not', () => {
    const panel = twoPlates();
    expect(railOfRowNumber(panel, 0, 2)).toBe(1);
    expect(railOfRowNumber(panel, 2, 1)).toBe(2);
    expect(railOfRowNumber(panel, 2, 2)).toBeNull();
    expect(railOfRowNumber(panel, 0, 0)).toBeNull();
  });
});
