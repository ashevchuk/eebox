import { describe, expect, it } from 'vitest';
import type { CombLookup } from '../src/layout/combs';
import { moveGroup } from '../src/layout/group';
import { itemsInRect, moduleRect, rectBetween } from '../src/view/geometry';
import { combAt, panelOf, place, resolve, widthOf } from './fixtures';

const lookup: CombLookup = { widthOf, sideOf: (m) => resolve(m)?.comb?.side };

describe('moveGroup', () => {
  const panel = () => ({
    ...panelOf([place('p1', 'mcb1', 0, 2), place('p2', 'mcb1', 0, 3), place('p3', 'mcb1', 0, 10)]),
    combs: [combAt('c1', 'comb1', 0, 2)],
  });

  it('moves the chosen items together and keeps their ids and the others where they are', () => {
    const result = moveGroup(panel(), widthOf, lookup, ['p1', 'p2'], ['c1'], 0, 4);
    if (!result.ok) throw new Error('should move');
    const slots = Object.fromEntries(result.panel.placements.map((p) => [p.id, p.slot]));
    expect(slots).toEqual({ p1: 6, p2: 7, p3: 10 });
    expect(result.panel.combs[0]).toMatchObject({ id: 'c1', slot: 6 });
  });

  it('can move to another row', () => {
    const result = moveGroup(panel(), widthOf, lookup, ['p1'], [], 1, 0);
    expect(result.ok && result.panel.placements.find((p) => p.id === 'p1')).toMatchObject({ rail: 1, slot: 2 });
  });

  it('refuses when any item would land on one that stays, or off the rail', () => {
    expect(moveGroup(panel(), widthOf, lookup, ['p1', 'p2'], [], 0, 7).ok).toBe(false);
    expect(moveGroup(panel(), widthOf, lookup, ['p1', 'p2'], [], 0, 30).ok).toBe(false);
    expect(moveGroup(panel(), widthOf, lookup, ['p1'], [], 5, 0).ok).toBe(false);
  });

  it('lets the group step over its own old places', () => {
    expect(moveGroup(panel(), widthOf, lookup, ['p1', 'p2'], [], 0, 1).ok).toBe(true);
  });

  it('does not change the panel it was given', () => {
    const before = panel();
    moveGroup(before, widthOf, lookup, ['p1'], [], 0, 4);
    expect(before.placements[0]?.slot).toBe(2);
  });
});

describe('selecting with a rectangle', () => {
  const panel = { ...panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 5), place('p3', 'mcb1', 1, 0)]), combs: [combAt('c1', 'comb1', 0, 0)] };
  const combInfo = () => ({ widthUnits: 6, side: 'top' as const });

  it('picks everything the rectangle touches', () => {
    const first = moduleRect(panel, 0, 0, 1);
    const second = moduleRect(panel, 0, 5, 1);
    const area = rectBetween({ x: first.x + 2, y: first.y + 2 }, { x: second.x + 2, y: second.y + 2 });
    expect(itemsInRect(panel, widthOf, combInfo, area)).toEqual({ placements: ['p1', 'p2'], combs: ['c1'] });
  });

  it('works whichever corner the drag starts from, and finds nothing in empty space', () => {
    expect(rectBetween({ x: 10, y: 10 }, { x: 0, y: 4 })).toEqual({ x: 0, y: 4, width: 10, height: 6 });
    expect(itemsInRect(panel, widthOf, combInfo, { x: -500, y: -500, width: 10, height: 10 })).toEqual({ placements: [], combs: [] });
  });
});
