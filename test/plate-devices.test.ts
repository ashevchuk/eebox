import { describe, expect, it } from 'vitest';
import { addDuct, changeDuct, ductsOf, nextDuctId, removeDuct, setDuctLabel, type Duct } from '../src/layout/ducts';
import { addFreePlacement, moveFreeGroup, moveFreePlacement, roundMm } from '../src/layout/free';
import { copyItems, FREE_PASTE_OFFSET_MM, pasteItems, repeatItems } from '../src/layout/clipboard';
import { MAX_DUCTS, MAX_DUCT_SIZE_MM, MAX_RAIL_POSITION_MM, MIN_DUCT_SIZE_MM } from '../src/layout/limits';
import { createPanel } from '../src/layout/panel';
import { DEFAULT_PLATE_ID } from '../src/layout/plates';
import { fitPlate } from '../src/view/plateFit';
import { isFree, isOnRail, type FreePlacement, type Panel } from '../src/layout/placement';
import { placeFromShelfFree, takeOff } from '../src/layout/shelf';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { diffProjects } from '../src/project/diff';
import { emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { applyAction, applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { nextModuleId, plateStep } from '../src/ui/keyboardMoves';
import { groupSelection, selectedIds, toggleItem } from '../src/ui/selection';
import { FRAME_PADDING, ductAt, ductRect, frameRect, itemsInRect, placementAt, placementRect } from '../src/view/geometry';
import { snapRect } from '../src/view/snap';
import { PanelView } from '../src/ui/panelView';
import { Session } from '../src/ui/session';
import { SvgContext } from '../src/view/svgContext';
import { combAt, panelOf, place, ref, resolve, sizes, widthOf } from './fixtures';

const freeAt = (id: string, moduleId: string, x: number, y: number): FreePlacement => ({ id, module: ref(moduleId), plate: DEFAULT_PLATE_ID, x, y });
const duct = (id: string, x: number, y: number, widthMm = 200, heightMm = 40): Duct => ({ id, plate: DEFAULT_PLATE_ID, x, y, widthMm, heightMm });
const unwrap = (result: { ok: boolean; panel?: Panel }): Panel => {
  if (!result.ok || !result.panel) throw new Error(JSON.stringify(result));
  return result.panel;
};
const withFree = (): Panel => unwrap(addFreePlacement(panelOf([place('p1', 'mcb1', 0, 0)]), widthOf, freeAt('p2', 'breaker16', 100, 300)));

describe('devices fixed to the plate', () => {
  it('are added at a place, with a module that is known and an id that is new', () => {
    const panel = withFree();
    expect(panel.placements.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(addFreePlacement(panel, widthOf, freeAt('p2', 'mcb1', 0, 0))).toEqual({ ok: false, error: { kind: 'duplicate-id' } });
    expect(addFreePlacement(panel, widthOf, freeAt('p9', 'nothing', 0, 0))).toEqual({ ok: false, error: { kind: 'unknown-module' } });
  });

  it('keep to the limits of the plate, and stand on other things without being refused', () => {
    const panel = withFree();
    expect(addFreePlacement(panel, widthOf, freeAt('p9', 'mcb1', -1, 0))).toEqual({ ok: false, error: { kind: 'bad-position' } });
    expect(addFreePlacement(panel, widthOf, freeAt('p9', 'mcb1', 0, MAX_RAIL_POSITION_MM + 1))).toEqual({ ok: false, error: { kind: 'bad-position' } });
    expect(addFreePlacement(panel, widthOf, freeAt('p9', 'breaker16', 100, 300)).ok).toBe(true);
  });

  it('move to another place, to a tenth of a millimetre', () => {
    const moved = unwrap(moveFreePlacement(withFree(), 'p2', 12.34, 56.78));
    expect(moved.placements.find((p) => p.id === 'p2')).toMatchObject({ x: 12.3, y: 56.8 });
    expect(roundMm(0.04)).toBe(0);
  });

  it('leave their rail when moved onto the plate, and a placed one keeps its other properties', () => {
    const labelled = { ...place('p1', 'mcb1', 0, 0), label: 'Kitchen' };
    const moved = unwrap(moveFreePlacement(panelOf([labelled]), 'p1', 50, 60));
    const placement = moved.placements[0]!;
    expect(isFree(placement) && placement.label === 'Kitchen').toBe(true);
    expect('rail' in placement || 'slot' in placement).toBe(false);
  });

  it('can be shelved and put back on the plate, keeping their id', () => {
    const shelved = unwrap(takeOff(withFree(), 'p2'));
    expect(shelved.shelf[0]).toEqual({ id: 'p2', module: ref('breaker16') });
    const back = unwrap(placeFromShelfFree(shelved, widthOf, 'p2', DEFAULT_PLATE_ID, 5, 6));
    expect(back.placements.find((p) => p.id === 'p2')).toMatchObject({ x: 5, y: 6 });
    expect(back.shelf).toEqual([]);
  });

  it('are left out of everything that goes by rails', () => {
    const panel = withFree();
    expect(panel.placements.filter(isOnRail).map((p) => p.id)).toEqual(['p1']);
    const nodes = syncModuleNodes(emptySchematic(), panel, (m) => m.moduleId).nodes;
    expect(nodes.map((n) => n.placementId)).toEqual(['p1', 'p2']);
  });
});

describe('moving devices on the plate and ducts together', () => {
  const panel = (): Panel => ({ ...withFree(), ducts: [duct('d1', 20, 30)] });

  it('shifts every chosen one by the same distance and leaves the rest', () => {
    const moved = unwrap(moveFreeGroup(panel(), ['p2'], ['d1'], 10, -5));
    expect(moved.placements.find((p) => p.id === 'p2')).toMatchObject({ x: 110, y: 295 });
    expect(ductsOf(moved)[0]).toMatchObject({ x: 30, y: 25 });
    expect(moved.placements.find((p) => p.id === 'p1')).toEqual(panel().placements[0]);
  });

  it('stops at the top and the left edge of the plate for the one that gets there first', () => {
    const moved = unwrap(moveFreeGroup(panel(), ['p2'], ['d1'], -500, -500));
    expect(ductsOf(moved)[0]).toMatchObject({ x: 0, y: 0 });
    expect(moved.placements.find((p) => p.id === 'p2')).toMatchObject({ x: 80, y: 270 });
  });

  it('does not move a module that stands on a rail, even when its id is among the chosen', () => {
    const moved = unwrap(moveFreeGroup(panel(), ['p1', 'p2'], [], 10, 10));
    expect(moved.placements.find((p) => p.id === 'p1')).toEqual(panel().placements[0]);
  });

  it('refuses a move past the far limit, and when nothing is chosen', () => {
    expect(moveFreeGroup(panel(), ['p2'], [], MAX_RAIL_POSITION_MM, 0)).toEqual({ ok: false });
    expect(moveFreeGroup(panel(), [], [], 1, 1)).toEqual({ ok: false });
  });
});

describe('cable ducts', () => {
  it('are added, changed, labelled and removed, and the panel has none again when the last goes', () => {
    let panel = unwrap(addDuct(createPanel([12]), duct('d1', 10, 20)));
    expect(ductsOf(panel)).toHaveLength(1);
    panel = unwrap(changeDuct(panel, 'd1', { x: 50, widthMm: 300 }));
    expect(ductsOf(panel)[0]).toMatchObject({ x: 50, y: 20, widthMm: 300, heightMm: 40 });
    panel = unwrap(setDuctLabel(panel, 'd1', ' Power '));
    expect(ductsOf(panel)[0]?.label).toBe('Power');
    panel = unwrap(setDuctLabel(panel, 'd1', ''));
    expect('label' in ductsOf(panel)[0]!).toBe(false);
    panel = unwrap(removeDuct(panel, 'd1'));
    expect('ducts' in panel).toBe(false);
  });

  it('refuse a size or a place outside the limits, an id twice, and one that is not there', () => {
    const panel = unwrap(addDuct(createPanel([12]), duct('d1', 10, 20)));
    expect(addDuct(panel, duct('d1', 0, 0))).toEqual({ ok: false, error: 'duplicate-id' });
    expect(addDuct(panel, duct('d2', 0, 0, MIN_DUCT_SIZE_MM - 1))).toEqual({ ok: false, error: 'invalid-value' });
    expect(addDuct(panel, duct('d2', 0, 0, 100, MAX_DUCT_SIZE_MM + 1))).toEqual({ ok: false, error: 'invalid-value' });
    expect(addDuct(panel, duct('d2', -1, 0))).toEqual({ ok: false, error: 'invalid-value' });
    expect(changeDuct(panel, 'd9', { x: 1 })).toEqual({ ok: false, error: 'unknown-duct' });
    expect(changeDuct(panel, 'd1', { heightMm: 5 })).toEqual({ ok: false, error: 'invalid-value' });
    expect(removeDuct(panel, 'd9')).toEqual({ ok: false, error: 'unknown-duct' });
  });

  it('are at most so many on one panel', () => {
    let panel = createPanel([12]);
    for (let i = 1; i <= MAX_DUCTS; i++) panel = unwrap(addDuct(panel, duct(`d${i}`, 0, 0)));
    expect(addDuct(panel, duct('d9999', 0, 0))).toEqual({ ok: false, error: 'too-many' });
  });

  it('get the next free number as an id', () => {
    expect(nextDuctId(createPanel([12]))).toBe('d1');
    expect(nextDuctId({ ...createPanel([12]), ducts: [duct('d3', 0, 0), duct('x', 0, 0)] })).toBe('d4');
  });
});

describe('copying devices on the plate and ducts', () => {
  const panel = (): Panel => ({ ...withFree(), ducts: [duct('d1', 20, 30)] });

  it('puts the copies a little aside, with new ids', () => {
    const clip = copyItems(panel(), ['p2'], [], ['d1']);
    expect(clip.free.map((p) => p.id)).toEqual(['p2']);
    const pasted = pasteItems(panel(), widthOf, { widthOf, sideOf: () => undefined }, clip);
    if (!pasted.ok) throw new Error(pasted.error);
    expect(pasted.placementIds).toEqual(['p3']);
    expect(pasted.ductIds).toEqual(['d2']);
    expect(pasted.panel.placements.find((p) => p.id === 'p3')).toMatchObject({ x: 100 + FREE_PASTE_OFFSET_MM, y: 300 + FREE_PASTE_OFFSET_MM });
    expect(ductsOf(pasted.panel)[1]).toMatchObject({ x: 20 + FREE_PASTE_OFFSET_MM, y: 30 + FREE_PASTE_OFFSET_MM });
  });

  it('does not touch the rails when only such things were copied', () => {
    const clip = copyItems(panel(), ['p2'], [], []);
    const pasted = pasteItems(panel(), widthOf, { widthOf, sideOf: () => undefined }, clip);
    if (!pasted.ok) throw new Error(pasted.error);
    expect(pasted.panel.placements.filter(isOnRail)).toEqual(panel().placements.filter(isOnRail));
  });

  it('repeats a copy so that each stands a step further from the one before', () => {
    const clip = copyItems(panel(), ['p2'], [], []);
    const repeated = repeatItems(panel(), widthOf, { widthOf, sideOf: () => undefined }, clip, 3);
    if (!repeated.ok) throw new Error(repeated.error);
    const xs = repeated.panel.placements.filter(isFree).map((p) => p.x);
    expect(xs).toEqual([100, 120, 140, 160]);
  });

  it('says nothing is copied for an empty clip', () => {
    const empty = { placements: [], combs: [], free: [], ducts: [] };
    expect(pasteItems(panel(), widthOf, { widthOf, sideOf: () => undefined }, empty)).toEqual({ ok: false, error: 'nothing-copied' });
  });
});

describe('drawing a device to the edges of the others', () => {
  const others = [{ x: 100, y: 100, width: 50, height: 20 }];

  it('moves a rectangle onto an edge within the threshold, on each axis alone', () => {
    const snapped = snapRect({ x: 153, y: 300, width: 30, height: 10 }, others, 5);
    expect(snapped).toMatchObject({ x: 150, y: 300 });
    expect(snapped.guides).toEqual([{ axis: 'x', at: 150 }]);
  });

  it('draws centres together as well as edges', () => {
    const snapped = snapRect({ x: 112, y: 200, width: 30, height: 10 }, others, 5);
    expect(snapped.x).toBe(110);
    expect(snapped.guides).toContainEqual({ axis: 'x', at: 125 });
  });

  it('takes the nearest of several lines, and leaves a rectangle that is too far where it is', () => {
    expect(snapRect({ x: 153, y: 200, width: 30, height: 10 }, [...others, { x: 152, y: 0, width: 0, height: 0 }], 5).x).toBe(152);
    expect(snapRect({ x: 400, y: 400, width: 30, height: 10 }, others, 5)).toEqual({ x: 400, y: 400, guides: [] });
  });

  it('draws the lower edge to a line too, not only the upper one', () => {
    expect(snapRect({ x: 0, y: 91, width: 10, height: 30 }, others, 5).y).toBe(90);
  });
});

describe('where devices on the plate and ducts are on the drawing', () => {
  const panel = (): Panel => ({ ...withFree(), ducts: [duct('d1', 20, 30)] });

  it('puts a free device by its own position, whatever the rails are', () => {
    const rect = placementRect(panel(), sizes, panel().placements[1]!);
    expect(rect).toMatchObject({ x: FRAME_PADDING + 100, y: FRAME_PADDING + 300, width: 17.5 * (widthOf(panel().placements[1]!) ?? 1) });
    expect(rect.height).toBe(90);
  });

  it('finds a free device and a duct under a point, a device first', () => {
    const p = panel();
    const device = placementRect(p, sizes, p.placements[1]!);
    expect(placementAt(p, sizes, { x: device.x + 1, y: device.y + 1 })?.id).toBe('p2');
    const d = ductRect(ductsOf(p)[0]!);
    expect(ductAt(p, { x: d.x + 5, y: d.y + 5 })?.id).toBe('d1');
    expect(ductAt(p, { x: d.x - 5, y: d.y })).toBeUndefined();
  });

  it('is caught by a selection rectangle', () => {
    const p = panel();
    const d = ductRect(ductsOf(p)[0]!);
    const found = itemsInRect(p, sizes, () => undefined, { x: d.x - 1, y: d.y - 1, width: 5, height: 5 });
    expect(found).toEqual({ placements: [], combs: [], ducts: ['d1'] });
  });

  it('is held by a plate that is fitted to a device on it and a duct, with the room a label needs below', () => {
    const base = frameRect(panelOf([], [], [12]));
    const far = { ...panelOf([], [], [12]), ducts: [duct('d1', 800, 500, 100, 40)] };
    const fittedDuct = fitPlate(far, DEFAULT_PLATE_ID, sizes);
    if (!fittedDuct.ok) throw new Error(fittedDuct.error);
    expect(frameRect(fittedDuct.panel).width).toBeGreaterThan(base.width);
    expect(frameRect(fittedDuct.panel).height).toBeGreaterThanOrEqual(FRAME_PADDING + 500 + 40 + FRAME_PADDING);
    const device = { ...panelOf([], [], [12]), placements: [freeAt('p1', 'mcb1', 900, 700)] };
    const fitted = fitPlate(device, DEFAULT_PLATE_ID, sizes);
    if (!fitted.ok) throw new Error(fitted.error);
    const body = placementRect(fitted.panel, sizes, fitted.panel.placements[0]!);
    const around = frameRect(fitted.panel);
    expect(around.x + around.width).toBeGreaterThanOrEqual(body.x + body.width + FRAME_PADDING);
    expect(around.y + around.height).toBeGreaterThan(body.y + body.height);
    expect(around.y).toBe(0);
  });
});

describe('devices on the plate and ducts in the project file', () => {
  const stocked = (): Panel => ({ ...withFree(), ducts: [{ ...duct('d1', 20, 30), label: 'Power' }] });
  const file = () => buildProjectFile({ panel: stocked(), schematic: emptySchematic() }, resolve);
  const errorsOf = (raw: unknown): string[] => {
    const result = parseProjectJson(JSON.stringify(raw));
    return result.ok ? [] : result.errors.map((e) => e.path);
  };

  it('are kept through saving and loading', () => {
    const parsed = parseProjectJson(JSON.stringify(file()));
    expect(parsed.ok && parsed.file.project.panel.placements).toEqual(stocked().placements);
    expect(parsed.ok && parsed.file.project.panel.ducts).toEqual(stocked().ducts);
  });

  it('refuse a device on a rail and on the plate at once, or half of either', () => {
    const raw = JSON.parse(JSON.stringify(file()));
    raw.project.panel.placements[1].rail = 0;
    expect(errorsOf(raw)).toEqual(['project.panel.placements[1]']);
    const half = JSON.parse(JSON.stringify(file()));
    delete half.project.panel.placements[1].y;
    expect(errorsOf(half)).toEqual(['project.panel.placements[1]']);
    const railHalf = JSON.parse(JSON.stringify(file()));
    delete railHalf.project.panel.placements[0].slot;
    expect(errorsOf(railHalf)).toEqual(['project.panel.placements[0]']);
    const neither = JSON.parse(JSON.stringify(file()));
    delete neither.project.panel.placements[1].x;
    delete neither.project.panel.placements[1].y;
    expect(errorsOf(neither)).toEqual(['project.panel.placements[1]']);
  });

  it('refuse a duct that is too small, outside the plate, unlabelled wrongly, or listed empty', () => {
    const small = JSON.parse(JSON.stringify(file()));
    small.project.panel.ducts[0].widthMm = 1;
    expect(errorsOf(small)).toEqual(['project.panel.ducts[0].widthMm']);
    const outside = JSON.parse(JSON.stringify(file()));
    outside.project.panel.ducts[0].x = -3;
    expect(errorsOf(outside)).toEqual(['project.panel.ducts[0].x']);
    const label = JSON.parse(JSON.stringify(file()));
    label.project.panel.ducts[0].label = '';
    expect(errorsOf(label)).toEqual(['project.panel.ducts[0].label']);
    const empty = JSON.parse(JSON.stringify(file()));
    empty.project.panel.ducts = [];
    expect(errorsOf(empty)).toEqual(['project.panel.ducts']);
  });

  it('are reported as moved or added when two files are compared', () => {
    const before = file();
    const moved = unwrap(moveFreePlacement(stocked(), 'p2', 10, 20));
    const after = buildProjectFile({ panel: { ...moved, ducts: [...ductsOf(moved), duct('d2', 0, 0, 50, 50)] }, schematic: emptySchematic() }, resolve);
    const lines = diffProjects(before, after).map((c) => `${c.area}/${c.kind}: ${c.text}`);
    expect(lines.some((l) => l.startsWith('modules/changed:') && l.includes('on the plate at 100, 300 mm') && l.includes('on the plate at 10, 20 mm'))).toBe(true);
    expect(lines.some((l) => l.startsWith('ducts/added:') && l.includes('d2'))).toBe(true);
  });
});

describe('selecting and stepping through devices on the plate and ducts', () => {
  it('a selection can hold ducts, and one duct alone is a plain selection of it', () => {
    expect(groupSelection([], [], ['d1'])).toEqual({ ductId: 'd1' });
    expect(groupSelection(['p1'], [], ['d1'])).toEqual({ placementIds: ['p1'], combIds: [], ductIds: ['d1'] });
    expect(selectedIds({ ductId: 'd1' }).ducts).toEqual(['d1']);
    expect(toggleItem({ ductId: 'd1' }, 'duct', 'd2')).toEqual({ placementIds: [], combIds: [], ductIds: ['d1', 'd2'] });
    expect(toggleItem({ ductIds: ['d1', 'd2'], placementIds: [], combIds: [] }, 'duct', 'd2')).toEqual({ ductId: 'd1' });
  });

  it('Tab goes along the rails first and then down the plate', () => {
    const panel = { ...withFree(), placements: [freeAt('p3', 'mcb1', 0, 500), freeAt('p2', 'mcb1', 0, 100), place('p1', 'mcb1', 0, 0)] };
    expect(nextModuleId(panel, ['p1'], false)).toBe('p2');
    expect(nextModuleId(panel, ['p2'], false)).toBe('p3');
    expect(nextModuleId(panel, ['p3'], false)).toBe('p1');
    expect(nextModuleId(panel, ['p1'], true)).toBe('p3');
  });

  it('the arrow keys move a device on the plate by a millimetre, ten with Shift, half with Alt', () => {
    expect(plateStep('ArrowLeft', false, false)).toEqual({ dx: -1, dy: 0 });
    expect(plateStep('ArrowDown', true, false)).toEqual({ dx: 0, dy: 10 });
    expect(plateStep('ArrowRight', false, true)).toEqual({ dx: 0.5, dy: 0 });
  });
});

describe('the inspector for devices on the plate and ducts', () => {
  const project = () => ({ panel: { ...withFree(), ducts: [duct('d1', 20, 30)] }, schematic: emptySchematic() });
  const ctx = (selection: InspectContext['selection']): InspectContext => ({ project: project(), selection, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });
  const keys = (c: InspectContext) => (inspect(c)?.fields ?? []).map((f) => f.key);

  it('shows where a device on the plate is, in millimetres, and not a row', () => {
    expect(keys(ctx({ placementId: 'p2' }))).toEqual(expect.arrayContaining(['x', 'y']));
    expect(keys(ctx({ placementId: 'p2' }))).not.toContain('row');
    expect(keys(ctx({ placementId: 'p1' }))).toContain('row');
    expect(inspect(ctx({ placementId: 'p2' }))!.actions.map((a) => a.label)).toContain('Take off the plate');
  });

  it('moves a device on the plate when its place is typed, and says when it is outside', () => {
    const result = applyEdit(ctx({ placementId: 'p2' }), 'x', '42.5');
    expect(result.ok && result.project.panel.placements.find((p) => p.id === 'p2')).toMatchObject({ x: 42.5, y: 300 });
    const outside = applyEdit(ctx({ placementId: 'p2' }), 'y', '99999');
    expect(!outside.ok && outside.message).toBe('The position is outside the plate.');
  });

  it('describes a duct and edits its label, place and size', () => {
    const view = inspect(ctx({ ductId: 'd1' }))!;
    expect(view.title).toBe('Cable duct');
    expect(view.fields.map((f) => f.key)).toEqual(['label', 'x', 'y', 'widthMm', 'heightMm', 'id']);
    const sized = applyEdit(ctx({ ductId: 'd1' }), 'widthMm', '350');
    expect(sized.ok && ductsOf(sized.project.panel)[0]).toMatchObject({ widthMm: 350, x: 20 });
    const labelled = applyEdit(ctx({ ductId: 'd1' }), 'label', 'Control');
    expect(labelled.ok && ductsOf(labelled.project.panel)[0]?.label).toBe('Control');
    expect(applyEdit(ctx({ ductId: 'd1' }), 'heightMm', '2').ok).toBe(false);
  });

  it('deletes a duct by its action', () => {
    const result = applyAction(ctx({ ductId: 'd1' }), 'removeDuct');
    expect(result.ok && ductsOf(result.project.panel)).toEqual([]);
  });

  it('counts the ducts of a group of selected things', () => {
    const view = inspect(ctx({ placementIds: ['p2'], combIds: [], ductIds: ['d1'] }))!;
    expect(view.title).toBe('2 items selected');
  });
});

describe('the drawing of devices on the plate and ducts', () => {
  const exported = (): string => {
    const session = new Session();
    session.libraries = [];
    (session as { resolve: typeof resolve }).resolve = resolve;
    const base = { ...withFree(), ducts: [{ ...duct('d1', 20, 30, 300, 40), label: 'Power <main>' }] };
    session.reset({ panel: base, schematic: emptySchematic() });
    const svg = new SvgContext(900, 600, (text) => text.length * 4);
    new PanelView(session).draw(svg as unknown as CanvasRenderingContext2D, 900, 600, 1);
    return svg.toSvg();
  };

  it('are in an exported SVG, with the text of a duct escaped', () => {
    const svg = exported();
    expect(svg).toContain('Power &lt;main&gt;');
    expect(svg).not.toContain('Power <main>');
    expect(svg).toContain('#475569');
  });

  it('leave out the lines a dragged device is drawn to, which are only for the screen', () => {
    expect(exported()).not.toContain('#e879f9');
  });
});
