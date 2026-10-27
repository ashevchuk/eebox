import { describe, expect, it } from 'vitest';
import { arrangeModules, duplicateRow } from '../src/layout/arrangeModules';
import { MAX_RAILS } from '../src/layout/limits';
import { findProblems } from '../src/layout/placement';
import { combAt, panelOf, place, widthOf } from './fixtures';

const slots = (panel: ReturnType<typeof panelOf>, rail = 0) => panel.placements.filter((p) => p.rail === rail).sort((a, b) => a.slot - b.slot).map((p) => [p.id, p.slot]);

describe('arranging modules along a rail', () => {
  // breaker16 is 1 unit wide
  const row = () => panelOf([place('a', 'breaker16', 0, 2), place('b', 'breaker16', 0, 5), place('c', 'breaker16', 0, 9)], [], [24]);

  it('packs to the left against the first module of the group', () => {
    const result = arrangeModules(row(), widthOf, ['a', 'b', 'c'], 'pack-left');
    expect(result.ok && slots(result.panel)).toEqual([['a', 2], ['b', 3], ['c', 4]]);
  });

  it('packs to the right against the last module of the group', () => {
    const result = arrangeModules(row(), widthOf, ['a', 'b', 'c'], 'pack-right');
    expect(result.ok && slots(result.panel)).toEqual([['a', 7], ['b', 8], ['c', 9]]);
  });

  it('puts the group against the ends of the rail', () => {
    const start = arrangeModules(row(), widthOf, ['a', 'b', 'c'], 'row-start');
    const end = arrangeModules(row(), widthOf, ['a', 'b', 'c'], 'row-end');
    expect(start.ok && slots(start.panel)).toEqual([['a', 0], ['b', 1], ['c', 2]]);
    expect(end.ok && slots(end.panel)).toEqual([['a', 21], ['b', 22], ['c', 23]]);
  });

  it('spreads equal gaps between the first and the last and keeps those two where they are', () => {
    const result = arrangeModules(row(), widthOf, ['a', 'b', 'c'], 'spread');
    expect(result.ok && slots(result.panel)).toEqual([['a', 2], ['b', 5.5], ['c', 9]]);
  });

  it('wants three modules on a rail to spread them', () => {
    expect(arrangeModules(row(), widthOf, ['a', 'c'], 'spread')).toEqual({ ok: false, error: 'too-few' });
  });

  it('does nothing, and says so, when they already stand so', () => {
    const packed = arrangeModules(row(), widthOf, ['a', 'b', 'c'], 'pack-left');
    if (!packed.ok) throw new Error('setup');
    expect(arrangeModules(packed.panel, widthOf, ['a', 'b', 'c'], 'pack-left')).toEqual({ ok: false, error: 'nothing-to-do' });
    expect(arrangeModules(row(), widthOf, [], 'pack-left')).toEqual({ ok: false, error: 'nothing-to-do' });
  });

  it('refuses to put a module on one that is not chosen, and leaves the panel as it was', () => {
    const blocked = panelOf([place('a', 'breaker16', 0, 0), place('x', 'breaker16', 0, 1), place('b', 'breaker16', 0, 5)], [], [24]);
    expect(arrangeModules(blocked, widthOf, ['a', 'b'], 'pack-left')).toEqual({ ok: false, error: 'blocked' });
    expect(findProblems(blocked, widthOf)).toEqual([]);
  });

  it('arranges each rail on its own', () => {
    const two = panelOf([place('a', 'breaker16', 0, 3), place('b', 'breaker16', 0, 8), place('c', 'breaker16', 1, 6), place('d', 'breaker16', 1, 12)], [], [24, 24]);
    const result = arrangeModules(two, widthOf, ['a', 'b', 'c', 'd'], 'pack-left');
    expect(result.ok && [slots(result.panel, 0), slots(result.panel, 1)]).toEqual([[['a', 3], ['b', 4]], [['c', 6], ['d', 7]]]);
  });
});

describe('duplicating a row', () => {
  const base = () => {
    const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 2), place('p3', 'breaker16', 1, 4)], [combAt('c1', 'comb3', 0, 0)], [24, 12]);
    return { ...panel, railLabels: ['Incoming', 'Final'] };
  };

  it('puts a copy of the row, with its label, modules and combs, right under it', () => {
    const result = duplicateRow(base(), 0);
    if (!result.ok) throw new Error(result.error);
    const { panel } = result;
    expect(panel.railLengthsUnits).toEqual([24, 24, 12]);
    expect(panel.railLabels).toEqual(['Incoming', 'Incoming', 'Final']);
    expect(slots(panel, 1)).toHaveLength(2);
    expect(panel.combs.filter((c) => c.rail === 1)).toHaveLength(1);
    expect(slots(panel, 2)).toEqual([['p3', 4]]);
    expect(findProblems(panel, widthOf)).toEqual([]);
  });

  it('gives the copies new ids that nothing else has', () => {
    const result = duplicateRow(base(), 0);
    if (!result.ok) throw new Error(result.error);
    const ids = result.panel.placements.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.placementIds).toHaveLength(2);
    const combIds = result.panel.combs.map((c) => c.id);
    expect(new Set(combIds).size).toBe(combIds.length);
  });

  it('refuses an unknown row and a panel that has all the rows it may have', () => {
    expect(duplicateRow(base(), 7)).toEqual({ ok: false, error: 'unknown-rail' });
    const full = panelOf([], [], Array.from({ length: MAX_RAILS }, () => 12));
    expect(duplicateRow(full, 0).ok).toBe(false);
  });
});
