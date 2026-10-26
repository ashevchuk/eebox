import { describe, expect, it } from 'vitest';
import { copyItems, repeatItems } from '../src/layout/clipboard';
import type { CombLookup } from '../src/layout/combs';
import { emptySchematic } from '../src/schematic/model';
import { applyEdit, inspect } from '../src/ui/inspector';
import { combAt, panelOf, place, resolve, widthOf } from './fixtures';

const lookup: CombLookup = { widthOf, sideOf: (m) => resolve(m)?.comb?.side };

describe('repeatItems', () => {
  it('places the copies one after another, edge to edge', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0)]);
    const result = repeatItems(panel, widthOf, lookup, copyItems(panel, ['p1'], []), 5);
    if (!result.ok) throw new Error(result.error);
    expect(result.added).toBe(5);
    expect(result.panel.placements.map((p) => p.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(result.panel.placements.map((p) => p.id)).size).toBe(6);
  });

  it('keeps the spacing of a group when it repeats it', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 2)]);
    const result = repeatItems(panel, widthOf, lookup, copyItems(panel, ['p1', 'p2'], []), 2);
    if (!result.ok) throw new Error(result.error);
    expect(result.panel.placements.map((p) => p.slot).sort((a, b) => a - b)).toEqual([0, 2, 3, 5, 6, 8]);
  });

  it('places as many as fit and says how many that was', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0)], [], [4]);
    const result = repeatItems(panel, widthOf, lookup, copyItems(panel, ['p1'], []), 10);
    expect(result).toMatchObject({ ok: true, added: 3 });
  });

  it('fails when not even one fits, and does not change the panel', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0)], [], [1]);
    expect(repeatItems(panel, widthOf, lookup, copyItems(panel, ['p1'], []), 3)).toEqual({ ok: false, error: 'no-room' });
    expect(panel.placements).toHaveLength(1);
  });

  it('is capped, so a typed 1000000 cannot freeze the page', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0)], [], [144]);
    const result = repeatItems(panel, widthOf, lookup, copyItems(panel, ['p1'], []), 1_000_000);
    expect(result.ok && result.added).toBeLessThanOrEqual(100);
  });
});

describe('Add copies in the inspector', () => {
  const context = (selection: Record<string, unknown>) => ({
    project: { panel: { ...panelOf([place('p1', 'mcb1', 0, 0)], [], [24]), combs: [combAt('c1', 'comb1', 1, 0)] }, schematic: emptySchematic() },
    selection,
    mode: 'panel' as const,
    resolve,
    snapshot: {},
    fromLibraries: resolve,
  });

  it('is offered for a module, a comb and a group', () => {
    for (const selection of [{ placementId: 'p1' }, { combId: 'c1' }, { placementIds: ['p1'], combIds: ['c1'] }]) {
      expect(inspect(context(selection)).fields.some((f) => f.key === 'repeat')).toBe(true);
    }
  });

  it('adds the copies, selects them and says so', () => {
    const result = applyEdit(context({ placementId: 'p1' }), 'repeat', '4');
    if (!result.ok) throw new Error(result.message);
    expect(result.project.panel.placements).toHaveLength(5);
    expect(result.selection).toEqual({ placementIds: ['p2', 'p3', 'p4', 'p5'], combIds: [] });
    expect(result.message).toBe('Added 4 copies.');
  });

  it('reports a partial result', () => {
    const result = applyEdit(context({ placementId: 'p1' }), 'repeat', '99');
    expect(result.ok && result.message).toBe('Only 23 of 99 copies fit.');
  });

  it('refuses a number that is not between 1 and the cap', () => {
    for (const bad of ['', '0', '-3', 'x', '101']) expect(applyEdit(context({ placementId: 'p1' }), 'repeat', bad).ok, bad).toBe(false);
  });
});
