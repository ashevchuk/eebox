import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { deletePlacement } from '../src/project/delete';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, removeOrphanNodes, removeUnwiredNodeOf, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

/** Two modules with nodes n1 and n2, a source n3, and a wire from the source to n1 when `wired`. */
function project(wired: boolean): Project {
  const panel = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)]);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  if (wired) {
    const result = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n3', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  }
  return { panel, schematic };
}

const nodeIds = (p: Project) => p.schematic.nodes.map((n) => n.id);

describe('deletePlacement', () => {
  it('takes the node of a module that has no wires along with it', () => {
    const next = deletePlacement(project(true), 'p2')!;
    expect(next.panel.placements.map((p) => p.id)).toEqual(['p1']);
    expect(nodeIds(next)).toEqual(['n1', 'n3']);
  });

  it('keeps the node of a module that has wires, so it shows up as an orphan', () => {
    const next = deletePlacement(project(true), 'p1')!;
    expect(next.panel.placements.map((p) => p.id)).toEqual(['p2']);
    expect(nodeIds(next)).toEqual(['n1', 'n2', 'n3']);
    expect(next.schematic.wires).toHaveLength(1);
  });

  it('does nothing for a module that is not on the panel', () => {
    expect(deletePlacement(project(false), 'p9')).toBeNull();
  });
});

describe('removeUnwiredNodeOf', () => {
  it('leaves other nodes, sources and the same schematic object alone when there is nothing to remove', () => {
    const { schematic } = project(true);
    expect(removeUnwiredNodeOf(schematic, 'p9')).toBe(schematic);
    expect(removeUnwiredNodeOf(schematic, 'p1')).toBe(schematic);
  });
});

describe('removeOrphanNodes', () => {
  it('removes orphaned nodes without wires and counts the ones with wires that stay', () => {
    const { panel, schematic } = project(true);
    const gone = { ...panel, placements: [] };
    const result = removeOrphanNodes(schematic, gone);
    expect(result.schematic.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(result.removed).toBe(1);
    expect(result.keptWired).toBe(1);
    expect(result.schematic.wires).toHaveLength(1);
  });

  it('keeps the nodes of modules that wait on the shelf', () => {
    const { panel, schematic } = project(false);
    const shelved = { ...panel, placements: [], shelf: panel.placements.map(({ rail: _r, slot: _s, ...item }) => item) };
    const result = removeOrphanNodes(schematic, shelved);
    expect(result.removed).toBe(0);
    expect(result.schematic).toBe(schematic);
  });

  it('has nothing to do when every module is on the panel', () => {
    const { panel, schematic } = project(false);
    expect(removeOrphanNodes(schematic, panel)).toEqual({ schematic, removed: 0, keptWired: 0 });
  });
});
