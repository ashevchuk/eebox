import { describe, expect, it } from 'vitest';
import { notesOnPlate, withPlateNotes, DEFAULT_PLATE_ID, addPlate, addRail, moveRailToPlate, moveToPlate, plateById, plateIsEmpty, plateOfPlacement, plateOfSelection, railOffset, railsAreGrouped, removePlate, removeRail, renamePlate, resizePlate, scopeToPlate, setRailCountOnPlate, type PlateResult } from '../src/layout/plates';
import { MAX_PLATES, MAX_PLATE_SIZE_MM, MIN_PLATE_SIZE_MM } from '../src/layout/limits';
import { createPanel } from '../src/layout/panel';
import { ductsOf } from '../src/layout/ducts';
import { findPlacementFindings } from '../src/layout/placementFindings';
import type { FreePlacement, Panel } from '../src/layout/placement';
import { lookupsOf } from '../src/layout/lookups';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { diffProjects } from '../src/project/diff';
import { emptySchematic } from '../src/schematic/model';
import { applyAction, applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { Session } from '../src/ui/session';
import { frameRect, labelRoom, placementRect, railRect } from '../src/view/geometry';
import { fitPlate, fittedPlateSize } from '../src/view/plateFit';
import { combAt, place, ref, resolve, sizes } from './fixtures';

const ok = (result: PlateResult): Panel => {
  if (!result.ok) throw new Error(result.error);
  return result.panel;
};
const free = (id: string, plate: string, x: number, y: number): FreePlacement => ({ id, module: ref('mcb1'), plate, x, y });
const duct = (id: string, plate: string, x: number, y: number) => ({ id, plate, x, y, widthMm: 100, heightMm: 40 });

/** A back plate with two rows and a door with one row, a device on the plate of each and a duct on the door. */
function twoPlates(): Panel {
  let panel = createPanel([12, 12]);
  panel = ok(addPlate(panel, 'Left door', 500, 700) as PlateResult);
  panel = ok(addRail(panel, 'plate2'));
  return {
    ...panel,
    placements: [place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 1, 2), place('p3', 'mcb1', 2, 4), free('p4', DEFAULT_PLATE_ID, 100, 300), free('p5', 'plate2', 50, 400)],
    combs: [combAt('c1', 'comb1', 2, 4)],
    ducts: [duct('d1', 'plate2', 10, 500)],
  };
}

describe('a panel of several plates', () => {
  it('starts with one plate that is as large as its rails need, and rails that stand on it', () => {
    const panel = createPanel([12, 12]);
    expect(panel.plates).toEqual([{ id: DEFAULT_PLATE_ID, name: 'Back plate', widthMm: 210, heightMm: 370 }]);
    expect(panel.rails.every((r) => r.plate === DEFAULT_PLATE_ID)).toBe(true);
  });

  it('keeps the rails in one block for each plate, in the order of the plates', () => {
    const panel = twoPlates();
    expect(panel.rails.map((r) => r.plate)).toEqual([DEFAULT_PLATE_ID, DEFAULT_PLATE_ID, 'plate2']);
    expect(railsAreGrouped(panel)).toBe(true);
    expect(railsAreGrouped({ ...panel, rails: [panel.rails[2]!, panel.rails[0]!, panel.rails[1]!] })).toBe(false);
    expect([railOffset(panel, DEFAULT_PLATE_ID), railOffset(panel, 'plate2')]).toEqual([0, 2]);
  });

  it('says which plate a device, a comb, a duct or a row is on', () => {
    const panel = twoPlates();
    const plateOf = (id: string) => plateOfPlacement(panel, panel.placements.find((p) => p.id === id)!);
    expect([plateOf('p1'), plateOf('p3'), plateOf('p4'), plateOf('p5')]).toEqual([DEFAULT_PLATE_ID, 'plate2', DEFAULT_PLATE_ID, 'plate2']);
    expect(plateOfSelection(panel, { combId: 'c1' })).toBe('plate2');
    expect(plateOfSelection(panel, { ductId: 'd1' })).toBe('plate2');
    expect(plateOfSelection(panel, { rail: 2 })).toBe('plate2');
    expect(plateOfSelection(panel, { placementIds: ['p2', 'p3'] })).toBe(DEFAULT_PLATE_ID);
    expect(plateOfSelection(panel, {})).toBeUndefined();
  });
});

describe('looking at one plate as a panel of its own', () => {
  it('holds its rows numbered from 0, what is on them and on the plate, and nothing of the others', () => {
    const { panel: door, offset } = scopeToPlate(twoPlates(), 'plate2');
    expect(offset).toBe(2);
    expect(door.rails).toHaveLength(1);
    expect(door.placements.map((p) => [p.id, p.rail])).toEqual([['p3', 0], ['p5', undefined]]);
    expect(door.combs.map((c) => [c.id, c.rail])).toEqual([['c1', 0]]);
    expect(ductsOf(door).map((d) => d.id)).toEqual(['d1']);
    expect(door.plates.map((p) => p.id)).toEqual(['plate2']);
  });

  it('is the back plate for the first one, with its devices on the plate and no ducts', () => {
    const { panel: back, offset } = scopeToPlate(twoPlates(), DEFAULT_PLATE_ID);
    expect(offset).toBe(0);
    expect(back.placements.map((p) => p.id)).toEqual(['p1', 'p2', 'p4']);
    expect('ducts' in back).toBe(false);
  });

  it('falls back on the first plate for one that is not there', () => {
    expect(scopeToPlate(twoPlates(), 'nothing').panel.plates[0]!.id).toBe(DEFAULT_PLATE_ID);
  });

  it('makes the frame the plate, and ends a label at the end of the plate', () => {
    const { panel: door } = scopeToPlate(twoPlates(), 'plate2');
    expect(frameRect(door)).toMatchObject({ width: 500 + 80, height: 700 + 80 });
    const rail = railRect(door, 0);
    expect(labelRoom(door, 0, 90)).toBe(700 + 80 - (rail.y + rail.height / 2 + 45) - 8);
  });
});

describe('adding, naming, sizing and removing plates', () => {
  it('adds a plate with a name and a size, refusing a name that is taken or a size that is out', () => {
    const panel = createPanel([12]);
    const added = addPlate(panel, 'Right door', 600, 800);
    expect(added.ok && added.id).toBe('plate2');
    expect(addPlate(panel, 'Back plate', 600, 800)).toEqual({ ok: false, error: 'duplicate-name' });
    expect(addPlate(panel, ' ', 600, 800)).toEqual({ ok: false, error: 'invalid-value' });
    expect(addPlate(panel, 'X', MIN_PLATE_SIZE_MM - 1, 800)).toEqual({ ok: false, error: 'invalid-value' });
    expect(addPlate(panel, 'X', 600, MAX_PLATE_SIZE_MM + 1)).toEqual({ ok: false, error: 'invalid-value' });
  });

  it('holds at most so many', () => {
    let panel = createPanel([12]);
    for (let i = 1; i < MAX_PLATES; i++) panel = ok(addPlate(panel, `Door ${i}`, 600, 800) as PlateResult);
    expect(addPlate(panel, 'One too many', 600, 800)).toEqual({ ok: false, error: 'too-many' });
  });

  it('renames and resizes, keeping the rest', () => {
    const renamed = ok(renamePlate(twoPlates(), 'plate2', 'Door'));
    expect(plateById(renamed, 'plate2')?.name).toBe('Door');
    expect(renamePlate(twoPlates(), 'plate2', 'Back plate')).toEqual({ ok: false, error: 'duplicate-name' });
    expect(renamePlate(twoPlates(), 'plate2', 'Left door')).toMatchObject({ ok: true });
    const resized = ok(resizePlate(twoPlates(), 'plate2', 650, 900));
    expect(plateById(resized, 'plate2')).toMatchObject({ name: 'Left door', widthMm: 650, heightMm: 900 });
    expect(resizePlate(twoPlates(), 'plate2', 10, 900)).toEqual({ ok: false, error: 'invalid-value' });
    expect(resizePlate(twoPlates(), 'plate9', 650, 900)).toEqual({ ok: false, error: 'unknown-plate' });
  });

  it('removes a plate that is empty, and not one with a row, a device or a duct, nor the last one', () => {
    const panel = twoPlates();
    expect(plateIsEmpty(panel, 'plate2')).toBe(false);
    expect(removePlate(panel, 'plate2')).toEqual({ ok: false, error: 'not-empty' });
    const empty = ok(addPlate(createPanel([12]), 'Empty', 600, 800) as PlateResult);
    expect(removePlate(empty, 'plate2')).toMatchObject({ ok: true });
    expect(removePlate(createPanel([12]), DEFAULT_PLATE_ID)).toEqual({ ok: false, error: 'last-plate' });
    const onlyFree = { ...empty, placements: [free('p1', 'plate2', 0, 0)] };
    expect(removePlate(onlyFree, 'plate2')).toEqual({ ok: false, error: 'not-empty' });
    expect(removePlate({ ...empty, ducts: [duct('d1', 'plate2', 0, 0)] }, 'plate2')).toEqual({ ok: false, error: 'not-empty' });
  });
});

describe('rows on plates', () => {
  it('adds a row at the bottom of its plate, keeping the rows in blocks and the modules on their rows', () => {
    const panel = twoPlates();
    const added = ok(addRail(panel, DEFAULT_PLATE_ID));
    expect(added.rails.map((r) => r.plate)).toEqual([DEFAULT_PLATE_ID, DEFAULT_PLATE_ID, DEFAULT_PLATE_ID, 'plate2']);
    expect(added.rails[2]!.y).toBe(panel.rails[1]!.y + (panel.rails[1]!.y - panel.rails[0]!.y));
    expect(added.placements.find((p) => p.id === 'p3')).toMatchObject({ rail: 3 });
    expect(added.combs[0]).toMatchObject({ rail: 3 });
    expect(added.placements.find((p) => p.id === 'p2')).toMatchObject({ rail: 1 });
  });

  it('removes a row that is empty and renumbers the rest, and refuses one with a module or a comb', () => {
    const panel = ok(addRail(twoPlates(), DEFAULT_PLATE_ID));
    expect(removeRail(panel, 3)).toEqual({ ok: false, error: 'not-empty' });
    const without = ok(removeRail(panel, 2));
    expect(without.rails).toHaveLength(3);
    expect(without.placements.find((p) => p.id === 'p3')).toMatchObject({ rail: 2 });
    expect(removeRail(panel, 9)).toEqual({ ok: false, error: 'unknown-rail' });
  });

  it('moves a row with its modules and combs to another plate, where it becomes the last row', () => {
    const moved = ok(moveRailToPlate(twoPlates(), 0, 'plate2'));
    expect(moved.rails.map((r) => r.plate)).toEqual([DEFAULT_PLATE_ID, 'plate2', 'plate2']);
    expect(railsAreGrouped(moved)).toBe(true);
    expect(moved.placements.find((p) => p.id === 'p1')).toMatchObject({ rail: 2 });
    expect(moved.placements.find((p) => p.id === 'p2')).toMatchObject({ rail: 0 });
    expect(moved.placements.find((p) => p.id === 'p3')).toMatchObject({ rail: 1 });
    expect(moved.combs[0]).toMatchObject({ rail: 1 });
  });

  it('gives a plate as many rows as asked for, and stops at one that holds a module', () => {
    const grown = ok(setRailCountOnPlate(twoPlates(), 'plate2', 3));
    expect(grown.rails.filter((r) => r.plate === 'plate2')).toHaveLength(3);
    expect(setRailCountOnPlate(twoPlates(), 'plate2', 0)).toEqual({ ok: false, error: 'not-empty' });
    expect(setRailCountOnPlate(twoPlates(), DEFAULT_PLATE_ID, -1)).toEqual({ ok: false, error: 'invalid-value' });
    const shrunk = ok(setRailCountOnPlate(grown, 'plate2', 1));
    expect(shrunk.rails).toHaveLength(3);
  });

  it('moves a device on the plate or a duct to another plate, keeping its place', () => {
    const moved = ok(moveToPlate(twoPlates(), 'p4', 'plate2'));
    expect(moved.placements.find((p) => p.id === 'p4')).toMatchObject({ plate: 'plate2', x: 100, y: 300 });
    expect(ductsOf(ok(moveToPlate(twoPlates(), 'd1', DEFAULT_PLATE_ID)))[0]).toMatchObject({ plate: DEFAULT_PLATE_ID, x: 10, y: 500 });
    expect(moveToPlate(twoPlates(), 'p4', 'plate9')).toEqual({ ok: false, error: 'unknown-plate' });
  });
});

describe('notes and fitting', () => {
  it('keeps the notes of each plate to itself', () => {
    const panel = withPlateNotes(twoPlates(), 'plate2', [{ id: 'a1', x: 1, y: 2, text: 'Door note' }]);
    expect(notesOnPlate(panel, 'plate2')?.[0]?.text).toBe('Door note');
    expect(notesOnPlate(panel, DEFAULT_PLATE_ID)).toBeUndefined();
    expect(scopeToPlate(panel, 'plate2').panel.plates[0]!.annotations).toHaveLength(1);
    expect('annotations' in plateById(withPlateNotes(panel, 'plate2', []), 'plate2')!).toBe(false);
  });

  it('fits a plate to its rows, a device on it and a duct, and only to its own', () => {
    const panel = twoPlates();
    const back = fittedPlateSize(panel, DEFAULT_PLATE_ID, sizes);
    expect(back.widthMm).toBeGreaterThanOrEqual(210);
    expect(fittedPlateSize(panel, 'plate2', sizes).heightMm).toBeGreaterThanOrEqual(500 + 40);
    const fitted = ok(fitPlate(panel, 'plate2', sizes));
    expect(plateById(fitted, DEFAULT_PLATE_ID)).toEqual(plateById(panel, DEFAULT_PLATE_ID));
    expect(plateById(fitted, 'plate2')!.heightMm).toBe(fittedPlateSize(panel, 'plate2', sizes).heightMm);
  });
});

describe('what stands on a plate and what reaches off it', () => {
  const project = (panel: Panel) => ({ panel, schematic: emptySchematic() });
  const found = (panel: Panel) => findPlacementFindings(project(panel), lookupsOf(resolve).sizes, resolve).map((f) => `${f.severity}: ${f.message}`);

  it('is not mixed up between plates: two devices at one place on two plates do not stand on each other', () => {
    const panel: Panel = { ...twoPlates(), placements: [free('p1', DEFAULT_PLATE_ID, 100, 300), free('p2', 'plate2', 100, 300)], combs: [], ducts: undefined } as Panel;
    expect(found(panel).filter((m) => m.includes('stands on '))).toEqual([]);
  });

  it('is an error for a device, a duct and a row that reach outside their plate, naming the plate', () => {
    const panel: Panel = { ...twoPlates(), placements: [free('p1', 'plate2', 490, 300)], combs: [], ducts: [duct('d1', 'plate2', 450, 10)] };
    const messages = found(panel);
    expect(messages).toContain('error: MCB 1P (p1) reaches outside the plate Left door.');
    expect(messages).toContain('error: duct d1 (d1) reaches outside the plate Left door.');
    const narrow = ok(resizePlate(createPanel([12]), DEFAULT_PLATE_ID, MIN_PLATE_SIZE_MM, 400));
    expect(found(narrow)).toContain('error: The rail of row 1 reaches outside the plate Back plate.');
  });

  it('is within the plate when it stands inside, edge to edge included', () => {
    const body = placementRect(scopeToPlate(twoPlates(), DEFAULT_PLATE_ID).panel, sizes, free('p4', DEFAULT_PLATE_ID, 0, 0));
    expect(body.width).toBeGreaterThan(0);
    expect(found({ ...createPanel([12]), placements: [free('p1', DEFAULT_PLATE_ID, 0, 0)] }).filter((m) => m.includes('outside'))).toEqual([]);
  });
});

describe('plates in the project file', () => {
  const file = () => buildProjectFile({ panel: twoPlates(), schematic: emptySchematic() }, resolve);
  const errorsOf = (raw: unknown): string[] => {
    const result = parseProjectJson(JSON.stringify(raw));
    return result.ok ? [] : result.errors.map((e) => e.path);
  };

  it('are kept through saving and loading, with what is on them', () => {
    const parsed = parseProjectJson(JSON.stringify(file()));
    expect(parsed.ok && parsed.file.project.panel).toEqual(twoPlates());
  });

  it('refuse a thing on a plate that is not there, rows out of order, and a name twice', () => {
    const unknown = JSON.parse(JSON.stringify(file()));
    unknown.project.panel.rails[2].plate = 'nowhere';
    expect(errorsOf(unknown)).toEqual(['project.panel.rails[2].plate']);
    const duct = JSON.parse(JSON.stringify(file()));
    duct.project.panel.ducts[0].plate = 'nowhere';
    expect(errorsOf(duct)).toEqual(['project.panel.ducts[0].plate']);
    const device = JSON.parse(JSON.stringify(file()));
    device.project.panel.placements[3].plate = 'nowhere';
    expect(errorsOf(device)).toEqual(['project.panel.placements[3].plate']);
    const order = JSON.parse(JSON.stringify(file()));
    order.project.panel.rails.reverse();
    expect(errorsOf(order)).toEqual(['project.panel.rails']);
    const names = JSON.parse(JSON.stringify(file()));
    names.project.panel.plates[1].name = 'Back plate';
    expect(errorsOf(names)).toEqual(['project.panel.plates[1].name']);
  });

  it('refuse a size that is out of range, a panel without plates and one with too many', () => {
    const small = JSON.parse(JSON.stringify(file()));
    small.project.panel.plates[0].widthMm = 5;
    expect(errorsOf(small)).toEqual(['project.panel.plates[0].widthMm']);
    const none = JSON.parse(JSON.stringify(file()));
    none.project.panel.plates = [];
    expect(errorsOf(none)).toContain('project.panel.plates');
    const device = JSON.parse(JSON.stringify(file()));
    delete device.project.panel.placements[3].plate;
    expect(errorsOf(device)).toEqual(['project.panel.placements[3]']);
  });

  it('are reported by the comparison: added, resized, and a row that went to another plate', () => {
    const before = file();
    const changed = ok(moveRailToPlate(ok(resizePlate(twoPlates(), DEFAULT_PLATE_ID, 300, 400)), 0, 'plate2'));
    const after = buildProjectFile({ panel: ok(addPlate(changed, 'Right door', 600, 800) as PlateResult), schematic: emptySchematic() }, resolve);
    const lines = diffProjects(before, after).map((c) => `${c.area}/${c.kind}: ${c.text}`);
    expect(lines.some((l) => l.startsWith('plates/added:') && l.includes('Right door'))).toBe(true);
    expect(lines.some((l) => l.startsWith('plates/changed:') && l.includes('width') && l.includes('300'))).toBe(true);
    expect(lines.some((l) => l.startsWith('rows/changed:') && l.includes('plate'))).toBe(true);
  });
});

describe('the plate on view in a session', () => {
  const session = (): Session => {
    const s = new Session();
    s.libraries = [];
    (s as { resolve: typeof resolve }).resolve = resolve;
    s.reset({ panel: twoPlates(), schematic: emptySchematic() });
    return s;
  };

  it('starts on the first plate and shows the one that was chosen as a panel of its own', () => {
    const s = session();
    expect(s.plateId).toBe(DEFAULT_PLATE_ID);
    s.plateId = 'plate2';
    expect(s.scope.panel.plates[0]!.id).toBe('plate2');
    expect(s.scope.offset).toBe(2);
  });

  it('shows the plate of what is selected, so that finding a thing takes the view to it', () => {
    const s = session();
    s.select({ placementId: 'p5' });
    expect(s.plateId).toBe('plate2');
    s.select({ placementId: 'p4' });
    expect(s.plateId).toBe(DEFAULT_PLATE_ID);
    s.select({ ductId: 'd1' });
    expect(s.plateId).toBe('plate2');
  });

  it('follows a thing that is moved to another plate', () => {
    const s = session();
    s.select({ ductId: 'd1' });
    expect(s.plateId).toBe('plate2');
    s.commit({ panel: ok(moveToPlate(s.project.panel, 'd1', DEFAULT_PLATE_ID)), schematic: emptySchematic() });
    expect(s.plateId).toBe(DEFAULT_PLATE_ID);
  });

  it('falls back on the first plate when the one on view is gone, as after an undo', () => {
    const s = session();
    s.plateId = 'plate2';
    const emptied: Panel = { ...createPanel([12]), plates: [twoPlates().plates[0]!] };
    s.commit({ panel: emptied, schematic: emptySchematic() });
    expect(s.plateId).toBe(DEFAULT_PLATE_ID);
  });

  it('finds the scope again only when the panel or the plate changes', () => {
    const s = session();
    const first = s.scope;
    expect(s.scope).toBe(first);
    s.plateId = 'plate2';
    expect(s.scope).not.toBe(first);
  });
});

describe('the inspector for plates', () => {
  const ctx = (selection: InspectContext['selection'], plate = DEFAULT_PLATE_ID, panel = twoPlates()): InspectContext => ({
    project: { panel, schematic: emptySchematic() },
    selection,
    mode: 'panel',
    resolve,
    snapshot: {},
    fromLibraries: resolve,
    plate,
  });
  const field = (c: InspectContext, key: string) => inspect(c)!.fields.find((f) => f.key === key);

  it('shows the plate on view with its name and size, and the rows on it', () => {
    expect(field(ctx({}, 'plate2'), 'plateName')).toMatchObject({ value: 'Left door' });
    expect(field(ctx({}, 'plate2'), 'plateWidth')).toMatchObject({ value: 500 });
    expect(field(ctx({}, 'plate2'), 'rows')).toMatchObject({ value: 1 });
    expect(field(ctx({}, DEFAULT_PLATE_ID), 'rows')).toMatchObject({ value: 2 });
  });

  it('renames and resizes the plate on view, and says why it refuses', () => {
    const renamed = applyEdit(ctx({}, 'plate2'), 'plateName', 'Door');
    expect(renamed.ok && plateById(renamed.project.panel, 'plate2')?.name).toBe('Door');
    const taken = applyEdit(ctx({}, 'plate2'), 'plateName', 'Back plate');
    expect(!taken.ok && taken.message).toBe('Another plate has that name.');
    const resized = applyEdit(ctx({}, 'plate2'), 'plateHeight', '900');
    expect(resized.ok && plateById(resized.project.panel, 'plate2')).toMatchObject({ widthMm: 500, heightMm: 900 });
    expect(applyEdit(ctx({}, 'plate2'), 'plateWidth', '5').ok).toBe(false);
  });

  it('adds and removes rows on the plate on view only', () => {
    const grown = applyEdit(ctx({}, 'plate2'), 'rows', '2');
    expect(grown.ok && grown.project.panel.rails.map((r) => r.plate)).toEqual([DEFAULT_PLATE_ID, DEFAULT_PLATE_ID, 'plate2', 'plate2']);
    const refused = applyEdit(ctx({}, DEFAULT_PLATE_ID), 'rows', '1');
    expect(!refused.ok && refused.message).toBe('Move the modules off the rows you remove first.');
  });

  it('offers to fit a plate that does not fit what is on it, and to remove one when there are several', () => {
    const actions = inspect(ctx({}, 'plate2'))!.actions.map((a) => a.key);
    expect(actions).toEqual(expect.arrayContaining(['fitPlate', 'removePlate']));
    const fitted = applyAction(ctx({}, 'plate2'), 'fitPlate');
    expect(fitted.ok && plateById(fitted.project.panel, 'plate2')!.heightMm).not.toBe(700);
    const refused = applyAction(ctx({}, 'plate2'), 'removePlate');
    expect(!refused.ok && refused.message).toBe('Move or delete what is on the plate first.');
    const emptied = ok(addPlate(createPanel([12]), 'Empty', 600, 800) as PlateResult);
    const removed = applyAction(ctx({}, 'plate2', emptied), 'removePlate');
    expect(removed.ok && removed.project.panel.plates).toHaveLength(1);
    expect(inspect(ctx({}, DEFAULT_PLATE_ID, createPanel([12])))!.actions.map((a) => a.key)).not.toContain('removePlate');
  });

  it('lets a row, a device on the plate and a duct be moved to another plate by its name', () => {
    expect(field(ctx({ ductId: 'd1' }, 'plate2'), 'plate')).toMatchObject({ value: 'Left door', options: ['Back plate', 'Left door'] });
    const duct = applyEdit(ctx({ ductId: 'd1' }, 'plate2'), 'plate', 'Back plate');
    expect(duct.ok && ductsOf(duct.project.panel)[0]?.plate).toBe(DEFAULT_PLATE_ID);
    const device = applyEdit(ctx({ placementId: 'p4' }), 'plate', 'Left door');
    expect(device.ok && device.project.panel.placements.find((p) => p.id === 'p4')).toMatchObject({ plate: 'plate2' });
    const row = applyEdit(ctx({ rail: 0 }), 'plate', 'Left door');
    expect(row.ok && row.project.panel.rails.map((r) => r.plate)).toEqual([DEFAULT_PLATE_ID, 'plate2', 'plate2']);
    expect(row.ok && row.selection).toEqual({ rail: 2 });
    expect(!applyEdit(ctx({ ductId: 'd1' }, 'plate2'), 'plate', 'Nowhere').ok).toBe(true);
  });

  it('offers no plate to choose while there is only one', () => {
    expect(field(ctx({ rail: 0 }, DEFAULT_PLATE_ID, createPanel([12])), 'plate')).toBeUndefined();
  });
});
