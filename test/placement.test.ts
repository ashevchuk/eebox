import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import {
  addPlacement,
  findProblems,
  insertPlacement,
  movePlacement,
  removePlacement,
  type Panel,
  type Placement,
  type PlacementError,
  type WidthOf,
} from '../src/layout/placement';

const WIDTHS: Record<string, number> = { one: 1, two: 2, four: 4 };
const widthOf: WidthOf = (item) => item.widthUnits ?? WIDTHS[item.module.moduleId];

const place = (id: string, moduleId: string, rail: number, slot: number): Placement => ({
  id,
  module: { libraryId: 'lib', moduleId },
  rail,
  slot,
});

const emptyPanel = (): Panel => createPanel([6, 4]);

function panelWith(...placements: Placement[]): Panel {
  return { ...emptyPanel(), placements };
}

function errorOf(result: { ok: boolean; error?: PlacementError }): PlacementError {
  if (result.ok || !result.error) throw new Error('expected a placement error');
  return result.error;
}

describe('addPlacement', () => {
  it('places a module on an empty rail', () => {
    const result = addPlacement(emptyPanel(), widthOf, place('a', 'two', 0, 0));
    expect(result.ok && result.panel.placements).toEqual([place('a', 'two', 0, 0)]);
  });

  it('allows modules that touch without overlapping', () => {
    const panel = panelWith(place('a', 'two', 0, 0));
    expect(addPlacement(panel, widthOf, place('b', 'two', 0, 2)).ok).toBe(true);
  });

  it('allows a module that exactly fills the rail', () => {
    expect(addPlacement(emptyPanel(), widthOf, place('a', 'four', 1, 0)).ok).toBe(true);
  });

  it.each([
    ['overlapping the start', 1],
    ['overlapping the end', 3],
    ['fully containing the other', 0],
  ])('rejects a module %s of an existing one', (_label, slot) => {
    const panel = panelWith(place('a', 'two', 0, 2));
    const moduleId = slot === 0 ? 'four' : 'two';
    expect(errorOf(addPlacement(panel, widthOf, place('b', moduleId, 0, slot)))).toEqual({
      kind: 'overlap',
      with: 'a',
    });
  });

  it('ignores placements on other rails', () => {
    const panel = panelWith(place('a', 'two', 0, 0));
    expect(addPlacement(panel, widthOf, place('b', 'two', 1, 0)).ok).toBe(true);
  });

  it.each([
    ['past the rail end', place('a', 'two', 0, 5)],
    ['at a negative slot', place('a', 'one', 0, -1)],
    ['at a fractional slot', place('a', 'one', 0, 0.5)],
  ])('rejects a module %s', (_label, placement) => {
    expect(errorOf(addPlacement(emptyPanel(), widthOf, placement))).toEqual({
      kind: 'out-of-rail',
    });
  });

  it('rejects an unknown rail, an unknown module and a duplicate id', () => {
    const panel = panelWith(place('a', 'one', 0, 0));
    expect(errorOf(addPlacement(panel, widthOf, place('b', 'one', 2, 0)))).toEqual({
      kind: 'unknown-rail',
    });
    expect(errorOf(addPlacement(panel, widthOf, place('b', 'ghost', 0, 3)))).toEqual({
      kind: 'unknown-module',
    });
    expect(errorOf(addPlacement(panel, widthOf, place('a', 'one', 0, 3)))).toEqual({
      kind: 'duplicate-id',
    });
  });

  it('does not mutate the input panel', () => {
    const panel = emptyPanel();
    addPlacement(panel, widthOf, place('a', 'one', 0, 0));
    expect(panel.placements).toEqual([]);
  });
});

describe('movePlacement', () => {
  it('moves a module into free space, including another rail', () => {
    const panel = panelWith(place('a', 'two', 0, 0));
    const result = movePlacement(panel, widthOf, 'a', 1, 2);
    expect(result.ok && result.panel.placements).toEqual([place('a', 'two', 1, 2)]);
  });

  it('allows a shift that overlaps the module own old position', () => {
    const panel = panelWith(place('a', 'two', 0, 0));
    expect(movePlacement(panel, widthOf, 'a', 0, 1).ok).toBe(true);
  });

  it('rejects a move onto another module and leaves the panel unchanged', () => {
    const panel = panelWith(place('a', 'two', 0, 0), place('b', 'two', 0, 2));
    expect(errorOf(movePlacement(panel, widthOf, 'a', 0, 1))).toEqual({
      kind: 'overlap',
      with: 'b',
    });
    expect(panel.placements[0]).toEqual(place('a', 'two', 0, 0));
  });

  it('rejects a move past the rail end and an unknown id', () => {
    const panel = panelWith(place('a', 'two', 0, 0));
    expect(errorOf(movePlacement(panel, widthOf, 'a', 0, 5))).toEqual({ kind: 'out-of-rail' });
    expect(errorOf(movePlacement(panel, widthOf, 'zzz', 0, 0))).toEqual({
      kind: 'unknown-placement',
    });
  });
});

describe('removePlacement', () => {
  it('removes a placement and frees its slots', () => {
    const panel = panelWith(place('a', 'two', 0, 0));
    const removed = removePlacement(panel, 'a');
    if (!removed.ok) throw new Error('remove failed');
    expect(removed.panel.placements).toEqual([]);
    expect(addPlacement(removed.panel, widthOf, place('b', 'two', 0, 0)).ok).toBe(true);
  });

  it('rejects an unknown id', () => {
    expect(errorOf(removePlacement(emptyPanel(), 'a'))).toEqual({ kind: 'unknown-placement' });
  });
});

describe('findProblems', () => {
  it('reports nothing for a valid panel', () => {
    const panel = panelWith(place('a', 'two', 0, 0), place('b', 'two', 0, 2));
    expect(findProblems(panel, widthOf)).toEqual([]);
  });

  it('reports an overlap once, against the later placement', () => {
    const panel = panelWith(place('a', 'two', 0, 0), place('b', 'two', 0, 1));
    expect(findProblems(panel, widthOf)).toEqual([
      { placementId: 'b', error: { kind: 'overlap', with: 'a' } },
    ]);
  });

  it('reports overflow and modules missing from the library', () => {
    const panel = panelWith(place('a', 'four', 1, 1), place('b', 'ghost', 0, 0));
    expect(findProblems(panel, widthOf)).toEqual([
      { placementId: 'a', error: { kind: 'out-of-rail' } },
      { placementId: 'b', error: { kind: 'unknown-module' } },
    ]);
  });
});

describe('insertPlacement', () => {
  const W: Record<string, number> = { one: 1, two: 2, four: 4 };
  const widthByName: WidthOf = (item) => item.widthUnits ?? W[item.module.moduleId];
  const rowOf = (...entries: Array<[string, string, number]>): Panel => ({
    ...createPanel([6, 6]),
    placements: entries.map(([id, moduleId, slot]) => place(id, moduleId, 0, slot)),
  });
  const slots = (panel: Panel, rail = 0) =>
    Object.fromEntries(panel.placements.filter((p) => p.rail === rail).map((p) => [p.id, p.slot]));
  const unwrap = (result: ReturnType<typeof insertPlacement>): Panel => {
    if (!result.ok) throw new Error(`unexpected failure: ${result.error.kind}`);
    return result.panel;
  };

  it('behaves like addPlacement and movePlacement when nothing is in the way', () => {
    const panel = rowOf(['a', 'one', 0]);
    expect(unwrap(insertPlacement(panel, widthByName, place('b', 'one', 0, 3)))).toEqual(
      unwrap(addPlacement(panel, widthByName, place('b', 'one', 0, 3))),
    );
    expect(unwrap(insertPlacement(panel, widthByName, place('a', 'one', 0, 4), 'a')).placements[0]?.slot).toBe(4);
  });

  it('pushes the module in the way to the right', () => {
    const panel = rowOf(['a', 'one', 0], ['b', 'one', 1]);
    const result = unwrap(insertPlacement(panel, widthByName, place('x', 'one', 0, 0)));
    expect(slots(result)).toEqual({ a: 1, b: 2, x: 0 });
  });

  it('pushes a chain of neighbours by the inserted width', () => {
    const panel = rowOf(['a', 'one', 0], ['b', 'one', 1], ['c', 'one', 2]);
    const result = unwrap(insertPlacement(panel, widthByName, place('x', 'two', 0, 0)));
    expect(slots(result)).toEqual({ a: 2, b: 3, c: 4, x: 0 });
  });

  it('keeps gaps: modules that are not in the way stay put', () => {
    const panel = rowOf(['a', 'one', 0], ['b', 'one', 4]);
    const result = unwrap(insertPlacement(panel, widthByName, place('x', 'one', 0, 0)));
    expect(slots(result)).toEqual({ a: 1, b: 4, x: 0 });
  });

  it('reorders inside a full row by falling back to pushing left', () => {
    const panel = { ...createPanel([3]), placements: [place('a', 'one', 0, 0), place('b', 'one', 0, 1), place('c', 'one', 0, 2)] };
    const result = unwrap(insertPlacement(panel, widthByName, place('a', 'one', 0, 2), 'a'));
    expect(slots(result)).toEqual({ a: 2, b: 0, c: 1 });
  });

  it('moves a module to another row and pushes only that row', () => {
    const panel: Panel = {
      ...createPanel([6, 6]),
      placements: [place('a', 'one', 0, 0), place('b', 'one', 1, 0), place('c', 'one', 1, 1)],
    };
    const result = unwrap(insertPlacement(panel, widthByName, place('a', 'one', 1, 0), 'a'));
    expect(slots(result, 1)).toEqual({ a: 0, b: 1, c: 2 });
    expect(slots(result, 0)).toEqual({});
  });

  it('fails when neither side has room, leaving the panel unchanged', () => {
    const panel = { ...createPanel([3]), placements: [place('a', 'one', 0, 0), place('b', 'one', 0, 1), place('c', 'one', 0, 2)] };
    const result = insertPlacement(panel, widthByName, place('x', 'one', 0, 1));
    expect(result.ok).toBe(false);
    expect(panel.placements.map((p) => p.slot)).toEqual([0, 1, 2]);
  });

  it('passes through errors that are not about overlap', () => {
    expect(errorOf(insertPlacement(rowOf(), widthByName, place('x', 'ghost', 0, 0)))).toEqual({ kind: 'unknown-module' });
    expect(errorOf(insertPlacement(rowOf(), widthByName, place('x', 'four', 0, 4)))).toEqual({ kind: 'out-of-rail' });
    expect(errorOf(insertPlacement(rowOf(['a', 'one', 0]), widthByName, place('a', 'one', 0, 3)))).toEqual({ kind: 'duplicate-id' });
  });

  it('never produces an overlapping or out-of-rail result, wherever the drop lands', () => {
    const panel = rowOf(['a', 'one', 0], ['b', 'two', 1], ['c', 'one', 4]);
    for (const moduleId of ['one', 'two', 'four']) {
      for (let slot = 0; slot <= 6 - (W[moduleId] ?? 1); slot++) {
        const result = insertPlacement(panel, widthByName, place('x', moduleId, 0, slot));
        if (result.ok) expect(findProblems(result.panel, widthByName)).toEqual([]);
      }
    }
  });

  it('does not mutate the input panel', () => {
    const panel = rowOf(['a', 'one', 0]);
    insertPlacement(panel, widthByName, place('x', 'one', 0, 0));
    expect(panel.placements.map((p) => p.slot)).toEqual([0]);
  });
});
