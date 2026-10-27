import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { chainNodes, feedFrom } from '../src/schematic/autowire';
import { addNode, emptySchematic, moveNode, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

function setup(): { schematic: Schematic; terminalsOf: ReturnType<typeof nodeTerminalsLookup>; ids: Record<string, string> } {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 2), place('p3', 'breaker16', 0, 4)]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const ids: Record<string, string> = {};
  for (const node of schematic.nodes) ids[node.placementId!] = node.id;
  const move = (id: string, y: number) => {
    const moved = moveNode(schematic, id, 0, y);
    if (!moved.ok) throw new Error('move');
    schematic = moved.schematic;
  };
  move(ids.p1!, 0);
  move(ids.p2!, 200);
  move(ids.p3!, 400);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -200, conductors: ['L', 'N'] }).schematic;
  ids.source = schematic.nodes.at(-1)!.id;
  return { schematic, terminalsOf: nodeTerminalsLookup(panel, resolve), ids };
}

describe('chaining nodes', () => {
  it('wires each node to the next one below it, whatever order they were chosen in', () => {
    const { schematic, terminalsOf, ids } = setup();
    const result = chainNodes(schematic, terminalsOf, [ids.p3!, ids.p1!, ids.p2!]);
    expect(result.added).toBe(2);
    const pairs = result.schematic.wires.map((w) => [w.a.node, w.b.node].sort().join('-'));
    expect(pairs).toContain([ids.p1!, ids.p2!].sort().join('-'));
    expect(pairs).toContain([ids.p2!, ids.p3!].sort().join('-'));
    expect(pairs).not.toContain([ids.p1!, ids.p3!].sort().join('-'));
  });

  it('joins the outputs of the upper one to the inputs of the lower one', () => {
    const { schematic, terminalsOf, ids } = setup();
    const wire = chainNodes(schematic, terminalsOf, [ids.p1!, ids.p2!]).schematic.wires[0]!;
    expect(wire.a).toEqual({ node: ids.p1, terminal: 'bottom:L' });
    expect(wire.b).toEqual({ node: ids.p2, terminal: 'top:L' });
  });

  it('does nothing for fewer than two nodes', () => {
    const { schematic, terminalsOf, ids } = setup();
    expect(chainNodes(schematic, terminalsOf, [ids.p1!])).toMatchObject({ added: 0, skipped: [] });
    expect(chainNodes(schematic, terminalsOf, []).schematic).toBe(schematic);
  });

  it('does not wire a pair again that is wired already, and says which node got nothing', () => {
    const { schematic, terminalsOf, ids } = setup();
    const once = chainNodes(schematic, terminalsOf, [ids.p1!, ids.p2!]);
    const twice = chainNodes(once.schematic, terminalsOf, [ids.p1!, ids.p2!]);
    expect(twice.added).toBe(0);
    expect(twice.skipped).toEqual([{ node: ids.p2, reason: 'nothing-to-join' }]);
    expect(twice.schematic.wires).toHaveLength(once.schematic.wires.length);
  });
});

describe('feeding nodes from one', () => {
  it('wires the supplier to each of the others', () => {
    const { schematic, terminalsOf, ids } = setup();
    const result = feedFrom(schematic, terminalsOf, ids.source!, [ids.p1!, ids.p2!, ids.p3!]);
    expect(result.added).toBe(3);
    const ends = result.schematic.wires.map((w) => w.b.node).sort();
    expect(ends).toEqual([ids.p1!, ids.p2!, ids.p3!].sort());
    expect(result.skipped).toEqual([]);
  });

  it('leaves the supplier out of its own list and reports a node it cannot reach', () => {
    const { schematic, terminalsOf, ids } = setup();
    const result = feedFrom(schematic, terminalsOf, ids.source!, [ids.source!, ids.p1!, 'nope']);
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([{ node: 'nope', reason: 'unknown' }]);
  });

  it('feeds a node that stands above the supplier from the supplier\'s top, as dragging would', () => {
    const { schematic, terminalsOf, ids } = setup();
    const result = feedFrom(schematic, terminalsOf, ids.p3!, [ids.p1!]);
    expect(result.schematic.wires[0]).toMatchObject({ a: { node: ids.p3, terminal: 'top:L' }, b: { node: ids.p1, terminal: 'bottom:L' } });
  });
});
