import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { moduleDifferences, planModuleUpdate } from '../src/project/sync';
import { addNode, connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { combAt, defs, panelOf, place, resolve } from './fixtures';

type Snapshot = Record<string, ModuleDef>;
const NBAR = defs.nbar!;
const snapshotOf = (...keys: string[]): Snapshot => Object.fromEntries(keys.map((k) => [`lib/${k}`, defs[k]!]));
const library = (overrides: Record<string, ModuleDef | undefined>) => (ref: ModuleRef) =>
  ref.moduleId in overrides ? overrides[ref.moduleId] : resolve(ref);

function project(options: { barWidth?: number; wire?: boolean; labels?: boolean } = {}): Project {
  const bar = { ...place('p1', 'nbar', 0, 0), ...(options.barWidth ? { widthUnits: options.barWidth } : {}) };
  const withLabels = options.labels
    ? { ...bar, terminalLabels: { 'top:N1': 'Kitchen', 'top:N3': 'Hall' } }
    : bar;
  const panel = panelOf([withLabels, place('p2', 'mcb1', 0, 6)], [], [24]);
  let schematic = syncModuleNodes(emptySchematic(), panel, () => 'x');
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: -100, conductors: ['N'] }).schematic;
  if (options.wire) {
    const result = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n3', terminal: 'bottom:N' }, { node: 'n1', terminal: 'top:N3' });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  }
  return { panel, schematic };
}

const withTerminalCount = (count: number): ModuleDef => ({
  ...NBAR,
  terminals: [
    { name: 'N', conductor: 'N', side: 'top', net: 'N', count },
    { name: 'Nb', conductor: 'N', side: 'bottom', net: 'N', count },
  ],
});

describe('moduleDifferences', () => {
  it('finds nothing when the stored copies equal the libraries', () => {
    expect(moduleDifferences(project(), snapshotOf('nbar', 'mcb1'), resolve)).toEqual({ changed: [], missing: [] });
  });

  it('lists the fields that differ, by name', () => {
    const fresh = { ...NBAR, name: 'N bar v2', widthUnits: 4 };
    const { changed } = moduleDifferences(project(), snapshotOf('nbar'), library({ nbar: fresh }));
    expect(changed).toEqual([{ key: 'lib/nbar', name: 'N bar v2', fields: ['name', 'widthUnits']}]);
  });

  it('ignores the order of fields, nested ones too', () => {
    const reordered = JSON.parse(JSON.stringify({ widthUnits: NBAR.widthUnits, terminals: NBAR.terminals!.map((t) => ({ count: t.count, side: t.side, conductor: t.conductor, name: t.name, net: t.net })), poles: NBAR.poles, name: NBAR.name, kind: NBAR.kind, id: NBAR.id, resizable: { maxUnits: 12, minUnits: 2 } }));
    expect(moduleDifferences(project(), snapshotOf('nbar'), library({ nbar: reordered })).changed).toEqual([]);
  });

  it('reports a module that no library has any more, and leaves it out of the changes', () => {
    expect(moduleDifferences(project(), snapshotOf('nbar'), library({ nbar: undefined }))).toEqual({
      changed: [],
      missing: ['lib/nbar'],
    });
  });

  it('only looks at modules the project uses and has a stored copy of', () => {
    const stale = { ...snapshotOf('nbar', 'mcb3'), 'lib/mcb3': { ...defs.mcb3!, name: 'Old' } };
    expect(moduleDifferences(project(), stale, resolve).changed).toEqual([]);
    expect(moduleDifferences(project(), {}, library({ nbar: { ...NBAR, name: 'New' } })).changed).toEqual([]);
  });

  it('includes combs and shelved modules', () => {
    const base = project();
    const withComb: Project = {
      ...base,
      panel: { ...base.panel, combs: [combAt('c1', 'comb1', 0, 8)], shelf: [{ id: 'p9', module: { libraryId: 'lib', moduleId: 'mcb3' } }] },
    };
    const snapshot = snapshotOf('comb1', 'mcb3');
    const fresh = library({ comb1: { ...defs.comb1!, name: 'C2' }, mcb3: { ...defs.mcb3!, name: 'M2' } });
    expect(moduleDifferences(withComb, snapshot, fresh).changed.map((c) => c.key)).toEqual(['lib/comb1', 'lib/mcb3']);
  });
});

describe('planModuleUpdate', () => {
  it('changes nothing when there is nothing to take over', () => {
    const snapshot = snapshotOf('nbar');
    const base = project();
    const plan = planModuleUpdate(base, snapshot, resolve);
    expect(plan.changed).toEqual([]);
    expect(plan.project).toBe(base);
    expect(plan.snapshot).toBe(snapshot);
    expect(plan.droppedWires).toBe(0);
  });

  it('takes over a new name without touching the project', () => {
    const base = project({ wire: true });
    const plan = planModuleUpdate(base, snapshotOf('nbar'), library({ nbar: { ...NBAR, name: 'N bar v2' } }));
    expect(plan.snapshot['lib/nbar']?.name).toBe('N bar v2');
    expect(plan.project).toEqual(base);
    expect(plan.droppedWires).toBe(0);
    expect(plan.newProblems).toEqual([]);
  });

  it('reports the overlap that a wider module causes, as a new problem', () => {
    const plan = planModuleUpdate(project(), snapshotOf('nbar'), library({ nbar: { ...NBAR, widthUnits: 8, resizable: { minUnits: 2, maxUnits: 12 } } }));
    expect(plan.newProblems).toEqual(['placement p2: overlap with p1']);
  });

  it('drops the wires on terminals that no longer exist, and the labels of those terminals', () => {
    const plan = planModuleUpdate(project({ wire: true, labels: true }), snapshotOf('nbar'), library({ nbar: withTerminalCount(2) }));
    expect(plan.droppedWires).toBe(1);
    expect(plan.project.schematic.wires).toEqual([]);
    expect(plan.project.panel.placements[0]?.terminalLabels).toEqual({ 'top:N1': 'Kitchen' });
  });

  it('keeps wires on terminals that survive', () => {
    const plan = planModuleUpdate(project({ wire: true }), snapshotOf('nbar'), library({ nbar: withTerminalCount(4) }));
    expect(plan.droppedWires).toBe(0);
    expect(plan.project.schematic.wires).toHaveLength(1);
  });

  it('removes an own width when the module can no longer be resized', () => {
    const fixed = { ...NBAR, resizable: undefined };
    const plan = planModuleUpdate(project({ barWidth: 8 }), snapshotOf('nbar'), library({ nbar: fixed }));
    expect('widthUnits' in plan.project.panel.placements[0]!).toBe(false);
  });

  it('pulls an own width back into a narrower allowed range, and drops it when it equals the new width', () => {
    const narrowed = library({ nbar: { ...NBAR, resizable: { minUnits: 2, maxUnits: 6 } } });
    expect(planModuleUpdate(project({ barWidth: 10 }), snapshotOf('nbar'), narrowed).project.panel.placements[0]?.widthUnits).toBe(6);
    const rebased = library({ nbar: { ...NBAR, widthUnits: 10, resizable: { minUnits: 2, maxUnits: 12 } } });
    expect('widthUnits' in planModuleUpdate(project({ barWidth: 10 }), snapshotOf('nbar'), rebased).project.panel.placements[0]!).toBe(false);
  });

  it('applies the same rules to combs and shelved modules', () => {
    const base = project();
    const stored: Project = {
      ...base,
      panel: {
        ...base.panel,
        combs: [{ ...combAt('c1', 'comb1', 0, 8), widthUnits: 12 }],
        shelf: [{ id: 'p9', module: { libraryId: 'lib', moduleId: 'nbar' }, widthUnits: 10 }],
      },
    };
    const fresh = library({
      comb1: { ...defs.comb1!, name: 'C2', resizable: { minUnits: 2, maxUnits: 8 } },
      nbar: { ...NBAR, name: 'N2', resizable: { minUnits: 2, maxUnits: 6 } },
    });
    const plan = planModuleUpdate(stored, snapshotOf('comb1', 'nbar'), fresh);
    expect(plan.project.panel.combs[0]?.widthUnits).toBe(8);
    expect(plan.project.panel.shelf[0]?.widthUnits).toBe(6);
  });

  it('does not report problems the project already had', () => {
    const base = project();
    const crowded: Project = { ...base, panel: { ...base.panel, placements: [base.panel.placements[0]!, { ...base.panel.placements[1]!, slot: 1 }] } };
    const plan = planModuleUpdate(crowded, snapshotOf('nbar'), library({ nbar: { ...NBAR, name: 'N2' } }));
    expect(plan.newProblems).toEqual([]);
  });

  it('keeps a stored copy whose module vanished from the libraries', () => {
    const snapshot = snapshotOf('nbar', 'mcb1');
    const plan = planModuleUpdate(project(), snapshot, library({ nbar: undefined, mcb1: { ...defs.mcb1!, name: 'M2' } }));
    expect(plan.missing).toEqual(['lib/nbar']);
    expect(plan.snapshot['lib/nbar']).toBe(snapshot['lib/nbar']);
    expect(plan.snapshot['lib/mcb1']?.name).toBe('M2');
  });

  it('does not mutate what it was given', () => {
    const base = project({ wire: true, labels: true, barWidth: 8 });
    const snapshot = snapshotOf('nbar');
    const before = [structuredClone(base), structuredClone(snapshot)];
    planModuleUpdate(base, snapshot, library({ nbar: withTerminalCount(1) }));
    expect([base, snapshot]).toEqual(before);
  });
});
