import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { moduleKey } from '../src/project/file';
import { planModuleSwap } from '../src/project/sync';
import { addNode, connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { defs, panelOf, place, ref, resolve } from './fixtures';

const designed: ModuleDef = { id: 'designed', kind: 'breaker', name: 'Designed', widthUnits: 1, poles: 1, terminals: [{ name: 'L', conductor: 'L', side: 'top' }], art: [{ kind: 'rect', x: 1, y: 1, width: 2, height: 2, fill: '#000000' }] };
const designedRef = { libraryId: 'mine', moduleId: 'designed' };
const resolveAll = (r: { libraryId: string; moduleId: string }) => (r.libraryId === 'mine' ? designed : resolve(r));

function scene(): Project {
  const panel = panelOf([place('p1', 'mcb1', 0, 0)]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Lamp', x: 0, y: 200, conductors: ['L'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  for (const [a, b] of [
    [{ node: 'n2', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' }],
    [{ node: 'n1', terminal: 'bottom:L' }, { node: 'n3', terminal: 'top:L' }],
  ] as const) {
    const joined = connect(schematic, terminalsOf, a, b);
    if (!joined.ok) throw new Error(joined.error.kind);
    schematic = joined.schematic;
  }
  return { panel, schematic };
}

describe('making a placed module use another definition', () => {
  it('gives the placement the new module and keeps the wires that still have their terminals', () => {
    const project = scene();
    const plan = planModuleSwap(project, {}, 'p1', designedRef, designed, resolveAll);
    expect(plan.project.panel.placements[0]!.module).toEqual(designedRef);
    expect(plan.snapshot[moduleKey(designedRef)]).toBe(designed);
    expect(plan.droppedWires).toBe(1);
    expect(plan.project.schematic.wires).toHaveLength(1);
    expect(plan.project.schematic.wires[0]!.a).toEqual({ node: 'n2', terminal: 'bottom:L' });
    expect(plan.project.schematic.nodes).toHaveLength(project.schematic.nodes.length);
  });

  it('drops nothing when the new definition has every terminal the old one had', () => {
    const same: ModuleDef = { ...designed, terminals: undefined };
    const plan = planModuleSwap(scene(), {}, 'p1', designedRef, same, (r) => (r.libraryId === 'mine' ? same : resolve(r)));
    expect(plan.droppedWires).toBe(0);
    expect(plan.project.schematic.wires).toHaveLength(2);
  });

  it('brings the width of a placed copy into what the new definition allows', () => {
    const panel = panelOf([{ ...place('p1', 'relay', 0, 0), widthUnits: 3 }]);
    const fixed: ModuleDef = { ...designed, terminals: undefined, widthUnits: 2 };
    const plan = planModuleSwap({ panel, schematic: syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId) }, {}, 'p1', designedRef, fixed, resolve);
    expect(plan.project.panel.placements[0]!.widthUnits).toBeUndefined();
  });

  it('changes nothing for a placement that does not exist', () => {
    const project = scene();
    const plan = planModuleSwap(project, {}, 'p9', designedRef, designed, resolveAll);
    expect(plan.project).toBe(project);
    expect(plan.changed).toEqual([]);
  });

  it('names what is different and does not touch the other placements', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 3)]);
    const project = { panel, schematic: syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId) };
    const plan = planModuleSwap(project, {}, 'p1', designedRef, designed, resolveAll);
    expect(plan.project.panel.placements.map((p) => p.module)).toEqual([designedRef, ref('mcb1')]);
    expect(plan.changed[0]).toMatchObject({ key: 'mine/designed', name: 'Designed' });
    expect(plan.changed[0]!.fields).toContain('art');
    expect(defs.mcb1?.art).toBeUndefined();
  });
});
