import { describe, expect, it } from 'vitest';
import { addPlate, addRail } from '../src/layout/plates';
import type { Project } from '../src/project';
import { emptySchematic } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { panelOf, place, resolve } from './fixtures';

/** Two rows on the back plate and one on the door, with a breaker on each of the door's and the back plate's last row. */
function build(): Project {
  const base = panelOf([place('p1', 'breaker16', 0, 0)], [], [24, 24]);
  const door = addPlate(base, 'Door', 300, 300);
  if (!door.ok || !door.id) throw new Error('plate not added');
  const rail = addRail(door.panel, door.id);
  if (!rail.ok) throw new Error('rail not added');
  return { panel: { ...rail.panel, placements: [...rail.panel.placements, place('p2', 'breaker16', 2, 0)] }, schematic: emptySchematic() };
}

const ctx = (selection: InspectContext['selection']): InspectContext => ({ project: build(), selection, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });
const valueOf = (c: InspectContext, key: string) => inspect(c)?.fields.find((f) => f.key === key);

describe('row numbers in the inspector', () => {
  it('count a row from 1 on its own plate', () => {
    const row = inspect(ctx({ rail: 2 }));
    expect(row?.title).toBe('Row 1');
    expect(valueOf(ctx({ rail: 2 }), 'position')).toMatchObject({ value: 1, max: 1 });
  });

  it('show a module on the door in row 1 of the door', () => {
    expect(valueOf(ctx({ placementId: 'p2' }), 'row')).toMatchObject({ value: 1, max: 1 });
  });

  it('refuse a row the plate of the module has not', () => {
    const result = applyEdit(ctx({ placementId: 'p2' }), 'row', '2');
    expect(result).toEqual({ ok: false, message: 'There is no such row.' });
  });

  it('move a module to another row of its own plate by that row number', () => {
    const result = applyEdit(ctx({ placementId: 'p1' }), 'row', '2');
    if (!result.ok) throw new Error(result.message);
    expect(result.project.panel.placements.find((p) => p.id === 'p1')).toMatchObject({ rail: 1 });
  });
});
