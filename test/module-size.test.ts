import { describe, expect, it } from 'vitest';
import { SWITCHING_KINDS } from '../src/electrical/energy';
import { lookupsOf } from '../src/layout/lookups';
import { createPanel } from '../src/layout/panel';
import { DEFAULT_PLATE_ID } from '../src/layout/plates';
import { fitPlate } from '../src/view/plateFit';
import { FIRST_RAIL_Y_MM } from '../src/layout/limits';
import type { Panel, RailPlacement } from '../src/layout/placement';
import { genericModules } from '../src/library/genericSeries';
import { artToSvg } from '../src/library/svgExport';
import {
  DIN_MODULE_HEIGHT_MM,
  MAX_MODULE_HEIGHT_MM,
  MIN_MODULE_HEIGHT_MM,
  MOUNTINGS,
  type Library,
  type ModuleDef,
} from '../src/library/types';
import { validateLibrary } from '../src/library/validate';
import { AUTOMATION_TEMPLATES } from '../src/ui/automationTemplates';
import { addModule, applyEditorEdit, describeEditor, newLibrary, type EditorState } from '../src/ui/libraryEditor';
import { designerLayout } from '../src/ui/moduleDesigner';
import { MODULE_TEMPLATES } from '../src/ui/moduleTemplates';
import { frameRect, labelRoom, moduleRect, placementAt, placementRect, railCenterY } from '../src/view/geometry';

const LIBRARY = 'lib';
const tall: ModuleDef = { id: 'drive', kind: 'vfd', name: 'Drive', widthUnits: 8, heightMm: 250, mounting: 'plate', poles: 3 };
const resolve = (ref: { libraryId: string; moduleId: string }) => (ref.moduleId === tall.id ? tall : undefined);
const placed = (): RailPlacement => ({ id: 'p1', module: { libraryId: LIBRARY, moduleId: tall.id }, rail: 0, slot: 1 });
const panelWithTall = (): Panel => ({ ...createPanel([12]), placements: [placed()] });

const libraryWith = (change: (module: Record<string, unknown>) => void): unknown => {
  const module: Record<string, unknown> = { id: 'm', kind: 'breaker', name: 'M', widthUnits: 1, heightMm: 90, mounting: 'rail', poles: 1 };
  change(module);
  return { schemaVersion: 1, id: 'x', name: 'X', modules: [module] };
};
const pathsOf = (raw: unknown): string[] => {
  const result = validateLibrary(raw);
  return result.ok ? [] : result.errors.map((e) => e.path);
};

describe('the height and the mounting of a module in a library', () => {
  it('are required, so a module never gets a size by guessing', () => {
    expect(pathsOf(libraryWith((m) => delete m.heightMm))).toEqual(['modules[0].heightMm']);
    expect(pathsOf(libraryWith((m) => delete m.mounting))).toEqual(['modules[0].mounting']);
  });

  it('accept both limits of the height and refuse values just outside them', () => {
    expect(pathsOf(libraryWith((m) => (m.heightMm = MIN_MODULE_HEIGHT_MM)))).toEqual([]);
    expect(pathsOf(libraryWith((m) => (m.heightMm = MAX_MODULE_HEIGHT_MM)))).toEqual([]);
    expect(pathsOf(libraryWith((m) => (m.heightMm = MIN_MODULE_HEIGHT_MM - 0.1)))).toEqual(['modules[0].heightMm']);
    expect(pathsOf(libraryWith((m) => (m.heightMm = MAX_MODULE_HEIGHT_MM + 1)))).toEqual(['modules[0].heightMm']);
    expect(pathsOf(libraryWith((m) => (m.heightMm = '90')))).toEqual(['modules[0].heightMm']);
  });

  it('take each mounting and refuse another word', () => {
    for (const mounting of MOUNTINGS) expect(pathsOf(libraryWith((m) => (m.mounting = mounting)))).toEqual([]);
    expect(pathsOf(libraryWith((m) => (m.mounting = 'wall')))).toEqual(['modules[0].mounting']);
  });

  it('are standard in the bundled library, whose devices all clip on a rail', () => {
    const modules = genericModules();
    expect(modules.every((m) => m.heightMm === DIN_MODULE_HEIGHT_MM && m.mounting === 'rail')).toBe(true);
  });
});

describe('a module that is not as high as a standard one', () => {
  it('stands centred on its rail, as high as its module says', () => {
    const rect = moduleRect(createPanel([12]), 0, 1, 8, 250);
    const panel = createPanel([12]);
    expect(rect.height).toBe(250);
    expect(rect.y + rect.height / 2).toBe(railCenterY(panel, 0));
  });

  it('takes its height from the module of the placement', () => {
    const rect = placementRect(panelWithTall(), lookupsOf(resolve).sizes, placed());
    expect(rect).toMatchObject({ width: 8 * 17.5, height: 250 });
  });

  it('is found by a point on the part of it that a standard module would not cover', () => {
    const panel = panelWithTall();
    const sizes = lookupsOf(resolve).sizes;
    const rect = placementRect(panel, sizes, placed());
    expect(placementAt(panel, sizes, { x: rect.x + 5, y: rect.y + 5 })?.id).toBe('p1');
    expect(placementAt(panel, sizes, { x: rect.x + 5, y: railCenterY(panel, 0) - DIN_MODULE_HEIGHT_MM / 2 - 20 })?.id).toBe('p1');
  });

  it('leaves less room for its label, which starts lower', () => {
    const panel = createPanel([12, 12], 400);
    expect(labelRoom(panel, 0, 250)).toBe(labelRoom(panel, 0, DIN_MODULE_HEIGHT_MM) - (250 - DIN_MODULE_HEIGHT_MM) / 2);
  });

  it('is written to an SVG of its own height', () => {
    expect(artToSvg(tall)).toContain('height="250mm"');
  });

  it('is drawn taller in the designer, in proportion and within bounds', () => {
    const standard = designerLayout({ ...tall, heightMm: DIN_MODULE_HEIGHT_MM }).body.height;
    expect(designerLayout(tall).body.height).toBeGreaterThan(standard);
    expect(designerLayout({ ...tall, heightMm: MAX_MODULE_HEIGHT_MM }).body.height).toBe(400);
    expect(designerLayout({ ...tall, heightMm: MIN_MODULE_HEIGHT_MM }).body.height).toBe(120);
  });
});

describe('the frame around modules of different heights', () => {
  const sizes = lookupsOf(resolve).sizes;
  const standard = (): RailPlacement => ({ id: 'p2', module: { libraryId: LIBRARY, moduleId: 'din' }, rail: 0, slot: 1 });
  const din: ModuleDef = { id: 'din', kind: 'breaker', name: 'Breaker', widthUnits: 1, heightMm: DIN_MODULE_HEIGHT_MM, mounting: 'rail', poles: 1 };
  const resolveBoth = (ref: { libraryId: string; moduleId: string }) => (ref.moduleId === 'din' ? din : resolve(ref));

  it('is the same for standard modules as for the rails alone', () => {
    const panel = createPanel([12, 12]);
    const withModule = { ...panel, placements: [standard()] };
    expect(frameRect(withModule)).toEqual(frameRect(panel));
  });

  it('gets room below when the plate is fitted, as a standard module does', () => {
    const fitted = fitPlate(panelWithTall(), DEFAULT_PLATE_ID, sizes);
    if (!fitted.ok) throw new Error(fitted.error);
    const body = placementRect(fitted.panel, sizes, placed());
    const frame = frameRect(fitted.panel);
    expect(frame.y + frame.height - (body.y + body.height)).toBeGreaterThanOrEqual(FIRST_RAIL_Y_MM - DIN_MODULE_HEIGHT_MM / 2);
  });

  it('is held by the plate once it is fitted, whichever rail the module stands on', () => {
    const panel = { ...createPanel([12, 12, 12]), placements: [{ ...placed(), rail: 2 }] };
    const fitted = fitPlate(panel, DEFAULT_PLATE_ID, sizes);
    if (!fitted.ok) throw new Error(fitted.error);
    const frame = frameRect(fitted.panel);
    const body = placementRect(fitted.panel, sizes, fitted.panel.placements[0]!);
    expect(body.y).toBeGreaterThanOrEqual(frame.y);
    expect(body.y + body.height).toBeLessThanOrEqual(frame.y + frame.height);
  });
});

describe('the height and the mounting in the library editor', () => {
  const draftWith = (): { state: EditorState; id: string } => {
    const added = addModule(newLibrary('mine', 'Mine'), 'softstarter');
    return { state: { draft: added.draft, target: { kind: 'module', id: added.id } }, id: added.id };
  };

  it('start as a standard module that clips on a rail', () => {
    const { state, id } = draftWith();
    expect(state.draft.modules.find((m) => m.id === id)).toMatchObject({ heightMm: DIN_MODULE_HEIGHT_MM, mounting: 'rail' });
  });

  it('show the two fields and apply an edit to each', () => {
    const { state } = draftWith();
    const keys = describeEditor(state).fields.map((f) => f.key);
    expect(keys).toContain('heightMm');
    expect(keys).toContain('mounting');
    const taller = applyEditorEdit(state, 'heightMm', '250');
    const plate = taller.ok ? applyEditorEdit({ ...state, draft: taller.draft }, 'mounting', 'plate') : taller;
    expect(plate.ok && plate.draft.modules[0]).toMatchObject({ heightMm: 250, mounting: 'plate' });
  });

  it('refuse a height that is not a number', () => {
    const { state } = draftWith();
    expect(applyEditorEdit(state, 'heightMm', 'tall').ok).toBe(false);
  });
});

describe('the new kinds and the templates made for them', () => {
  const asLibrary = (module: ModuleDef): Library => ({ schemaVersion: 1, id: 'x', name: 'X', modules: [module], enclosures: [] });

  it('count the soft starter and the drive among the devices that switch', () => {
    expect(SWITCHING_KINDS).toContain('softstarter');
    expect(SWITCHING_KINDS).toContain('vfd');
  });

  it('give a module that a library accepts, whichever template it comes from', () => {
    for (const template of MODULE_TEMPLATES) {
      const result = validateLibrary(asLibrary(template.build('made')));
      expect([template.id, result.ok]).toEqual([template.id, true]);
    }
  });

  it('describe devices that are taller than a standard module, or fixed to the plate, where that is their nature', () => {
    const built = Object.fromEntries(AUTOMATION_TEMPLATES.map((t) => [t.id, t.build('made')]));
    expect(built['soft-starter']).toMatchObject({ kind: 'softstarter', mounting: 'plate' });
    expect(built['soft-starter']!.heightMm).toBeGreaterThan(DIN_MODULE_HEIGHT_MM);
    expect(built['frequency-drive']).toMatchObject({ kind: 'vfd', mounting: 'plate' });
    expect(built['plc']!.terminals!.filter((t) => t.side === 'bottom')).toHaveLength(8);
  });

  it('are all found in the list of templates', () => {
    const ids = MODULE_TEMPLATES.map((t) => t.id);
    for (const template of AUTOMATION_TEMPLATES) expect(ids).toContain(template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
