import { describe, expect, it } from 'vitest';
import type { FreePlacement, Panel } from '../src/layout/placement';
import type { Project } from '../src/project';
import { emptySchematic } from '../src/schematic/model';
import { applyAction, inspect, type InspectContext } from '../src/ui/inspector';
import { panelOf, place, resolve } from './fixtures';

const free = (id: string, plate: string, x: number, y: number): FreePlacement => ({ id, module: { libraryId: 'lib', moduleId: 'breaker16' }, plate, x, y });

function build(): Project {
  const base = panelOf([place('r1', 'breaker16', 0, 0)], [], [20]);
  const plate = base.plates[0]!.id;
  const panel: Panel = { ...base, placements: [...base.placements, free('a', plate, 10, 20), free('b', plate, 120, 90), free('c', plate, 60, 40)] };
  return { panel, schematic: emptySchematic() };
}

const ctx = (placementIds: string[]): InspectContext => ({ project: build(), selection: { placementIds }, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });
const keys = (c: InspectContext) => inspect(c).actions.map((a) => a.key);

describe('aligning chosen devices from the inspector', () => {
  it('offers alignment for two devices on the plate and spreading only for three', () => {
    expect(keys(ctx(['a', 'b']))).toEqual(['align:left', 'align:centre-x', 'align:right', 'align:top', 'align:centre-y', 'align:bottom']);
    expect(keys(ctx(['a', 'b', 'c']))).toContain('align:spread-x');
  });

  it('offers nothing when the chosen devices are on rails', () => {
    expect(keys(ctx(['r1', 'a']))).toEqual([]);
  });

  it('moves the devices by the chosen action', () => {
    const result = applyAction(ctx(['a', 'b', 'c']), 'align:left');
    if (!result.ok) throw new Error(result.message);
    const xs = result.project.panel.placements.filter((p) => ['a', 'b', 'c'].includes(p.id)).map((p) => (p as FreePlacement).x);
    expect(xs).toEqual([10, 10, 10]);
  });

  it('refuses an action it does not know', () => {
    expect(applyAction(ctx(['a', 'b']), 'align:diagonal').ok).toBe(false);
  });
});
