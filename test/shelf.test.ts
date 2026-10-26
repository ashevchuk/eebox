import { describe, expect, it } from 'vitest';
import { setPanelTitle } from '../src/layout/panel';
import {
  addPlacement,
  nextPlacementId,
  setPlacementWidth,
  setTerminalLabel,
  type Panel,
  type PlacementResult,
} from '../src/layout/placement';
import { discardFromShelf, placeFromShelf, takeOff, type ShelfResult } from '../src/layout/shelf';
import { buildNets } from '../src/electrical/nets';
import { buildBom } from '../src/project/bom';
import { buildProjectFile, parseProjectFile } from '../src/project/file';
import { emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { panelOf, place, resizeOf, resolve, widthOf } from './fixtures';

const unwrap = (r: ShelfResult | PlacementResult): Panel => {
  if (!r.ok) throw new Error(r.error.kind);
  return r.panel;
};
const failure = (r: ShelfResult | PlacementResult) => {
  if (r.ok) throw new Error('expected a failure');
  return r.error.kind;
};

const stocked = () => panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1), place('p3', 'nbar', 0, 4)], [], [12, 12]);

describe('takeOff', () => {
  it('moves a module to the shelf, keeping its id and everything but the place', () => {
    const labelled = unwrap(setTerminalLabel(stocked(), 'p3', 'top:N1', 'Kitchen N'));
    const wide = unwrap(setPlacementWidth(labelled, widthOf, resizeOf, 'p3', 6));
    const off = unwrap(takeOff(wide, 'p3'));
    expect(off.placements.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(off.shelf).toEqual([
      { id: 'p3', module: { libraryId: 'lib', moduleId: 'nbar' }, widthUnits: 6, terminalLabels: { 'top:N1': 'Kitchen N' } },
    ]);
    expect('rail' in off.shelf[0]!).toBe(false);
  });

  it('frees the slots it occupied', () => {
    const off = unwrap(takeOff(stocked(), 'p3'));
    expect(addPlacement(off, widthOf, place('p9', 'mcb1', 0, 4)).ok).toBe(true);
  });

  it('refuses an unknown module and does not mutate its input', () => {
    const panel = stocked();
    expect(failure(takeOff(panel, 'zzz'))).toBe('unknown-placement');
    takeOff(panel, 'p1');
    expect(panel.placements).toHaveLength(3);
    expect(panel.shelf).toEqual([]);
  });
});

describe('placeFromShelf', () => {
  it('puts a shelved module back with its id, label and width', () => {
    const labelled = unwrap(setTerminalLabel(stocked(), 'p3', 'top:N1', 'Kitchen N'));
    const off = unwrap(takeOff(unwrap(setPlacementWidth(labelled, widthOf, resizeOf, 'p3', 6)), 'p3'));
    const back = unwrap(placeFromShelf(off, widthOf, 'p3', 1, 2));
    expect(back.shelf).toEqual([]);
    expect(back.placements.find((p) => p.id === 'p3')).toMatchObject({
      rail: 1, slot: 2, widthUnits: 6, terminalLabels: { 'top:N1': 'Kitchen N' },
    });
  });

  it('restores the original arrangement when put back where it was', () => {
    const panel = stocked();
    const back = unwrap(placeFromShelf(unwrap(takeOff(panel, 'p3')), widthOf, 'p3', 0, 4));
    const byId = (p: Panel) => [...p.placements].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(back)).toEqual(byId(panel));
  });

  it('pushes the modules in the way aside, like a drop from the palette', () => {
    const off = unwrap(takeOff(stocked(), 'p3'));
    const back = unwrap(placeFromShelf(off, widthOf, 'p3', 0, 0));
    expect(back.placements.find((p) => p.id === 'p1')?.slot).toBeGreaterThanOrEqual(3);
  });

  it('keeps the module on the shelf when there is no room, or no such row', () => {
    const tight = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'nbar', 1, 0)], [], [3, 3]);
    const off = unwrap(takeOff(tight, 'p2'));
    const full = unwrap(addPlacement(off, widthOf, place('p4', 'nbar', 1, 0)));
    expect(failure(placeFromShelf(full, widthOf, 'p2', 1, 0))).toBe('overlap');
    expect(full.shelf.map((s) => s.id)).toEqual(['p2']);
    expect(failure(placeFromShelf(off, widthOf, 'p2', 5, 0))).toBe('unknown-rail');
  });

  it('reports an unknown shelf item', () => {
    expect(failure(placeFromShelf(stocked(), widthOf, 'zzz', 0, 0))).toBe('unknown-shelf-item');
  });
});

describe('discardFromShelf and ids', () => {
  it('discards an item for good', () => {
    const off = unwrap(takeOff(stocked(), 'p1'));
    expect(unwrap(discardFromShelf(off, 'p1')).shelf).toEqual([]);
    expect(failure(discardFromShelf(off, 'zzz'))).toBe('unknown-shelf-item');
  });

  it('never reuses the id of a shelved module for a new one', () => {
    const off = unwrap(takeOff(stocked(), 'p3'));
    expect(nextPlacementId(off)).toBe('p4');
    expect(failure(addPlacement(off, widthOf, place('p3', 'mcb1', 0, 9)))).toBe('duplicate-id');
  });
});

describe('what the shelf stays out of', () => {
  it('is not counted in the bill of materials or in the nets', () => {
    const off = unwrap(takeOff(stocked(), 'p3'));
    expect(buildBom(off, resolve).map((r) => r.moduleId)).toEqual(['mcb1']);
    expect(buildNets({ panel: off, schematic: emptySchematic() }, resolve)).toEqual([]);
  });

  it('keeps the schematic node, which comes back to life when the module is put back', () => {
    const schematic = syncModuleNodes(emptySchematic(), stocked(), () => 'x');
    const off = unwrap(takeOff(stocked(), 'p3'));
    const back = unwrap(placeFromShelf(off, widthOf, 'p3', 0, 4));
    expect(buildNets({ panel: back, schematic }, resolve)[0]?.terminals.length).toBe(6);
  });
});

describe('terminal labels and panel title', () => {
  it('labels one terminal and clears it again, dropping the empty map', () => {
    const labelled = unwrap(setTerminalLabel(stocked(), 'p3', 'top:N2', ' Hall '));
    expect(labelled.placements[2]?.terminalLabels).toEqual({ 'top:N2': 'Hall' });
    const two = unwrap(setTerminalLabel(labelled, 'p3', 'top:N3', 'Bath'));
    expect(Object.keys(two.placements[2]!.terminalLabels!)).toEqual(['top:N2', 'top:N3']);
    const cleared = unwrap(setTerminalLabel(unwrap(setTerminalLabel(two, 'p3', 'top:N2', '')), 'p3', 'top:N3', ' '));
    expect('terminalLabels' in cleared.placements[2]!).toBe(false);
  });

  it('refuses a bad label or an unknown module, and does not mutate its input', () => {
    const panel = stocked();
    expect(failure(setTerminalLabel(panel, 'p3', 'top:N1', 'a\nb'))).toBe('invalid-label');
    expect(failure(setTerminalLabel(panel, 'zzz', 'top:N1', 'x'))).toBe('unknown-placement');
    setTerminalLabel(panel, 'p3', 'top:N1', 'x');
    expect('terminalLabels' in panel.placements[2]!).toBe(false);
  });

  it('sets, trims and clears the title of the panel', () => {
    const titled = setPanelTitle(stocked(), '  Flat 12  ');
    expect(titled.ok && titled.panel.title).toBe('Flat 12');
    const cleared = titled.ok ? setPanelTitle(titled.panel, '') : titled;
    expect(cleared.ok && 'title' in cleared.panel).toBe(false);
    expect(setPanelTitle(stocked(), 'x'.repeat(61))).toEqual({ ok: false, error: 'invalid-value' });
  });
});

describe('shelf, title and terminal labels in the project file', () => {
  const project = () => {
    const withLabels = unwrap(setTerminalLabel(stocked(), 'p3', 'top:N1', 'Kitchen N'));
    const titled = setPanelTitle(unwrap(takeOff(withLabels, 'p2')), 'Flat 12');
    if (!titled.ok) throw new Error('title');
    return { panel: titled.panel, schematic: emptySchematic() };
  };

  it('round-trips all three without warnings', () => {
    const file = buildProjectFile(project(), resolve);
    expect(parseProjectFile(JSON.parse(JSON.stringify(file)))).toEqual({ ok: true, file, warnings: [] });
  });

  it('requires the shelf, and rejects a shelf item that has a place or a duplicate id', () => {
    const file = JSON.parse(JSON.stringify(buildProjectFile(project(), resolve)));
    file.project.panel.shelf[0].rail = 0;
    const withPlace = parseProjectFile(file);
    expect(withPlace.ok ? [] : withPlace.errors.map((e) => e.path)).toEqual(['project.panel.shelf[0].rail']);
    file.project.panel.shelf[0] = { id: 'p1', module: file.project.panel.shelf[0].module };
    const duplicate = parseProjectFile(file);
    expect(duplicate.ok ? [] : duplicate.errors.map((e) => e.path)).toEqual(['project.panel.shelf[0].id']);
    delete file.project.panel.shelf;
    const missing = parseProjectFile(file);
    expect(missing.ok ? [] : missing.errors.map((e) => e.path)).toEqual(['project.panel.shelf']);
  });

  it('rejects an invalid title and invalid terminal labels', () => {
    const paths = (mutate: (file: any) => void) => {
      const file = JSON.parse(JSON.stringify(buildProjectFile(project(), resolve)));
      mutate(file);
      const result = parseProjectFile(file);
      return result.ok ? [] : result.errors.map((e) => e.path);
    };
    expect(paths((f) => (f.project.panel.title = ' Flat'))).toEqual(['project.panel.title']);
    expect(paths((f) => (f.project.panel.placements[1].terminalLabels = { 'top:N1': 'a\nb' }))).toEqual([
      'project.panel.placements[1].terminalLabels',
    ]);
    expect(paths((f) => (f.project.panel.placements[1].terminalLabels = {}))).toEqual([
      'project.panel.placements[1].terminalLabels',
    ]);
  });

  it('says that the module of a schematic node is on the shelf', () => {
    const base = project();
    const schematic = syncModuleNodes(emptySchematic(), stocked(), () => 'x');
    const file = buildProjectFile({ panel: base.panel, schematic }, resolve);
    const result = parseProjectFile(JSON.parse(JSON.stringify(file)));
    expect(result.ok && result.warnings).toEqual(['node n2: its module is on the shelf']);
  });
});
