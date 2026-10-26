import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAIL_LENGTH_UNITS,
  DEFAULT_RAIL_PITCH_MM,
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_PITCH_MM,
  MIN_RAIL_PITCH_MM,
} from '../src/layout/limits';
import {
  createPanel,
  moveRail,
  setRailCount,
  setRailLength,
  setRailPitch,
  type PanelEditError,
  type PanelEditResult,
} from '../src/layout/panel';
import type { Panel, Placement, WidthOf } from '../src/layout/placement';

const widthOf: WidthOf = () => 2;
const place = (id: string, rail: number, slot: number): Placement => ({
  id,
  module: { libraryId: 'lib', moduleId: 'm' },
  rail,
  slot,
});

function unwrap(result: PanelEditResult): Panel {
  if (!result.ok) throw new Error(`unexpected failure: ${result.error}`);
  return result.panel;
}

function errorOf(result: PanelEditResult): PanelEditError {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

describe('createPanel', () => {
  it('makes one pitch per gap between rails', () => {
    expect(createPanel([18, 18, 12]).railPitchesMm).toEqual([DEFAULT_RAIL_PITCH_MM, DEFAULT_RAIL_PITCH_MM]);
    expect(createPanel([12]).railPitchesMm).toEqual([]);
    expect(createPanel([]).railPitchesMm).toEqual([]);
  });
});

describe('setRailCount', () => {
  it('adds rows that copy the last row length and spacing', () => {
    let panel = createPanel([18, 24]);
    panel = unwrap(setRailPitch(panel, 0, 200));
    const grown = unwrap(setRailCount(panel, 4));
    expect(grown.railLengthsUnits).toEqual([18, 24, 24, 24]);
    expect(grown.railPitchesMm).toEqual([200, 200, 200]);
  });

  it('builds the first rows from defaults when the panel has none', () => {
    const panel = unwrap(setRailCount(createPanel([]), 3));
    expect(panel.railLengthsUnits).toEqual(Array(3).fill(DEFAULT_RAIL_LENGTH_UNITS));
    expect(panel.railPitchesMm).toEqual([DEFAULT_RAIL_PITCH_MM, DEFAULT_RAIL_PITCH_MM]);
  });

  it('removes empty rows from the bottom', () => {
    const panel = unwrap(setRailCount(createPanel([18, 12, 6]), 2));
    expect(panel.railLengthsUnits).toEqual([18, 12]);
    expect(panel.railPitchesMm).toHaveLength(1);
  });

  it('refuses to remove a row that still holds a module', () => {
    const panel = { ...createPanel([12, 12]), placements: [place('p1', 1, 0)] };
    expect(errorOf(setRailCount(panel, 1))).toBe('rail-not-empty');
  });

  it('keeps placements when only growing', () => {
    const panel = { ...createPanel([12]), placements: [place('p1', 0, 0)] };
    expect(unwrap(setRailCount(panel, 2)).placements).toHaveLength(1);
  });

  it.each([0, -1, MAX_RAILS + 1, 1.5, Number.NaN])('rejects the row count %s', (count) => {
    expect(errorOf(setRailCount(createPanel([12]), count))).toBe('invalid-value');
  });

  it('accepts the largest allowed count', () => {
    expect(unwrap(setRailCount(createPanel([12]), MAX_RAILS)).railLengthsUnits).toHaveLength(MAX_RAILS);
  });
});

describe('setRailLength', () => {
  it('changes only the chosen rail', () => {
    expect(unwrap(setRailLength(createPanel([12, 12]), widthOf, 1, 30)).railLengthsUnits).toEqual([12, 30]);
  });

  it('allows shrinking to exactly the last module end', () => {
    const panel = { ...createPanel([12]), placements: [place('p1', 0, 4)] };
    expect(setRailLength(panel, widthOf, 0, 6).ok).toBe(true);
  });

  it('refuses shrinking below a placed module and names no partial change', () => {
    const panel = { ...createPanel([12]), placements: [place('p1', 0, 4)] };
    expect(errorOf(setRailLength(panel, widthOf, 0, 5))).toBe('modules-do-not-fit');
  });

  it('ignores modules that sit on other rails', () => {
    const panel = { ...createPanel([12, 12]), placements: [place('p1', 0, 10)] };
    expect(setRailLength(panel, widthOf, 1, 1).ok).toBe(true);
  });

  it.each([0, -3, MAX_RAIL_LENGTH_UNITS + 1, 2.5, Number.NaN])('rejects the length %s', (units) => {
    expect(errorOf(setRailLength(createPanel([12]), widthOf, 0, units))).toBe('invalid-value');
  });

  it('rejects an unknown rail', () => {
    expect(errorOf(setRailLength(createPanel([12]), widthOf, 1, 10))).toBe('unknown-rail');
  });
});

describe('setRailPitch', () => {
  it('changes only the chosen gap', () => {
    const panel = unwrap(setRailPitch(createPanel([12, 12, 12]), 1, 220));
    expect(panel.railPitchesMm).toEqual([DEFAULT_RAIL_PITCH_MM, 220]);
  });

  it('accepts both limits and rejects values just outside them', () => {
    const panel = createPanel([12, 12]);
    expect(setRailPitch(panel, 0, MIN_RAIL_PITCH_MM).ok).toBe(true);
    expect(setRailPitch(panel, 0, MAX_RAIL_PITCH_MM).ok).toBe(true);
    expect(errorOf(setRailPitch(panel, 0, MIN_RAIL_PITCH_MM - 1))).toBe('invalid-value');
    expect(errorOf(setRailPitch(panel, 0, MAX_RAIL_PITCH_MM + 1))).toBe('invalid-value');
    expect(errorOf(setRailPitch(panel, 0, 120.5))).toBe('invalid-value');
  });

  it('has no gap to edit on a single-row panel', () => {
    expect(errorOf(setRailPitch(createPanel([12]), 0, 150))).toBe('unknown-rail');
  });

  it('does not mutate the input panel', () => {
    const panel = createPanel([12, 12]);
    setRailPitch(panel, 0, 300);
    expect(panel.railPitchesMm).toEqual([DEFAULT_RAIL_PITCH_MM]);
  });
});

describe('moveRail', () => {
  const stocked = (): Panel => ({
    ...createPanel([10, 20, 30]),
    railPitchesMm: [110, 220],
    placements: [place('a', 0, 0), place('b', 1, 0), place('c', 2, 0), place('d', 1, 4)],
  });
  const railOf = (panel: Panel) => Object.fromEntries(panel.placements.map((p) => [p.id, p.rail]));

  it('swaps adjacent rows and their modules together', () => {
    const moved = unwrap(moveRail(stocked(), 0, 1));
    expect(moved.railLengthsUnits).toEqual([20, 10, 30]);
    expect(railOf(moved)).toEqual({ a: 1, b: 0, c: 2, d: 0 });
  });

  it('moves a row several places down and shifts the rows in between up', () => {
    const moved = unwrap(moveRail(stocked(), 0, 2));
    expect(moved.railLengthsUnits).toEqual([20, 30, 10]);
    expect(railOf(moved)).toEqual({ a: 2, b: 0, c: 1, d: 0 });
  });

  it('moves a row up and shifts the rows in between down', () => {
    const moved = unwrap(moveRail(stocked(), 2, 0));
    expect(moved.railLengthsUnits).toEqual([30, 10, 20]);
    expect(railOf(moved)).toEqual({ a: 1, b: 2, c: 0, d: 2 });
  });

  it('keeps slots, ids and the spacing that belongs to the positions', () => {
    const moved = unwrap(moveRail(stocked(), 0, 2));
    expect(moved.railPitchesMm).toEqual([110, 220]);
    expect(moved.placements.find((p) => p.id === 'd')?.slot).toBe(4);
    expect(moved.placements.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('leaves the panel as is when the row does not move', () => {
    expect(unwrap(moveRail(stocked(), 1, 1))).toEqual(stocked());
  });

  it('rejects rows that do not exist and does not mutate its input', () => {
    const panel = stocked();
    expect(errorOf(moveRail(panel, 0, 3))).toBe('unknown-rail');
    expect(errorOf(moveRail(panel, -1, 0))).toBe('unknown-rail');
    moveRail(panel, 0, 2);
    expect(panel).toEqual(stocked());
  });
});
