import { describe, expect, it } from 'vitest';
import type { FreePlacement } from '../src/layout/placement';
import type { Project } from '../src/project';
import { emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { contextMenuEntries, type MenuContext, type MenuEntry, type MenuItem } from '../src/ui/contextMenu';
import type { Mode, Selection } from '../src/ui/session';
import { panelOf, place, resolve } from './fixtures';

function build(): Project {
  const base = panelOf([place('r1', 'breaker16', 0, 0), place('r2', 'breaker16', 0, 4)], [], [24]);
  const free: FreePlacement = { id: 'f1', module: { libraryId: 'lib', moduleId: 'breaker16' }, plate: base.plates[0]!.id, x: 10, y: 200 };
  const panel = { ...base, placements: [...base.placements, free], ducts: [{ id: 'd1', plate: base.plates[0]!.id, x: 0, y: 300, widthMm: 200, heightMm: 40 }] };
  return { panel, schematic: syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId) };
}

const menu = (selection: Selection, mode: Mode = 'panel', extra: Partial<MenuContext> = {}): MenuEntry[] =>
  contextMenuEntries({ project: build(), selection, mode, resolve, snapshot: {}, fromLibraries: resolve, canUndo: true, canRedo: false, hasClipboard: false, ...extra });
const keys = (entries: MenuEntry[]) => entries.map((e) => (e === 'separator' ? '-' : e.key));
const item = (entries: MenuEntry[], key: string): MenuItem | undefined => entries.find((e): e is MenuItem => e !== 'separator' && e.key === key);

describe('the context menu on the panel', () => {
  it('offers a module on a rail to be taken off, copied, duplicated and deleted, with Undo and Redo last', () => {
    const entries = menu({ placementId: 'r1' });
    expect(keys(entries)).toEqual(expect.arrayContaining(['action:takeOff', 'copy', 'duplicate', 'delete', 'undo', 'redo']));
    expect(keys(entries).at(-2)).toBe('undo');
    expect(keys(entries).indexOf('action:takeOff')).toBeLessThan(keys(entries).indexOf('copy'));
  });

  it('does not say Delete twice for a duct, and shows what the keys do', () => {
    const entries = menu({ ductId: 'd1' });
    expect(keys(entries)).not.toContain('action:removeDuct');
    expect(item(entries, 'delete')).toMatchObject({ shortcut: 'Del' });
    expect(item(entries, 'copy')).toMatchObject({ shortcut: 'Ctrl+C' });
  });

  it('offers a group the same commands, and alignment when devices on the plate are among them', () => {
    const entries = menu({ placementIds: ['f1', 'r1'], combIds: [] });
    expect(keys(entries)).toEqual(expect.arrayContaining(['copy', 'duplicate', 'delete']));
    expect(keys(menu({ placementIds: ['f1'], combIds: [], ductIds: ['d1'] }))).toContain('action:align:left');
    expect(keys(menu({ placementIds: ['r1', 'r2'], combIds: [] }))).not.toContain('action:align:left');
  });

  it('offers a row to be duplicated', () => {
    expect(keys(menu({ rail: 0 }))).toEqual(['duplicate-row', '-', 'undo', 'redo']);
  });

  it('offers empty space paste only when something was copied', () => {
    expect(item(menu({}), 'paste')).toMatchObject({ disabled: true });
    expect(item(menu({}, 'panel', { hasClipboard: true }), 'paste')?.disabled).toBeUndefined();
    expect(keys(menu({}))).toEqual(expect.arrayContaining(['select-all', 'button:fit']));
  });

  it('disables Undo and Redo that cannot be done', () => {
    const entries = menu({}, 'panel', { canUndo: false, canRedo: true });
    expect(item(entries, 'undo')).toMatchObject({ disabled: true });
    expect(item(entries, 'redo')?.disabled).toBeUndefined();
  });
});

describe('the context menu on the schematic', () => {
  it('offers a node to be deleted, and nodes chosen together to be chained and aligned', () => {
    expect(keys(menu({ nodeId: 'n1' }, 'schematic'))).toContain('delete');
    expect(keys(menu({ nodeId: 'n1' }, 'schematic'))).not.toContain('button:chain-selected');
    expect(keys(menu({ nodeIds: ['n1', 'n2'] }, 'schematic'))).toEqual(expect.arrayContaining(['button:chain-selected', 'button:align-left', 'delete']));
  });

  it('offers empty space the commands of the Nodes menu that need no selection', () => {
    expect(keys(menu({}, 'schematic'))).toEqual(expect.arrayContaining(['select-all', 'button:sync-modules', 'button:number-wires', 'undo']));
  });
});
