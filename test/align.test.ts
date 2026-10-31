import { describe, expect, it } from 'vitest';
import { alignFree, alignableCount } from '../src/layout/align';
import { createPanel } from '../src/layout/panel';
import type { FreePlacement, Panel, Sizes } from '../src/layout/placement';
import { MODULE_UNIT_MM } from '../src/library/types';

const sizes: Sizes = { widthOf: () => 2, heightOf: (p) => (p.module.moduleId === 'tall' ? 120 : 60) };
const free = (id: string, x: number, y: number, moduleId = 'short'): FreePlacement => ({ id, module: { libraryId: 'l', moduleId }, plate: createPanel([10]).plates[0]!.id, x, y });
const WIDTH = 2 * MODULE_UNIT_MM;

function panelWith(...placements: FreePlacement[]): Panel {
  return { ...createPanel([10]), placements };
}
const at = (panel: Panel, id: string) => {
  const p = panel.placements.find((q) => q.id === id) as FreePlacement;
  return { x: p.x, y: p.y };
};
const aligned = (panel: Panel, ids: string[], how: Parameters<typeof alignFree>[4], ducts: string[] = []) => {
  const result = alignFree(panel, sizes, ids, ducts, how);
  if (!result.ok) throw new Error('refused');
  return result.panel;
};

describe('alignFree', () => {
  const panel = panelWith(free('a', 10, 20), free('b', 150, 50, 'tall'), free('c', 40, 200));

  it('lines devices up by their left and top edges', () => {
    const left = aligned(panel, ['a', 'b', 'c'], 'left');
    expect(['a', 'b', 'c'].map((id) => at(left, id).x)).toEqual([10, 10, 10]);
    const top = aligned(panel, ['a', 'b', 'c'], 'top');
    expect(['a', 'b', 'c'].map((id) => at(top, id).y)).toEqual([20, 20, 20]);
  });

  it('lines devices up by their right and bottom edges, whatever their size', () => {
    const right = aligned(panel, ['a', 'b'], 'right');
    expect(at(right, 'a').x + WIDTH).toBe(at(right, 'b').x + WIDTH);
    const bottom = aligned(panel, ['a', 'b'], 'bottom');
    expect(at(bottom, 'a').y + 60).toBe(at(bottom, 'b').y + 120);
  });

  it('puts the middles of devices on one line', () => {
    const middle = aligned(panel, ['a', 'b'], 'centre-y');
    expect(at(middle, 'a').y + 30).toBe(at(middle, 'b').y + 60);
  });

  it('spreads devices with equal gaps and keeps the outer two where they are', () => {
    const spread = aligned(panel, ['a', 'b', 'c'], 'spread-x');
    expect(at(spread, 'a').x).toBe(10);
    expect(at(spread, 'b').x).toBe(150);
    expect(at(spread, 'c').x).not.toBe(40);
    const gapAfterA = at(spread, 'c').x - (at(spread, 'a').x + WIDTH);
    const gapBeforeB = at(spread, 'b').x - (at(spread, 'c').x + WIDTH);
    expect(gapAfterA).toBeCloseTo(gapBeforeB, 5);
  });

  it('leaves devices on rails and other devices alone', () => {
    const mixed: Panel = { ...panel, placements: [...panel.placements, { id: 'r', module: { libraryId: 'l', moduleId: 'short' }, rail: 0, slot: 0 }] };
    const result = aligned(mixed, ['a', 'b', 'r'], 'left');
    expect(result.placements.find((p) => p.id === 'r')).toEqual({ id: 'r', module: { libraryId: 'l', moduleId: 'short' }, rail: 0, slot: 0 });
    expect(at(result, 'c')).toEqual({ x: 40, y: 200 });
  });

  it('aligns a duct together with devices', () => {
    const withDuct: Panel = { ...panel, ducts: [{ id: 'd1', plate: panel.plates[0]!.id, x: 100, y: 5, widthMm: 200, heightMm: 30 }] };
    const result = aligned(withDuct, ['a'], 'left', ['d1']);
    expect(result.ducts?.[0]).toMatchObject({ x: 10, y: 5 });
    expect(at(result, 'a')).toEqual({ x: 10, y: 20 });
  });

  it('refuses one thing, two for spreading, and gaps that would be negative', () => {
    expect(alignFree(panel, sizes, ['a'], [], 'left').ok).toBe(false);
    expect(alignFree(panel, sizes, ['a', 'b'], [], 'spread-x').ok).toBe(false);
    const crowded = panelWith(free('a', 0, 0), free('b', 10, 0), free('c', 20, 0));
    expect(alignFree(crowded, sizes, ['a', 'b', 'c'], [], 'spread-x').ok).toBe(false);
  });

  it('counts what can be aligned', () => {
    const mixed: Panel = { ...panel, placements: [...panel.placements, { id: 'r', module: { libraryId: 'l', moduleId: 'short' }, rail: 0, slot: 0 }] };
    expect(alignableCount(mixed, ['a', 'b', 'r'], [])).toBe(2);
  });
});
