import { describe, expect, it } from 'vitest';
import {
  addComb,
  findCombProblems,
  moveComb,
  nextCombId,
  removeComb,
  type CombError,
  type CombLookup,
  type CombResult,
} from '../src/layout/combs';
import { createPanel } from '../src/layout/panel';
import type { CombPlacement, ModuleRef, Panel } from '../src/layout/placement';
import type { TerminalSide } from '../src/library/types';

const WIDTH: Record<string, number> = { top6: 6, top12: 12, bottom6: 6 };
const SIDE: Record<string, TerminalSide> = { top6: 'top', top12: 'top', bottom6: 'bottom' };
const lookup: CombLookup = {
  widthOf: (item) => item.widthUnits ?? WIDTH[item.module.moduleId],
  sideOf: (ref: ModuleRef) => SIDE[ref.moduleId],
};

const comb = (id: string, moduleId: string, rail: number, slot: number): CombPlacement => ({
  id,
  module: { libraryId: 'lib', moduleId },
  rail,
  slot,
});

const panelWith = (...combs: CombPlacement[]): Panel => ({ ...createPanel([12, 12]), combs });

function unwrap(result: CombResult): Panel {
  if (!result.ok) throw new Error(`unexpected failure: ${result.error.kind}`);
  return result.panel;
}

function errorOf(result: CombResult): CombError {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

describe('addComb', () => {
  it('places a comb on a rail', () => {
    expect(unwrap(addComb(panelWith(), lookup, comb('c1', 'top6', 0, 3))).combs).toEqual([comb('c1', 'top6', 0, 3)]);
  });

  it('allows a comb that exactly fills the rail', () => {
    expect(addComb(panelWith(), lookup, comb('c1', 'top12', 0, 0)).ok).toBe(true);
  });

  it('allows touching combs, and a top and a bottom comb over each other', () => {
    const panel = panelWith(comb('c1', 'top6', 0, 0));
    expect(addComb(panel, lookup, comb('c2', 'top6', 0, 6)).ok).toBe(true);
    expect(addComb(panel, lookup, comb('c3', 'bottom6', 0, 0)).ok).toBe(true);
  });

  it('rejects overlap on the same side of the same rail only', () => {
    const panel = panelWith(comb('c1', 'top6', 0, 0));
    expect(errorOf(addComb(panel, lookup, comb('c2', 'top6', 0, 5)))).toEqual({ kind: 'overlap', with: 'c1' });
    expect(addComb(panel, lookup, comb('c2', 'top6', 1, 0)).ok).toBe(true);
  });

  it.each([
    ['past the end', comb('c1', 'top6', 0, 7)],
    ['at a negative slot', comb('c1', 'top6', 0, -1)],
    ['at a slot that is not a number', comb('c1', 'top6', 0, Number.NaN)],
  ])('rejects a comb %s', (_label, candidate) => {
    expect(errorOf(addComb(panelWith(), lookup, candidate))).toEqual({ kind: 'out-of-rail' });
  });

  it('accepts a comb at a fractional slot, and still finds an overlap and the end of the rail', () => {
    const first = addComb(panelWith(), lookup, comb('c1', 'top6', 0, 0.5));
    if (!first.ok) throw new Error('setup');
    expect(errorOf(addComb(first.panel, lookup, comb('c2', 'top6', 0, 3)))).toEqual({ kind: 'overlap', with: 'c1' });
    expect(errorOf(addComb(first.panel, lookup, comb('c2', 'top6', 0, 6.5)))).toEqual({ kind: 'out-of-rail' });
  });

  it('rejects an unknown rail, a module that is not a comb, and a duplicate id', () => {
    expect(errorOf(addComb(panelWith(), lookup, comb('c1', 'top6', 2, 0)))).toEqual({ kind: 'unknown-rail' });
    expect(errorOf(addComb(panelWith(), lookup, comb('c1', 'breaker', 0, 0)))).toEqual({ kind: 'not-a-comb' });
    expect(errorOf(addComb(panelWith(comb('c1', 'top6', 0, 0)), lookup, comb('c1', 'top6', 1, 0)))).toEqual({
      kind: 'duplicate-id',
    });
  });

  it('does not mutate the input panel', () => {
    const panel = panelWith();
    addComb(panel, lookup, comb('c1', 'top6', 0, 0));
    expect(panel.combs).toEqual([]);
  });
});

describe('moveComb and removeComb', () => {
  it('moves a comb and lets it overlap its own old position', () => {
    const panel = panelWith(comb('c1', 'top6', 0, 0));
    expect(unwrap(moveComb(panel, lookup, 'c1', 1, 2)).combs[0]).toMatchObject({ rail: 1, slot: 2 });
    expect(moveComb(panel, lookup, 'c1', 0, 2).ok).toBe(true);
  });

  it('rejects a move onto another comb and an unknown id', () => {
    const panel = panelWith(comb('c1', 'top6', 0, 0), comb('c2', 'top6', 0, 6));
    expect(errorOf(moveComb(panel, lookup, 'c1', 0, 3))).toEqual({ kind: 'overlap', with: 'c2' });
    expect(errorOf(moveComb(panel, lookup, 'zzz', 0, 0))).toEqual({ kind: 'unknown-comb' });
  });

  it('removes a comb and frees its place', () => {
    const removed = unwrap(removeComb(panelWith(comb('c1', 'top6', 0, 0)), 'c1'));
    expect(removed.combs).toEqual([]);
    expect(errorOf(removeComb(removed, 'c1'))).toEqual({ kind: 'unknown-comb' });
  });
});

describe('findCombProblems and nextCombId', () => {
  it('reports an overlap once, against the later comb, and combs that are not combs', () => {
    const panel = panelWith(comb('c1', 'top6', 0, 0), comb('c2', 'top6', 0, 3), comb('c3', 'breaker', 1, 0));
    expect(findCombProblems(panel, lookup)).toEqual([
      { combId: 'c2', error: { kind: 'overlap', with: 'c1' } },
      { combId: 'c3', error: { kind: 'not-a-comb' } },
    ]);
  });

  it('continues after the highest generated id and ignores foreign ids', () => {
    expect(nextCombId(panelWith())).toBe('c1');
    expect(nextCombId(panelWith(comb('c4', 'top6', 0, 0), comb('mine', 'top6', 1, 0)))).toBe('c5');
  });
});
