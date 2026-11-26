import { describe, expect, it } from 'vitest';
import { copyItems, pasteItems } from '../src/layout/clipboard';
import { duplicateRow } from '../src/layout/arrangeModules';
import { designated, findRefFindings, isDevice, nextRef, normalizeRef, numberDevices, setPlacementRef } from '../src/layout/designations';
import { MODULE_SPEC, validateObject } from '../src/library/validate';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { wireList } from '../src/electrical/schedule';
import { bomToCsv, buildBom } from '../src/project/bom';
import { DEFAULT_PLATE_ID } from '../src/layout/plates';
import type { FreePlacement, Panel, Placement } from '../src/layout/placement';
import { takeOff } from '../src/layout/shelf';
import { buildProjectFile, parseProjectJson, projectWarnings } from '../src/project/file';
import { connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { defs, panelOf, place, ref as moduleRef, resolve, widthOf } from './fixtures';

const withRef = <T extends Placement>(placement: T, ref: string): T => ({ ...placement, ref });
const free = (id: string, moduleId: string, x: number, y: number): FreePlacement => ({ id, module: moduleRef(moduleId), plate: DEFAULT_PLATE_ID, x, y });
const refs = (panel: Panel) => Object.fromEntries(panel.placements.map((p) => [p.id, p.ref]));

describe('designations as typed', () => {
  it('are trimmed, cleared by blank text and keep the signs of a structured designation', () => {
    expect(normalizeRef(' QF1 ')).toEqual({ ok: true, ref: 'QF1' });
    expect(normalizeRef('  ')).toEqual({ ok: true, ref: undefined });
    for (const good of ['=A1+B2-QF1', 'QF1.1', '1QF2', 'XT1:3', 'A/1']) expect(normalizeRef(good).ok).toBe(true);
  });

  it('refuse spaces, other signs and more than 16 characters', () => {
    for (const bad of ['QF 1', 'QF#1', 'Q'.repeat(17), 'QF\n1']) expect(normalizeRef(bad).ok, bad).toBe(false);
  });

  it('are set and cleared on one placement only', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)]);
    const set = setPlacementRef(panel, 'p1', 'QF7');
    if (!set.ok) throw new Error(set.error.kind);
    expect(refs(set.panel)).toEqual({ p1: 'QF7', p2: undefined });
    const cleared = setPlacementRef(set.panel, 'p1', '');
    expect(cleared.ok && 'ref' in cleared.panel.placements[0]!).toBe(false);
    expect(setPlacementRef(panel, 'p1', 'QF 7')).toEqual({ ok: false, error: { kind: 'invalid-ref' } });
    expect(setPlacementRef(panel, 'p9', 'QF7')).toEqual({ ok: false, error: { kind: 'unknown-placement' } });
  });
});

describe('numbering the devices', () => {
  it('gives each kind its own code and numbers along the rows, from the top row and from the left', () => {
    const panel = panelOf([place('p1', 'mcb1', 1, 0), place('p2', 'rcd4', 0, 4), place('p3', 'mcb1', 0, 2), place('p4', 'contactor', 1, 3), place('p5', 'rcbo', 0, 0)]);
    const result = numberDevices(panel, resolve);
    expect(result.numbered).toBe(5);
    expect(refs(result.panel)).toEqual({ p1: 'QF2', p2: 'QD1', p3: 'QF1', p4: 'KM1', p5: 'QFD1' });
  });

  it('numbers the loose devices of a plate after its rows, from the top left', () => {
    const panel = panelOf([free('p1', 'contactor', 10, 300), free('p2', 'contactor', 50, 200), place('p3', 'contactor', 1, 0)]);
    expect(refs(numberDevices(panel, resolve).panel)).toEqual({ p1: 'KM3', p2: 'KM2', p3: 'KM1' });
  });

  it('keeps typed designations and goes on after the highest number in use, also on the shelf', () => {
    const shelved = takeOff(panelOf([withRef(place('p1', 'mcb1', 0, 0), 'QF5'), withRef(place('p2', 'mcb1', 0, 1), 'QF9'), place('p3', 'mcb1', 0, 2)]), 'p2');
    if (!shelved.ok) throw new Error('take off');
    const result = numberDevices(shelved.panel, resolve);
    expect(result.numbered).toBe(1);
    expect(refs(result.panel)).toEqual({ p1: 'QF5', p3: 'QF10' });
    expect(result.panel.shelf[0]?.ref).toBe('QF9');
  });

  it('leaves bars, terminal blocks and missing modules without a designation', () => {
    const panel = panelOf([place('p1', 'nbar', 0, 0), place('p2', 'colRight', 0, 6), { ...place('p3', 'mcb1', 0, 8), module: { libraryId: 'gone', moduleId: 'x' } }]);
    const result = numberDevices(panel, resolve);
    expect(result.numbered).toBe(0);
    expect(result.panel).toBe(panel);
  });

  it('suggests the next designation of a kind, and none for a kind without a code', () => {
    const panel = panelOf([withRef(place('p1', 'mcb1', 0, 0), 'QF3')]);
    expect(nextRef(panel, defs.mcb1)).toBe('QF4');
    expect(nextRef(panel, defs.contactor)).toBe('KM1');
    expect(nextRef(panel, defs.nbar)).toBeUndefined();
  });
});

describe('copies of a device', () => {
  it('do not take its designation when pasted', () => {
    const panel = panelOf([withRef({ ...place('p1', 'mcb1', 0, 0), label: 'Kitchen' }, 'QF1'), withRef(free('p2', 'contactor', 10, 300), 'KM1')]);
    const pasted = pasteItems(panel, widthOf, { widthOf, sideOf: () => undefined }, copyItems(panel, ['p1', 'p2'], [], []));
    if (!pasted.ok) throw new Error(pasted.error);
    const copies = pasted.panel.placements.slice(2);
    expect(copies.map((p) => p.ref)).toEqual([undefined, undefined]);
    expect(copies[0]?.label).toBe('Kitchen');
  });

  it('do not take it when a row is duplicated', () => {
    const result = duplicateRow(panelOf([withRef(place('p1', 'mcb1', 0, 0), 'QF1')]), 0);
    if (!result.ok) throw new Error('duplicate');
    expect(result.panel.placements.map((p) => p.ref)).toEqual(['QF1', undefined]);
  });
});

describe('designations in a project file', () => {
  const fileWith = (placement: Placement) => JSON.stringify(buildProjectFile({ panel: panelOf([placement]), schematic: emptySchematic() }, resolve));

  it('are written and read back', () => {
    const parsed = parseProjectJson(fileWith(withRef(place('p1', 'mcb1', 0, 0), '=A1-QF1')));
    expect(parsed.ok && parsed.file.project.panel.placements[0]?.ref).toBe('=A1-QF1');
  });

  it('are refused when they break the rules', () => {
    expect(parseProjectJson(fileWith(withRef(place('p1', 'mcb1', 0, 0), 'QF 1'))).ok).toBe(false);
  });
});

describe('designation in the inspector', () => {
  const ctx = (panel: Panel): InspectContext => ({ project: { panel, schematic: emptySchematic() }, selection: { placementId: 'p1' }, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });

  it('shows the next designation of the kind as the hint and edits it', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0), withRef(place('p2', 'mcb1', 0, 1), 'QF1')]);
    const field = inspect(ctx(panel))?.fields.find((f) => f.key === 'ref');
    expect(field).toMatchObject({ value: '', placeholder: 'QF2' });
    const edited = applyEdit(ctx(panel), 'ref', 'QF2');
    expect(edited.ok && edited.project.panel.placements[0]?.ref).toBe('QF2');
    const refused = applyEdit(ctx(panel), 'ref', 'QF 2');
    expect(!refused.ok && refused.message).toContain('designation');
  });
});

describe('one designation on two devices', () => {
  it('is advice that names them and marks the placed ones, the shelf included in the count', () => {
    const shelved = takeOff(panelOf([withRef({ ...place('p1', 'mcb1', 0, 0), label: 'Kitchen' }, 'QF3'), withRef(place('p2', 'mcb1', 0, 1), 'QF3'), withRef(place('p3', 'mcb1', 0, 2), 'QF4')]), 'p2');
    if (!shelved.ok) throw new Error('take off');
    expect(findRefFindings(shelved.panel, resolve)).toEqual([
      { message: 'Designation QF3 is given to Kitchen [p1], MCB 1P [p2]', severity: 'advice', wires: [], nodes: [], placements: ['p1'] },
    ]);
  });

  it('is reported when the project is checked', () => {
    const panel = panelOf([withRef(place('p1', 'mcb1', 0, 0), 'QF1'), withRef(place('p2', 'mcb1', 0, 1), 'QF1')]);
    expect(projectWarnings({ panel, schematic: emptySchematic() }, resolve)).toContain('Designation QF1 is given to MCB 1P [p1], MCB 1P [p2]');
  });

  it('is not reported for designations that differ', () => {
    expect(findRefFindings(panelOf([withRef(place('p1', 'mcb1', 0, 0), 'QF1'), withRef(place('p2', 'mcb1', 0, 1), 'QF2')]), resolve)).toEqual([]);
  });
});

describe('designations in the lists', () => {
  it('fill their own column of the parts list in natural order', () => {
    const panel = panelOf([withRef(place('p1', 'mcb1', 0, 0), 'QF10'), place('p2', 'mcb1', 0, 1), withRef(place('p3', 'mcb1', 0, 2), 'QF2')]);
    const [row] = buildBom(panel, resolve);
    expect(row?.refs).toEqual(['QF2', 'QF10']);
    expect(bomToCsv([row!]).split('\r\n')[1]).toContain(',3,QF2; QF10,,');
  });

  it('come first in the name of a wire end', () => {
    const panel = panelOf([withRef({ ...place('p1', 'mcb1', 0, 0), label: 'Kitchen' }, 'QF1'), place('p2', 'mcb1', 0, 1)]);
    let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    const wired = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n1', terminal: 'bottom:L' }, { node: 'n2', terminal: 'top:L' });
    if (!wired.ok) throw new Error(wired.error.kind);
    schematic = wired.schematic;
    const [wire] = wireList({ panel, schematic }, resolve);
    expect(wire).toMatchObject({ from: 'QF1 Kitchen L (bottom)', to: 'mcb1 L (top)' });
  });

  it('name a device by its designation and name, or by its name alone', () => {
    expect(designated({ ref: 'QF1' }, 'Kitchen')).toBe('QF1 Kitchen');
    expect(designated({}, 'Kitchen')).toBe('Kitchen');
  });
});

describe('numbering a panel loaded with a module on a rail that is gone', () => {
  it('does not throw, and numbers it ahead of the plates', () => {
    const panel = { ...panelOf([place('p1', 'mcb1', 5, 0), place('p2', 'mcb1', 0, 0)]) };
    expect(refs(numberDevices(panel, resolve).panel)).toEqual({ p1: 'QF1', p2: 'QF2' });
  });
});

describe('a designation code of the module', () => {
  it('starts the designation in place of the code of the kind, and makes a device of a module whose kind has none', () => {
    const lamp = { ...defs.nbar!, id: 'lamp', kind: 'other' as const, refCode: 'HL' };
    const look = (r: { moduleId: string }) => (r.moduleId === 'lamp' ? lamp : resolve(r as never));
    const panel = panelOf([place('p1', 'lamp', 0, 0), place('p2', 'lamp', 0, 1), place('p3', 'mcb1', 0, 2)]);
    expect(refs(numberDevices(panel, look as never).panel)).toEqual({ p1: 'HL1', p2: 'HL2', p3: 'QF1' });
    expect(isDevice(lamp)).toBe(true);
    expect(isDevice({ ...lamp, refCode: undefined, kind: 'busbar' })).toBe(false);
  });

  it('is refused in a library when it is not 1 to 4 capital letters', () => {
    const errors: { path: string; message: string }[] = [];
    validateObject({ ...defs.mcb1, refCode: 'hl' }, MODULE_SPEC, 'module', errors);
    expect(errors.map((e) => e.path)).toEqual(['module.refCode']);
  });
});
