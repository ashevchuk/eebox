import { describe, expect, it } from 'vitest';
import { copyItems, pasteItems } from '../src/layout/clipboard';
import type { CombLookup } from '../src/layout/combs';
import { emptySchematic } from '../src/schematic/model';
import { applyEdit, inspect } from '../src/ui/inspector';
import { groupSelection, selectedIds, toggleItem } from '../src/ui/selection';
import { combAt, panelOf, place, resolve, widthOf } from './fixtures';

const lookup: CombLookup = { widthOf, sideOf: (m) => resolve(m)?.comb?.side };

describe('copy and paste', () => {
  it('places copies to the right of the originals with new ids, keeping labels', () => {
    const labelled = { ...place('p1', 'mcb1', 0, 0), label: 'Kitchen' };
    const panel = panelOf([labelled, place('p2', 'mcb1', 0, 1)]);
    const clip = copyItems(panel, ['p1', 'p2'], []);
    const result = pasteItems(panel, widthOf, lookup, clip);
    if (!result.ok) throw new Error(result.error);
    expect(result.placementIds).toEqual(['p3', 'p4']);
    const copies = result.panel.placements.slice(2);
    expect(copies.map((p) => p.slot)).toEqual([2, 3]);
    expect(copies[0]).toMatchObject({ label: 'Kitchen', module: labelled.module });
  });

  it('keeps the distance between the copied items and their combs', () => {
    const panel = { ...panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 2)]), combs: [combAt('c1', 'comb1', 0, 0)] };
    const clip = copyItems(panel, ['p1', 'p2'], ['c1']);
    const result = pasteItems(panel, widthOf, lookup, clip);
    if (!result.ok) throw new Error(result.error);
    expect(result.combIds).toEqual(['c2']);
    const offset = result.panel.placements.find((p) => p.id === result.placementIds[0])!.slot;
    expect(result.panel.combs.find((c) => c.id === 'c2')?.slot).toBe(offset);
  });

  it('goes to the left when the right side is full', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 22), place('p2', 'mcb1', 0, 23)], [], [24]);
    const clip = copyItems(panel, ['p2'], []);
    const result = pasteItems(panel, widthOf, lookup, clip);
    if (!result.ok) throw new Error(result.error);
    expect(result.panel.placements[2]?.slot).toBe(21);
  });

  it('reports no room when the rails are full, and nothing to paste for an empty clip', () => {
    const full = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)], [], [2]);
    expect(pasteItems(full, widthOf, lookup, copyItems(full, ['p1'], []))).toEqual({ ok: false, error: 'no-room' });
    expect(pasteItems(full, widthOf, lookup, { placements: [], combs: [] })).toEqual({ ok: false, error: 'nothing-copied' });
  });

  it('does not change the panel it was given', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0)]);
    pasteItems(panel, widthOf, lookup, copyItems(panel, ['p1'], []));
    expect(panel.placements).toHaveLength(1);
  });
});

describe('group selection', () => {
  it('toggles items in and out, collapsing to a plain selection', () => {
    const two = toggleItem({ placementId: 'p1' }, 'placement', 'p2');
    expect(two).toEqual({ placementIds: ['p1', 'p2'], combIds: [] });
    expect(toggleItem(two, 'comb', 'c1')).toEqual({ placementIds: ['p1', 'p2'], combIds: ['c1'] });
    expect(toggleItem(two, 'placement', 'p1')).toEqual({ placementId: 'p2' });
    expect(toggleItem({ placementId: 'p1' }, 'placement', 'p1')).toEqual({});
  });

  it('lists what is selected whether it is one item or several', () => {
    expect(selectedIds({ combId: 'c1' })).toEqual({ placements: [], combs: ['c1'] });
    expect(selectedIds(groupSelection(['p1', 'p2'], []))).toEqual({ placements: ['p1', 'p2'], combs: [] });
    expect(selectedIds({})).toEqual({ placements: [], combs: [] });
  });
});

describe('inspecting a group', () => {
  it('shows how many items are selected and refuses edits', () => {
    const context = {
      project: { panel: panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)]), schematic: emptySchematic() },
      selection: groupSelection(['p1', 'p2'], []),
      mode: 'panel' as const,
      resolve,
      snapshot: {},
      fromLibraries: resolve,
    };
    expect(inspect(context).title).toBe('2 items selected');
    expect(applyEdit(context, 'label', 'x').ok).toBe(false);
  });
});
