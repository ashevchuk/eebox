import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAIL_LENGTH_UNITS,
  DEFAULT_RAIL_PITCH_MM,
  FIRST_RAIL_Y_MM,
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_POSITION_MM,
} from '../src/layout/limits';
import {
  createPanel,
  moveRail,
  setRailCount,
  setRailLength,
  setRailPosition,
  type PanelEditError,
  type PanelEditResult,
} from '../src/layout/panel';
import { DEFAULT_PLATE_ID } from '../src/layout/plates';
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

const lengths = (panel: Panel) => panel.rails.map((r) => r.lengthUnits);
const heights = (panel: Panel) => panel.rails.map((r) => r.y);

describe('createPanel', () => {
  it('stacks the rails one pitch apart, the first at the first rail height', () => {
    expect(heights(createPanel([18, 18, 12]))).toEqual([FIRST_RAIL_Y_MM, FIRST_RAIL_Y_MM + DEFAULT_RAIL_PITCH_MM, FIRST_RAIL_Y_MM + 2 * DEFAULT_RAIL_PITCH_MM]);
    expect(createPanel([12]).rails).toEqual([{ plate: DEFAULT_PLATE_ID, x: 0, y: FIRST_RAIL_Y_MM, lengthUnits: 12 }]);
    expect(createPanel([]).rails).toEqual([]);
  });
});

describe('setRailCount', () => {
  it('adds rows that copy the last row length and spacing', () => {
    let panel = createPanel([18, 24]);
    panel = unwrap(setRailPosition(panel, 1, 0, FIRST_RAIL_Y_MM + 200));
    const grown = unwrap(setRailCount(panel, 4));
    expect(lengths(grown)).toEqual([18, 24, 24, 24]);
    expect(heights(grown)).toEqual([0, 200, 400, 600].map((d) => FIRST_RAIL_Y_MM + d));
  });

  it('builds the first rows from defaults when the panel has none', () => {
    const panel = unwrap(setRailCount(createPanel([]), 3));
    expect(lengths(panel)).toEqual(Array(3).fill(DEFAULT_RAIL_LENGTH_UNITS));
    expect(heights(panel)).toEqual([0, 1, 2].map((i) => FIRST_RAIL_Y_MM + i * DEFAULT_RAIL_PITCH_MM));
  });

  it('removes empty rows from the bottom', () => {
    const panel = unwrap(setRailCount(createPanel([18, 12, 6]), 2));
    expect(lengths(panel)).toEqual([18, 12]);
    expect(panel.rails).toHaveLength(2);
  });

  it('refuses to remove a row that still holds a module', () => {
    const panel = { ...createPanel([12, 12]), placements: [place('p1', 1, 0)] };
    expect(errorOf(setRailCount(panel, 1))).toBe('rail-not-empty');
  });

  it('refuses to remove a row that still holds a comb', () => {
    const panel = { ...createPanel([12, 12]), combs: [{ id: 'c1', module: { libraryId: 'lib', moduleId: 'comb' }, rail: 1, slot: 0 }] };
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
    expect(unwrap(setRailCount(createPanel([12]), MAX_RAILS)).rails).toHaveLength(MAX_RAILS);
  });
});

describe('setRailLength', () => {
  it('changes only the chosen rail', () => {
    expect(lengths(unwrap(setRailLength(createPanel([12, 12]), widthOf, 1, 30)))).toEqual([12, 30]);
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

  it.each([0, -3, MAX_RAIL_LENGTH_UNITS + 1, 0.5, Number.NaN])('rejects the length %s', (units) => {
    expect(errorOf(setRailLength(createPanel([12]), widthOf, 0, units))).toBe('invalid-value');
  });

  it('accepts a length that is not a whole number of units, a rail cut to a measure', () => {
    expect(setRailLength(createPanel([12]), widthOf, 0, 14.2857).ok).toBe(true);
  });

  it('rejects an unknown rail', () => {
    expect(errorOf(setRailLength(createPanel([12]), widthOf, 1, 10))).toBe('unknown-rail');
  });

  it('refuses shrinking below the end of a comb', () => {
    const panel = { ...createPanel([12]), combs: [{ id: 'c1', module: { libraryId: 'lib', moduleId: 'comb' }, rail: 0, slot: 4 }] };
    expect(errorOf(setRailLength(panel, widthOf, 0, 5))).toBe('modules-do-not-fit');
    expect(setRailLength(panel, widthOf, 0, 6).ok).toBe(true);
  });
});

describe('setRailPosition', () => {
  it('moves only the chosen rail, in both directions', () => {
    const before = createPanel([12, 12, 12]);
    const panel = unwrap(setRailPosition(before, 1, 30, 220));
    expect(panel.rails[1]).toEqual({ plate: DEFAULT_PLATE_ID, x: 30, y: 220, lengthUnits: 12 });
    expect(panel.rails[0]).toEqual(before.rails[0]);
    expect(panel.rails[2]).toEqual(before.rails[2]);
  });

  it('lets two rails stand side by side', () => {
    const panel = unwrap(setRailPosition(createPanel([6, 6]), 1, 6 * 17.5 + 20, FIRST_RAIL_Y_MM));
    expect(panel.rails[1]?.y).toBe(panel.rails[0]?.y);
  });

  it('accepts both limits and rejects values just outside them', () => {
    const panel = createPanel([12, 12]);
    expect(setRailPosition(panel, 0, 0, 0).ok).toBe(true);
    expect(setRailPosition(panel, 0, MAX_RAIL_POSITION_MM, MAX_RAIL_POSITION_MM).ok).toBe(true);
    expect(errorOf(setRailPosition(panel, 0, -1, 100))).toBe('invalid-value');
    expect(errorOf(setRailPosition(panel, 0, 100, MAX_RAIL_POSITION_MM + 1))).toBe('invalid-value');
    expect(errorOf(setRailPosition(panel, 0, Number.NaN, 100))).toBe('invalid-value');
  });

  it('refuses an unknown rail', () => {
    expect(errorOf(setRailPosition(createPanel([12]), 1, 0, 0))).toBe('unknown-rail');
  });

  it('does not mutate the input panel', () => {
    const panel = createPanel([12, 12]);
    setRailPosition(panel, 0, 300, 300);
    expect(panel.rails[0]).toEqual({ plate: DEFAULT_PLATE_ID, x: 0, y: FIRST_RAIL_Y_MM, lengthUnits: 12 });
  });
});

describe('moveRail', () => {
  const stocked = (): Panel => ({
    ...createPanel([10, 20, 30]),
    rails: createPanel([10, 20, 30]).rails.map((r, i) => ({ ...r, y: FIRST_RAIL_Y_MM + [0, 110, 330][i]! })),
    placements: [place('a', 0, 0), place('b', 1, 0), place('c', 2, 0), place('d', 1, 4)],
  });
  const railOf = (panel: Panel) => Object.fromEntries(panel.placements.map((p) => [p.id, p.rail]));

  it('swaps adjacent rows and their modules together', () => {
    const moved = unwrap(moveRail(stocked(), 0, 1));
    expect(lengths(moved)).toEqual([20, 10, 30]);
    expect(railOf(moved)).toEqual({ a: 1, b: 0, c: 2, d: 0 });
  });

  it('moves a row several places down and shifts the rows in between up', () => {
    const moved = unwrap(moveRail(stocked(), 0, 2));
    expect(lengths(moved)).toEqual([20, 30, 10]);
    expect(railOf(moved)).toEqual({ a: 2, b: 0, c: 1, d: 0 });
  });

  it('moves a row up and shifts the rows in between down', () => {
    const moved = unwrap(moveRail(stocked(), 2, 0));
    expect(lengths(moved)).toEqual([30, 10, 20]);
    expect(railOf(moved)).toEqual({ a: 1, b: 2, c: 0, d: 2 });
  });

  it('moves the combs of a row together with it', () => {
    const panel = { ...stocked(), combs: [{ id: 'c1', module: { libraryId: 'lib', moduleId: 'comb' }, rail: 0, slot: 0 }] };
    expect(unwrap(moveRail(panel, 0, 2)).combs[0]?.rail).toBe(2);
  });

  it('keeps slots, ids and the places that belong to the positions', () => {
    const moved = unwrap(moveRail(stocked(), 0, 2));
    expect(moved.rails.map((r) => [r.x, r.y])).toEqual(stocked().rails.map((r) => [r.x, r.y]));
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
