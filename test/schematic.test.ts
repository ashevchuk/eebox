import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Panel } from '../src/layout/placement';
import {
  addNode,
  connect,
  connectAll,
  emptySchematic,
  findProblems,
  moveNode,
  removeNode,
  removeWire,
  renameNode,
  setNodeConductors,
  syncModuleNodes,
  type Schematic,
  type SchematicError,
  type SchematicResult,
  type TerminalRef,
} from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const unwrap = (result: SchematicResult): Schematic => {
  if (!result.ok) throw new Error(`unexpected failure: ${result.error.kind}`);
  return result.schematic;
};
const errorOf = (result: { ok: boolean; error?: SchematicError }): SchematicError => {
  if (result.ok || !result.error) throw new Error('expected a failure');
  return result.error;
};

const at = { x: 0, y: 0 };
const ref = (node: string, terminal: string): TerminalRef => ({ node, terminal });

/** A project with a 3-phase source above the given modules, each module with its node. */
function project(...modules: Array<[string, string]>) {
  const panel: Panel = panelOf(modules.map(([id, moduleId], i) => place(id, moduleId, 0, i * 4)));
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: -200, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Ld', x: 0, y: 600, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  return { panel, schematic, terminalsOf: nodeTerminalsLookup(panel, resolve) };
}
const sourceId = (s: Schematic) => s.nodes.find((n) => n.kind === 'source')!.id;
const loadId = (s: Schematic) => s.nodes.find((n) => n.kind === 'load')!.id;
const moduleNodeId = (s: Schematic, placementId: string) => s.nodes.find((n) => n.placementId === placementId)!.id;

describe('nodes', () => {
  it('assigns increasing ids that are not reused after removal', () => {
    let s = addNode(emptySchematic(), { kind: 'load', label: 'a', ...at }).schematic;
    s = addNode(s, { kind: 'load', label: 'b', ...at }).schematic;
    s = unwrap(removeNode(s, 'n1'));
    expect(addNode(s, { kind: 'load', label: 'c', ...at }).node.id).toBe('n3');
  });

  it('moves and renames a node, and rejects unknown ids', () => {
    const s = addNode(emptySchematic(), { kind: 'load', label: 'a', ...at }).schematic;
    expect(unwrap(moveNode(s, 'n1', 5, 7)).nodes[0]).toMatchObject({ x: 5, y: 7 });
    expect(unwrap(renameNode(s, 'n1', 'Kitchen')).nodes[0]?.label).toBe('Kitchen');
    expect(errorOf(moveNode(s, 'zzz', 0, 0))).toEqual({ kind: 'unknown-node' });
  });

  it('removes a node together with every wire touching it', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb1']);
    const wired = unwrap(connect(schematic, terminalsOf, ref(sourceId(schematic), 'bottom:L1'), ref(moduleNodeId(schematic, 'p1'), 'top:L')));
    expect(wired.wires).toHaveLength(1);
    expect(unwrap(removeNode(wired, moduleNodeId(wired, 'p1'))).wires).toEqual([]);
  });
});

describe('connect', () => {
  it('wires a source terminal to a breaker pole', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const s = unwrap(connect(schematic, terminalsOf, ref(sourceId(schematic), 'bottom:L2'), ref('n1', 'top:L2')));
    expect(s.wires).toEqual([{ id: 'w1', a: ref(sourceId(schematic), 'bottom:L2'), b: ref('n1', 'top:L2') }]);
  });

  it('allows phase to phase, even between different fixed phases', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    expect(connect(schematic, terminalsOf, ref(sourceId(schematic), 'bottom:L1'), ref('n1', 'top:L3')).ok).toBe(true);
  });

  it('rejects joining different families', () => {
    const { schematic, terminalsOf } = project(['p1', 'rcd4']);
    const source = sourceId(schematic);
    expect(errorOf(connect(schematic, terminalsOf, ref(source, 'bottom:L1'), ref('n1', 'top:N')))).toEqual({ kind: 'incompatible-conductors' });
    expect(errorOf(connect(schematic, terminalsOf, ref(source, 'bottom:N'), ref('n1', 'top:L1')))).toEqual({ kind: 'incompatible-conductors' });
    expect(errorOf(connect(schematic, terminalsOf, ref(source, 'bottom:PE'), ref('n1', 'top:N')))).toEqual({ kind: 'incompatible-conductors' });
  });

  it('rejects unknown nodes and terminals, and a terminal wired to itself', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const source = sourceId(schematic);
    expect(errorOf(connect(schematic, terminalsOf, ref(source, 'bottom:L1'), ref('zzz', 'top:L1')))).toEqual({ kind: 'unknown-node' });
    expect(errorOf(connect(schematic, terminalsOf, ref(source, 'bottom:L1'), ref('n1', 'top:Q')))).toEqual({ kind: 'unknown-terminal' });
    expect(errorOf(connect(schematic, terminalsOf, ref(source, 'top:L1'), ref('n1', 'top:L1')))).toEqual({ kind: 'unknown-terminal' });
    expect(errorOf(connect(schematic, terminalsOf, ref('n1', 'top:L1'), ref('n1', 'top:L1')))).toEqual({ kind: 'same-terminal' });
  });

  it('rejects a duplicate wire in either direction', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const source = sourceId(schematic);
    const s = unwrap(connect(schematic, terminalsOf, ref(source, 'bottom:L1'), ref('n1', 'top:L1')));
    expect(errorOf(connect(s, terminalsOf, ref(source, 'bottom:L1'), ref('n1', 'top:L1')))).toEqual({ kind: 'duplicate-wire' });
    expect(errorOf(connect(s, terminalsOf, ref('n1', 'top:L1'), ref(source, 'bottom:L1')))).toEqual({ kind: 'duplicate-wire' });
  });

  it('lets several wires share one terminal', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3'], ['p2', 'mcb3']);
    const source = sourceId(schematic);
    let s = unwrap(connect(schematic, terminalsOf, ref(source, 'bottom:L1'), ref('n1', 'top:L1')));
    s = unwrap(connect(s, terminalsOf, ref(source, 'bottom:L1'), ref('n2', 'top:L1')));
    expect(s.wires).toHaveLength(2);
  });

  it('removes a wire and rejects an unknown wire id', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const s = unwrap(connect(schematic, terminalsOf, ref(sourceId(schematic), 'bottom:L1'), ref('n1', 'top:L1')));
    expect(unwrap(removeWire(s, 'w1')).wires).toEqual([]);
    expect(errorOf(removeWire(s, 'zzz'))).toEqual({ kind: 'unknown-wire' });
  });
});

describe('connectAll', () => {
  const pairs = (s: Schematic) => s.wires.map((w) => `${w.a.terminal}>${w.b.terminal}`);

  it('wires every pole of a 3-pole breaker to the 3-phase source above it', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const result = connectAll(schematic, terminalsOf, sourceId(schematic), moduleNodeId(schematic, 'p1'));
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.added).toBe(3);
    expect(pairs(result.schematic)).toEqual(['bottom:L1>top:L1', 'bottom:L2>top:L2', 'bottom:L3>top:L3']);
  });

  it('includes the neutral for a 4-pole device and leaves PE unmatched', () => {
    const { schematic, terminalsOf } = project(['p1', 'rcd4']);
    const result = connectAll(schematic, terminalsOf, sourceId(schematic), moduleNodeId(schematic, 'p1'));
    if (!result.ok) throw new Error(result.error.kind);
    expect(pairs(result.schematic)).toEqual(['bottom:L1>top:L1', 'bottom:L2>top:L2', 'bottom:L3>top:L3', 'bottom:N>top:N']);
  });

  it('feeds a single-pole breaker from the first phase, and an L+N device from phase and neutral', () => {
    const one = project(['p1', 'mcb1']);
    const a = connectAll(one.schematic, one.terminalsOf, sourceId(one.schematic), moduleNodeId(one.schematic, 'p1'));
    if (!a.ok) throw new Error(a.error.kind);
    expect(pairs(a.schematic)).toEqual(['bottom:L1>top:L']);

    const two = project(['p1', 'rcbo']);
    const b = connectAll(two.schematic, two.terminalsOf, sourceId(two.schematic), moduleNodeId(two.schematic, 'p1'));
    if (!b.ok) throw new Error(b.error.kind);
    expect(pairs(b.schematic)).toEqual(['bottom:L1>top:L', 'bottom:N>top:N']);
  });

  it('wires a breaker onwards to a load below, using the bottom of the breaker', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const result = connectAll(schematic, terminalsOf, moduleNodeId(schematic, 'p1'), loadId(schematic));
    if (!result.ok) throw new Error(result.error.kind);
    expect(pairs(result.schematic)).toEqual(['bottom:L1>top:L1', 'bottom:L2>top:L2', 'bottom:L3>top:L3']);
  });

  it('gives the same wires when dragged from the lower node to the upper one', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const result = connectAll(schematic, terminalsOf, moduleNodeId(schematic, 'p1'), sourceId(schematic));
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.added).toBe(3);
    expect(result.schematic.wires.every((w) => w.a.terminal.startsWith('top:') && w.b.terminal.startsWith('bottom:'))).toBe(true);
  });

  it('falls back to the other side when the facing side has no terminals', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const result = connectAll(schematic, terminalsOf, loadId(schematic), moduleNodeId(schematic, 'p1'));
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.added).toBe(3);
  });

  it('keeps existing wires and adds only the missing ones', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const source = sourceId(schematic);
    const first = unwrap(connect(schematic, terminalsOf, ref(source, 'bottom:L2'), ref('n1', 'top:L2')));
    const result = connectAll(first, terminalsOf, source, 'n1');
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.added).toBe(2);
    expect(result.schematic.wires).toHaveLength(3);
  });

  it('reports nothing to connect when everything is wired or nothing matches', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const once = connectAll(schematic, terminalsOf, sourceId(schematic), 'n1');
    if (!once.ok) throw new Error(once.error.kind);
    expect(errorOf(connectAll(once.schematic, terminalsOf, sourceId(once.schematic), 'n1'))).toEqual({ kind: 'nothing-to-connect' });
    const second = addNode(schematic, { kind: 'source', label: 'S2', x: 0, y: 0, conductors: ['L1', 'N'] });
    expect(errorOf(connectAll(second.schematic, terminalsOf, sourceId(schematic), second.node.id))).toEqual({ kind: 'nothing-to-connect' });
  });

  it('rejects unknown nodes and a node wired to itself', () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    expect(errorOf(connectAll(schematic, terminalsOf, 'zzz', 'n1'))).toEqual({ kind: 'unknown-node' });
    expect(errorOf(connectAll(schematic, terminalsOf, 'n1', 'n1'))).toEqual({ kind: 'same-terminal' });
  });
});

describe('syncModuleNodes', () => {
  const labelOf = (r: { moduleId: string }) => r.moduleId;

  it('creates one unwired node per placement, ordered by rail and slot', () => {
    const p = panelOf([place('p2', 'mcb1', 0, 4), place('p1', 'mcb1', 0, 0), place('p3', 'mcb1', 1, 2)]);
    const s = syncModuleNodes(emptySchematic(), p, labelOf);
    expect(s.wires).toEqual([]);
    expect(s.nodes.map((n) => [n.placementId, n.x, n.y])).toEqual([
      ['p1', 0, 130],
      ['p2', 200, 130],
      ['p3', 0, 260],
    ]);
    expect(s.nodes.every((n) => n.kind === 'module')).toBe(true);
  });

  it('is idempotent and only adds nodes for new placements', () => {
    const first = syncModuleNodes(emptySchematic(), panelOf([place('p1', 'mcb1', 0, 0)]), labelOf);
    expect(syncModuleNodes(first, panelOf([place('p1', 'mcb1', 0, 0)]), labelOf)).toEqual(first);
    const second = syncModuleNodes(first, panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 2)]), labelOf);
    expect(second.nodes.map((n) => n.placementId)).toEqual(['p1', 'p2']);
  });

  it('keeps hand-edited positions and wires of existing nodes', () => {
    let s = syncModuleNodes(emptySchematic(), panelOf([place('p1', 'mcb1', 0, 0)]), labelOf);
    s = unwrap(moveNode(s, 'n1', 999, 888));
    const again = syncModuleNodes(s, panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 2)]), labelOf);
    expect(again.nodes[0]).toMatchObject({ x: 999, y: 888 });
  });
});

describe('findProblems', () => {
  it('reports nothing for a consistent project', () => {
    const { schematic, panel, terminalsOf } = project(['p1', 'mcb3']);
    const wired = connectAll(schematic, terminalsOf, sourceId(schematic), 'n1');
    if (!wired.ok) throw new Error(wired.error.kind);
    expect(findProblems(wired.schematic, panel, terminalsOf)).toEqual([]);
  });

  it('flags a module node whose placement was removed, and keeps the node', () => {
    const { schematic } = project(['p1', 'mcb3']);
    const empty = panelOf([]);
    const problems = findProblems(schematic, empty, nodeTerminalsLookup(empty, resolve));
    expect(problems).toEqual([{ kind: 'orphan-module', nodeId: 'n1' }]);
    expect(schematic.nodes).toHaveLength(3);
  });

  it('flags wires that reference a missing node or a missing terminal', () => {
    const { schematic, panel, terminalsOf } = project(['p1', 'mcb3']);
    const broken: Schematic = {
      ...schematic,
      wires: [
        { id: 'w1', a: ref(sourceId(schematic), 'bottom:L1'), b: ref('n9', 'top:L1') },
        { id: 'w2', a: ref(sourceId(schematic), 'bottom:L1'), b: ref('n1', 'top:Q') },
      ],
    };
    expect(findProblems(broken, panel, terminalsOf)).toEqual([
      { kind: 'dangling-wire', wireId: 'w1' },
      { kind: 'dangling-wire', wireId: 'w2' },
    ]);
  });
});

describe('setNodeConductors', () => {
  const source = () => {
    const { schematic, terminalsOf } = project(['p1', 'mcb3']);
    const id = sourceId(schematic);
    return { schematic, terminalsOf, id };
  };
  const ok = (r: ReturnType<typeof setNodeConductors>) => {
    if (!r.ok) throw new Error(r.error.kind);
    return r;
  };

  it('replaces the conductors, keeping them in the standard order', () => {
    const { schematic, id } = source();
    const result = ok(setNodeConductors(schematic, id, ['PE', 'N', 'L1']));
    expect(result.schematic.nodes.find((n) => n.id === id)?.conductors).toEqual(['L1', 'N', 'PE']);
    expect(result.droppedWires).toBe(0);
  });

  it('removes wires on terminals that disappear, and reports how many', () => {
    const { schematic, terminalsOf, id } = source();
    const wired = connectAll(schematic, terminalsOf, id, 'n1');
    if (!wired.ok) throw new Error(wired.error.kind);
    expect(wired.schematic.wires).toHaveLength(3);
    const result = ok(setNodeConductors(wired.schematic, id, ['L1', 'N', 'PE']));
    expect(result.droppedWires).toBe(2);
    expect(result.schematic.wires.map((w) => w.a.terminal)).toEqual(['bottom:L1']);
  });

  it('keeps wires of other nodes and wires on kept terminals', () => {
    const { schematic, terminalsOf, id } = source();
    const wired = connectAll(schematic, terminalsOf, id, 'n1');
    if (!wired.ok) throw new Error(wired.error.kind);
    expect(ok(setNodeConductors(wired.schematic, id, ['L1', 'L2', 'L3', 'N'])).droppedWires).toBe(0);
  });

  it('refuses a module node, unknown nodes and bad conductor lists', () => {
    const { schematic, id } = source();
    expect(setNodeConductors(schematic, 'n1', ['L'])).toEqual({ ok: false, error: { kind: 'not-a-free-node' } });
    expect(setNodeConductors(schematic, 'zzz', ['L'])).toEqual({ ok: false, error: { kind: 'unknown-node' } });
    expect(setNodeConductors(schematic, id, [])).toEqual({ ok: false, error: { kind: 'invalid-conductors' } });
    expect(setNodeConductors(schematic, id, ['L', 'L'])).toEqual({ ok: false, error: { kind: 'invalid-conductors' } });
    expect(setNodeConductors(schematic, id, ['Q' as 'L'])).toEqual({ ok: false, error: { kind: 'invalid-conductors' } });
  });
});
