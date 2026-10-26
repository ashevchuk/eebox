import { describe, expect, it } from 'vitest';
import {
  addPlacement,
  findProblems,
  movePlacement,
  removePlacement,
  type Panel,
  type Placement,
  type PlacementError,
  type WidthOf,
} from '../src/layout/placement';

const WIDTHS: Record<string, number> = { one: 1, two: 2, four: 4 };
const widthOf: WidthOf = (ref) => WIDTHS[ref.moduleId];

const place = (id: string, moduleId: string, rail: number, slot: number): Placement => ({
  id,
  module: { libraryId: 'lib', moduleId },
  rail,
  slot,
});

const emptyPanel = (): Panel => ({ railLengthsUnits: [6, 4], placements: [] });

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
