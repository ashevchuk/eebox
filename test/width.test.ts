import { describe, expect, it } from 'vitest';
import { addComb, setCombWidth, type CombLookup } from '../src/layout/combs';
import { setRailLength } from '../src/layout/panel';
import { insertPlacement, setPlacementWidth, type PlacementResult } from '../src/layout/placement';
import { buildNets } from '../src/electrical/nets';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { bomToCsv, buildBom } from '../src/project/bom';
import { buildProjectFile, parseProjectFile, parseProjectJson } from '../src/project/file';
import { emptySchematic, syncModuleNodes } from '../src/schematic/model';
import type { Project } from '../src/project';
import { combAt, defs, panelOf, place, resizeOf, resolve, widthOf } from './fixtures';

const lookup: CombLookup = { widthOf, sideOf: (m) => resolve(m)?.comb?.side };

const panelWith = (...placements: ReturnType<typeof place>[]) => panelOf(placements, [], [24, 24]);
const unwrap = (r: PlacementResult) => {
  if (!r.ok) throw new Error(r.error.kind);
  return r.panel;
};
const failure = (r: { ok: boolean; error?: { kind: string } }) => {
  if (r.ok || !r.error) throw new Error('expected a failure');
  return r.error.kind;
};

describe('setPlacementWidth', () => {
  it('gives a copy its own width and leaves other copies alone', () => {
    const panel = panelWith(place('p1', 'nbar', 0, 0), place('p2', 'nbar', 0, 10));
    const next = unwrap(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 8));
    expect(next.placements[0]?.widthUnits).toBe(8);
    expect('widthUnits' in next.placements[1]!).toBe(false);
  });

  it('drops the override when the width returns to the library width', () => {
    const wide = unwrap(setPlacementWidth(panelWith(place('p1', 'nbar', 0, 0)), widthOf, resizeOf, 'p1', 8));
    const back = unwrap(setPlacementWidth(wide, widthOf, resizeOf, 'p1', 3));
    expect('widthUnits' in back.placements[0]!).toBe(false);
  });

  it('accepts both ends of the allowed range and rejects just outside it', () => {
    const panel = panelWith(place('p1', 'nbar', 0, 0));
    expect(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 2).ok).toBe(true);
    expect(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 12).ok).toBe(true);
    expect(failure(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 1))).toBe('width-out-of-range');
    expect(failure(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 13))).toBe('width-out-of-range');
    expect(failure(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 4.5))).toBe('width-out-of-range');
    expect(failure(setPlacementWidth(panel, widthOf, resizeOf, 'p1', Number.NaN))).toBe('width-out-of-range');
  });

  it('refuses a module that the library does not allow to be resized', () => {
    expect(failure(setPlacementWidth(panelWith(place('p1', 'mcb1', 0, 0)), widthOf, resizeOf, 'p1', 2))).toBe('not-resizable');
    expect(failure(setPlacementWidth(panelWith(place('p1', 'fixedbar', 0, 0)), widthOf, resizeOf, 'p1', 5))).toBe('not-resizable');
  });

  it('refuses a width that runs into a neighbour or off the rail', () => {
    const panel = panelWith(place('p1', 'nbar', 0, 0), place('p2', 'mcb1', 0, 5));
    expect(failure(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 6))).toBe('overlap');
    expect(setPlacementWidth(panel, widthOf, resizeOf, 'p1', 5).ok).toBe(true);
    const atEnd = panelWith(place('p1', 'nbar', 0, 20));
    expect(failure(setPlacementWidth(atEnd, widthOf, resizeOf, 'p1', 6))).toBe('out-of-rail');
  });

  it('reports an unknown placement and does not mutate its input', () => {
    const panel = panelWith(place('p1', 'nbar', 0, 0));
    expect(failure(setPlacementWidth(panel, widthOf, resizeOf, 'zzz', 5))).toBe('unknown-placement');
    setPlacementWidth(panel, widthOf, resizeOf, 'p1', 8);
    expect('widthUnits' in panel.placements[0]!).toBe(false);
  });

  it('counts the own width of copies when a rail is shortened and when neighbours are pushed', () => {
    const wide = unwrap(setPlacementWidth(panelWith(place('p1', 'nbar', 0, 0)), widthOf, resizeOf, 'p1', 10));
    expect(setRailLength(wide, widthOf, 0, 9)).toEqual({ ok: false, error: 'modules-do-not-fit' });
    expect(setRailLength(wide, widthOf, 0, 10).ok).toBe(true);
    const pushed = unwrap(insertPlacement(wide, widthOf, place('p2', 'mcb1', 0, 0)));
    expect(pushed.placements.find((p) => p.id === 'p1')).toMatchObject({ slot: 1, widthUnits: 10 });
  });

  it('keeps the own width when a resized copy is moved with a push', () => {
    const wide = unwrap(setPlacementWidth(panelWith(place('p1', 'nbar', 0, 0), place('p2', 'mcb1', 0, 12)), widthOf, resizeOf, 'p1', 6));
    const moved = unwrap(insertPlacement(wide, widthOf, { ...wide.placements[0]!, slot: 11 }, 'p1'));
    expect(moved.placements.find((p) => p.id === 'p1')).toMatchObject({ slot: 11, widthUnits: 6 });
    expect(moved.placements.find((p) => p.id === 'p2')?.slot).toBe(17);
  });
});

describe('setCombWidth', () => {
  const panel = () => ({ ...panelOf([], [], [24]), combs: [combAt('c1', 'comb1', 0, 0)] });
  const unwrapComb = (r: ReturnType<typeof setCombWidth>) => {
    if (!r.ok) throw new Error(r.error.kind);
    return r.panel;
  };

  it('sets, clears and range-checks the width of a comb', () => {
    const wide = unwrapComb(setCombWidth(panel(), lookup, resizeOf, 'c1', 10));
    expect(wide.combs[0]?.widthUnits).toBe(10);
    expect('widthUnits' in unwrapComb(setCombWidth(wide, lookup, resizeOf, 'c1', 6)).combs[0]!).toBe(false);
    expect(setCombWidth(panel(), lookup, resizeOf, 'c1', 13)).toEqual({ ok: false, error: { kind: 'width-out-of-range' } });
    expect(setCombWidth(panel(), lookup, resizeOf, 'zzz', 8)).toEqual({ ok: false, error: { kind: 'unknown-comb' } });
  });

  it('refuses growing into another comb on the same side', () => {
    const crowded = { ...panel(), combs: [combAt('c1', 'comb1', 0, 0), combAt('c2', 'comb1', 0, 8)] };
    expect(setCombWidth(crowded, lookup, resizeOf, 'c1', 9)).toEqual({ ok: false, error: { kind: 'overlap', with: 'c2' } });
    expect(setCombWidth(crowded, lookup, resizeOf, 'c1', 8).ok).toBe(true);
  });

  it('uses the own width of a resized comb when placing another', () => {
    const wide = unwrapComb(setCombWidth(panel(), lookup, resizeOf, 'c1', 10));
    expect(addComb(wide, lookup, combAt('c2', 'comb1', 0, 9)).ok).toBe(false);
    expect(addComb(wide, lookup, combAt('c2', 'comb1', 0, 10)).ok).toBe(true);
  });

  it('refuses a comb that cannot be resized', () => {
    expect(setCombWidth({ ...panel(), combs: [combAt('c1', 'comb3', 0, 0)] }, lookup, () => undefined, 'c1', 8)).toEqual({
      ok: false,
      error: { kind: 'not-resizable' },
    });
  });
});

describe('electrical effect of a custom width', () => {
  it('gives a widened bar more terminals in its net, and a narrower one fewer', () => {
    const net = (width: number | undefined) => {
      const placement = { ...place('p0', 'nbar', 0, 0), ...(width ? { widthUnits: width } : {}) };
      const [only] = buildNets({ panel: panelOf([placement]), schematic: emptySchematic() }, resolve);
      return only?.terminals.length ?? 0;
    };
    expect(net(undefined)).toBe(6);
    expect(net(8)).toBe(16);
    expect(net(2)).toBe(4);
  });

  it('shows the scaled terminals of a bar on its schematic node', () => {
    const panel = panelOf([{ ...place('p0', 'nbar', 0, 0), widthUnits: 6 }]);
    const node = syncModuleNodes(emptySchematic(), panel, () => 'Bar').nodes[0]!;
    expect(nodeTerminalsLookup(panel, resolve)(node)).toHaveLength(12);
  });

  it('lets a longer comb reach more breakers', () => {
    const breakers = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => place(`p${i}`, 'mcb1', 0, i));
    const touched = (width: number | undefined) =>
      buildNets(
        { panel: panelOf(breakers, [{ ...combAt('c1', 'comb1', 0, 0), ...(width ? { widthUnits: width } : {}) }]), schematic: emptySchematic() },
        resolve,
      )[0]?.terminals.length ?? 0;
    expect(touched(undefined)).toBe(6);
    expect(touched(8)).toBe(8);
    expect(touched(3)).toBe(3);
  });
});

describe('bill of materials and project file', () => {
  const widened = (): Project => ({
    panel: panelOf(
      [place('p1', 'nbar', 0, 0), { ...place('p2', 'nbar', 0, 8), widthUnits: 6 }, { ...place('p3', 'nbar', 0, 16), widthUnits: 6 }],
      [],
      [24],
    ),
    schematic: emptySchematic(),
  });

  it('counts copies of different widths as different items', () => {
    const rows = buildBom(widened().panel, resolve);
    expect(rows.map((r) => [r.moduleId, r.widthUnits, r.quantity])).toEqual([
      ['nbar', 3, 1],
      ['nbar', 6, 2],
    ]);
    const csv = bomToCsv(rows).split('\r\n');
    expect(csv[1]).toContain(',3,1,');
    expect(csv[2]).toContain(',6,2,');
  });

  it('round-trips own widths through the project file without warnings', () => {
    const file = buildProjectFile(widened(), resolve);
    expect(parseProjectJson(JSON.stringify(file))).toEqual({ ok: true, file, warnings: [] });
  });

  it('warns about an own width on a module that cannot be resized, and one out of range', () => {
    const base = widened();
    const bad: Project = {
      ...base,
      panel: {
        ...base.panel,
        placements: [{ ...place('p1', 'mcb1', 0, 0), widthUnits: 2 }, { ...place('p2', 'nbar', 0, 8), widthUnits: 40 }],
      },
    };
    const result = parseProjectFile(JSON.parse(JSON.stringify(buildProjectFile(bad, resolve))));
    if (!result.ok) throw new Error('should load');
    expect(result.warnings).toEqual(
      expect.arrayContaining(['placement p1: its module cannot be resized', 'placement p2: width 40 is outside 2-12']),
    );
  });

  it('rejects an own width that is not a whole number of units', () => {
    const file = JSON.parse(JSON.stringify(buildProjectFile(widened(), resolve)));
    file.project.panel.placements[1].widthUnits = 4.5;
    file.project.panel.placements[2].widthUnits = 0;
    const result = parseProjectFile(file);
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual([
      'project.panel.placements[1].widthUnits',
      'project.panel.placements[2].widthUnits',
    ]);
  });

  it('keeps the resizable range in the module snapshot', () => {
    const file = buildProjectFile(widened(), resolve);
    expect(file.modules['lib/nbar']?.resizable).toEqual(defs.nbar!.resizable);
  });
});
