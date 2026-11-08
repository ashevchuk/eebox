import { describe, expect, it } from 'vitest';
import { markedBy } from '../src/electrical/problems';
import { gapBetween, findPlacementFindings } from '../src/layout/placementFindings';
import { MAX_CLEARANCE_MM } from '../src/layout/limits';
import { lookupsOf } from '../src/layout/lookups';
import { createPanel, setClearance } from '../src/layout/panel';
import { DEFAULT_PLATE_ID } from '../src/layout/plates';
import type { FreePlacement, Panel, Placement } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import { buildProjectFile, parseProjectJson, projectWarnings } from '../src/project/file';
import { emptySchematic } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { focusOfObjects, objectsOfSelection } from '../src/ui/problems';
import { dimensionsOf, MAX_SHOWN_MM } from '../src/view/dimensions';
import { placementRect } from '../src/view/geometry';
import { ref, resolve as fixtureResolve, place } from './fixtures';

const PLATE_ONLY: ModuleDef = { id: 'drive', kind: 'vfd', name: 'Drive', widthUnits: 8, heightMm: 250, mounting: 'plate', poles: 3 };
const BOTH: ModuleDef = { id: 'psu', kind: 'psu', name: 'Supply', widthUnits: 4, heightMm: 100, mounting: 'both', poles: 2 };
const BAR: ModuleDef = { id: 'bar', kind: 'busbar', name: 'Bar', widthUnits: 4, heightMm: 90, mounting: 'rail', poles: 1 };
const resolve = (r: { libraryId: string; moduleId: string }): ModuleDef | undefined =>
  r.moduleId === PLATE_ONLY.id ? PLATE_ONLY : r.moduleId === BOTH.id ? BOTH : r.moduleId === BAR.id ? BAR : fixtureResolve(r);
const sizes = lookupsOf(resolve).sizes;

const at = (id: string, moduleId: string, x: number, y: number): FreePlacement => ({ id, module: ref(moduleId), plate: DEFAULT_PLATE_ID, x, y });
const duct = (id: string, x: number, y: number, widthMm: number, heightMm: number) => ({ id, plate: DEFAULT_PLATE_ID, x, y, widthMm, heightMm });
const projectOf = (panel: Panel) => ({ panel, schematic: emptySchematic() });
const messages = (panel: Panel) => findPlacementFindings(projectOf(panel), sizes, resolve).map((f) => `${f.severity}: ${f.message}`);

/** A panel with one rail row at the top, and what the test puts on the plate below it, where nothing else is. */
const panelWith = (placements: Placement[], extra: Partial<Panel> = {}): Panel => ({
  ...createPanel([12]),
  plates: [{ id: DEFAULT_PLATE_ID, name: 'Back plate', widthMm: 3000, heightMm: 3000 }],
  placements,
  ...extra,
});

describe('two things on one place', () => {
  it('is an error for devices on the plate, and names both and marks both', () => {
    const panel = panelWith([at('p1', 'drive', 100, 400), at('p2', 'drive', 150, 450)]);
    const findings = findPlacementFindings(projectOf(panel), sizes, resolve);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', placements: ['p1', 'p2'] });
    expect(findings[0]!.message).toBe('Drive (p1) stands on Drive (p2).');
  });

  it('is not one when the devices only touch, or stand apart', () => {
    const width = 8 * 17.5;
    expect(messages(panelWith([at('p1', 'drive', 100, 400), at('p2', 'drive', 100 + width, 400)]))).toEqual([]);
    expect(messages(panelWith([at('p1', 'drive', 100, 400), at('p2', 'drive', 100 + width + 5, 400)]))).toEqual([]);
  });

  it('is found between a device and a duct, and marks the duct', () => {
    const panel = panelWith([at('p1', 'drive', 100, 400)], { ducts: [duct('d1', 90, 380, 300, 40)] });
    const findings = findPlacementFindings(projectOf(panel), sizes, resolve);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'error', placements: ['p1'], ducts: ['d1'] });
    expect(markedBy(findings, 'ducts').get('d1')).toBe('error');
    expect(markedBy(findings, 'placements').get('p1')).toBe('error');
  });

  it('is not one for two ducts, which cross where cables branch', () => {
    expect(messages(panelWith([], { ducts: [duct('d1', 0, 400, 300, 40), duct('d2', 100, 380, 40, 200)] }))).toEqual([]);
  });

  it('is found between modules on different rails that are too close, and not on one rail', () => {
    const rows = (pitch: number): Panel => ({ ...createPanel([12, 12], pitch), placements: [place('p1', 'psu', 0, 0), place('p2', 'psu', 1, 0)] });
    expect(messages(rows(100))).toEqual([]);
    expect(messages(rows(80))).toEqual(['error: Supply (p1) stands on Supply (p2).']);
    const sameRail: Panel = { ...createPanel([12]), placements: [place('p1', 'psu', 0, 0), place('p2', 'psu', 0, 4)] };
    expect(messages(sameRail)).toEqual([]);
  });
});

describe('a clearance to keep', () => {
  const panel = (clearanceMm?: number): Panel =>
    panelWith([at('p1', 'drive', 100, 400), at('p2', 'drive', 100 + 8 * 17.5 + 12, 400)], clearanceMm === undefined ? {} : { clearanceMm });

  it('is not checked unless it is asked for', () => {
    expect(messages(panel())).toEqual([]);
  });

  it('flags loose devices that are closer than it, with the gap, as advice', () => {
    expect(messages(panel(20))).toEqual(['advice: Drive (p1) is 12 mm from Drive (p2), closer than the 20 mm kept clear.']);
    expect(messages(panel(12))).toEqual([]);
  });

  it('is measured to ducts as well, and not between modules on one rail', () => {
    const withDuct = panelWith([at('p1', 'drive', 100, 400)], { clearanceMm: 30, ducts: [duct('d1', 100, 400 + 250 + 10, 200, 40)] });
    expect(messages(withDuct)).toEqual(['advice: Drive (p1) is 10 mm from duct d1 (d1), closer than the 30 mm kept clear.']);
    const rail: Panel = { ...createPanel([12]), clearanceMm: 50, placements: [place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)] };
    expect(findPlacementFindings(projectOf(rail), sizes, resolve)).toEqual([]);
  });

  it('is set in the inspector, between 0 and the limit, and 0 takes it away', () => {
    const ctx = (project: ReturnType<typeof projectOf>): InspectContext => ({ project, selection: {}, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });
    const set = applyEdit(ctx(projectOf(panel())), 'clearance', '25');
    expect(set.ok && set.project.panel.clearanceMm).toBe(25);
    const cleared = applyEdit(ctx(projectOf(panel(25))), 'clearance', '0');
    expect(cleared.ok && 'clearanceMm' in cleared.project.panel).toBe(false);
    expect(applyEdit(ctx(projectOf(panel())), 'clearance', String(MAX_CLEARANCE_MM + 1)).ok).toBe(false);
    expect(inspect(ctx(projectOf(panel(25))))!.fields.find((f) => f.key === 'clearance')).toMatchObject({ value: 25 });
  });

  it('is kept by the panel model within its limits', () => {
    expect(setClearance(createPanel([12]), -1)).toEqual({ ok: false, error: 'invalid-value' });
    expect(setClearance(createPanel([12]), MAX_CLEARANCE_MM + 1)).toEqual({ ok: false, error: 'invalid-value' });
    const set = setClearance(createPanel([12]), MAX_CLEARANCE_MM);
    expect(set.ok && set.panel.clearanceMm).toBe(MAX_CLEARANCE_MM);
  });

  it('survives the project file, and only a positive number up to the limit is read', () => {
    const file = buildProjectFile(projectOf(panel(25)), resolve);
    const parsed = parseProjectJson(JSON.stringify(file));
    expect(parsed.ok && parsed.file.project.panel.clearanceMm).toBe(25);
    for (const bad of [0, -5, MAX_CLEARANCE_MM + 1, '20']) {
      const raw = JSON.parse(JSON.stringify(file));
      raw.project.panel.clearanceMm = bad;
      const result = parseProjectJson(JSON.stringify(raw));
      expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(['project.panel.clearanceMm']);
    }
  });
});

describe('a loose thing on a rail', () => {
  it('is advice for a device on the plate and for a duct, naming the row', () => {
    const rail = createPanel([12]).rails[0]!;
    const onRail = panelWith([at('p1', 'psu', rail.x + 10, rail.y - 20)], { ducts: [duct('d1', rail.x, rail.y - 5, 100, 20)] });
    expect(messages(onRail)).toEqual(
      expect.arrayContaining([
        'advice: Supply (p1) stands on the rail of row 1.',
        'advice: duct d1 (d1) stands on the rail of row 1.',
        'error: Supply (p1) stands on duct d1 (d1).',
      ]),
    );
  });

  it('is not said of modules that clip on that rail', () => {
    expect(messages(panelWith([place('p1', 'mcb1', 0, 0)]))).toEqual([]);
  });
});

describe('a device where it was not made to stand', () => {
  it('is advice for a plate-only device on a rail and a rail-only one on the plate, and none for either', () => {
    const lowered = { ...panelWith([place('p1', 'drive', 0, 0)]), rails: [{ ...createPanel([12]).rails[0]!, y: 300 }] };
    expect(messages(lowered)).toEqual(['advice: Drive (p1) is made for the plate, not for a rail.']);
    expect(messages(panelWith([at('p1', 'mcb1', 100, 400)]))).toEqual(['advice: MCB 1P (p1) is made for a DIN rail, not for the plate.']);
    expect(messages(panelWith([place('p1', 'psu', 0, 0), at('p2', 'psu', 100, 400)]))).toEqual([]);
  });

  it('is named by its label when it has one', () => {
    expect(messages(panelWith([{ ...at('p1', 'mcb1', 100, 400), label: 'Kitchen' }]))).toEqual(['advice: Kitchen (p1) is made for a DIN rail, not for the plate.']);
  });
});

describe('the findings of a project that is opened', () => {
  it('are among its warnings, so a file with a device on a device says so', () => {
    const panel = panelWith([at('p1', 'drive', 100, 400), at('p2', 'drive', 150, 450)]);
    expect(projectWarnings(projectOf(panel), resolve)).toContain('Drive (p1) stands on Drive (p2).');
  });
});

describe('the distance between two rectangles', () => {
  it('is nothing for touching or overlapping ones, and straight or slanted otherwise', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(gapBetween(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(0);
    expect(gapBetween(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(0);
    expect(gapBetween(a, { x: 15, y: 0, width: 5, height: 10 })).toBe(5);
    expect(gapBetween(a, { x: 13, y: 14, width: 5, height: 5 })).toBe(5);
  });
});

describe('the lines of dimension from a selected thing', () => {
  const corner = { x: 40, y: 40 };
  const box = { x: 200, y: 200, width: 100, height: 50 };

  it('go to the nearest thing that is beside it in each direction, in the middle of what they share', () => {
    const others = [
      { x: 350, y: 180, width: 20, height: 40 },
      { x: 400, y: 200, width: 20, height: 40 },
      { x: 100, y: 230, width: 50, height: 20 },
      { x: 220, y: 100, width: 40, height: 50 },
      { x: 150, y: 290, width: 200, height: 20 },
    ];
    const found = dimensionsOf(box, others, corner);
    expect(found).toContainEqual({ from: { x: 300, y: 210 }, to: { x: 350, y: 210 }, mm: 50 });
    expect(found).toContainEqual({ from: { x: 150, y: 240 }, to: { x: 200, y: 240 }, mm: 50 });
    expect(found).toContainEqual({ from: { x: 240, y: 150 }, to: { x: 240, y: 200 }, mm: 50 });
    expect(found).toContainEqual({ from: { x: 250, y: 250 }, to: { x: 250, y: 290 }, mm: 40 });
    expect(found).toHaveLength(4);
  });

  it('go to the edge of the plate on the left and on top where nothing is in the way', () => {
    const found = dimensionsOf(box, [], corner);
    expect(found).toEqual([
      { from: { x: 40, y: 225 }, to: { x: 200, y: 225 }, mm: 160 },
      { from: { x: 250, y: 40 }, to: { x: 250, y: 200 }, mm: 160 },
    ]);
  });

  it('leave out what shares nothing with the box, what is touching it, and what is too far', () => {
    const found = dimensionsOf(box, [{ x: 400, y: 300, width: 20, height: 20 }, { x: 300, y: 200, width: 20, height: 20 }, { x: 200 + MAX_SHOWN_MM + 200, y: 200, width: 5, height: 5 }], { x: 200, y: 200 });
    expect(found).toEqual([]);
  });

  it('measure a free device the same way the drawing places it', () => {
    const panel = panelWith([at('p1', 'drive', 100, 400)]);
    const body = placementRect(panel, sizes, panel.placements[0]!);
    expect(dimensionsOf(body, [], { x: 40, y: 40 })).toContainEqual({ from: { x: 40, y: body.y + body.height / 2 }, to: { x: body.x, y: body.y + body.height / 2 }, mm: 100 });
  });
});

describe('looking at a finding about a duct', () => {
  it('selects the duct and takes its box as the thing to show', () => {
    const panel = panelWith([], { ducts: [duct('d1', 100, 200, 300, 40)] });
    const focus = focusOfObjects(projectOf(panel), resolve, { placements: [], nodes: [], wires: [], ducts: ['d1'] }, 'panel')!;
    expect(focus.mode).toBe('panel');
    expect(focus.selection).toEqual({ ductId: 'd1' });
    expect(focus.bounds).toMatchObject({ minX: 140, minY: 240, maxX: 440, maxY: 280 });
  });

  it('turns a selection with a duct into objects with it', () => {
    expect(objectsOfSelection({ ductId: 'd1' }).ducts).toEqual(['d1']);
    expect('ducts' in objectsOfSelection({ placementId: 'p1' })).toBe(false);
  });
});
