import { describe, expect, it } from 'vitest';
import { GRID_SIZES_MM, loadGrid, saveGrid } from '../src/project/gridStorage';
import type { KeyValueStore } from '../src/project/autosave';
import { snapToGrid, type Snapped } from '../src/view/snap';

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};
const origin = { x: 40, y: 40 };
const spot = (x: number, y: number, guides: Snapped['guides'] = []): Snapped => ({ x, y, guides });

describe('snapToGrid', () => {
  it('rounds both axes to lines that start at the corner of the plate', () => {
    expect(snapToGrid(spot(103, 58), 10, origin)).toMatchObject({ x: 100, y: 60 });
    expect(snapToGrid(spot(106, 44), 10, origin)).toMatchObject({ x: 110, y: 40 });
  });

  it('leaves an axis that was drawn to an edge where the edge put it', () => {
    const snapped = snapToGrid(spot(103, 58, [{ axis: 'x', at: 103 }]), 10, origin);
    expect(snapped.x).toBe(103);
    expect(snapped.y).toBe(60);
  });

  it('changes nothing for a grid of 0', () => {
    const before = spot(103.7, 58.2);
    expect(snapToGrid(before, 0, origin)).toBe(before);
  });
});

describe('the stored grid', () => {
  it('keeps one of the offered sizes and falls back to none for anything else', () => {
    const store = memory();
    expect(loadGrid(store)).toBe(0);
    saveGrid(store, 10);
    expect(loadGrid(store)).toBe(10);
    store.setItem('eebox:grid', '7');
    expect(loadGrid(store)).toBe(0);
    expect(GRID_SIZES_MM).toContain(0);
  });
});
