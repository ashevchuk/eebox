import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import type { Panel, Placement } from '../src/layout/placement';
import {
  addNode,
  connect,
  emptySchematic,
  findProblems,
  moveNode,
  removeNode,
  removeWire,
  renameNode,
  syncModuleNodes,
  type Schematic,
  type SchematicError,
  type SchematicResult,
} from '../src/schematic/model';
import {
  distanceToPath,
  freeSpot,
  hitNode,
  hitOutPort,
  hitWire,
  inPort,
  outPort,
  schematicBounds,
  wirePath,
} from '../src/schematic/geometry';

const at = { x: 0, y: 0 };

function build(...kinds: Array<'source' | 'busbar' | 'load' | 'module'>): Schematic {
  return kinds.reduce(
    (s, kind) => addNode(s, { kind, label: kind, ...at }).schematic,
    emptySchematic(),
  );
}

function unwrap(result: SchematicResult): Schematic {
  if (!result.ok) throw new Error(`unexpected failure: ${result.error.kind}`);
  return result.schematic;
}

function errorOf(result: SchematicResult): SchematicError {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

const placement = (id: string, rail: number, slot: number): Placement => ({
  id,
  module: { libraryId: 'lib', moduleId: `m-${id}` },
  rail,
  slot,
});

const panel = (...placements: Placement[]): Panel => ({ ...createPanel([10, 10]), placements });

describe('nodes', () => {
  it('assigns increasing ids that are not reused after removal', () => {
    let s = build('source', 'load');
    s = unwrap(removeNode(s, 'n1'));
    expect(addNode(s, { kind: 'load', label: 'x', ...at }).node.id).toBe('n3');
  });

  it('moves and renames a node, and rejects unknown ids', () => {
    const s = build('load');
    expect(unwrap(moveNode(s, 'n1', 5, 7)).nodes[0]).toMatchObject({ x: 5, y: 7 });
    expect(unwrap(renameNode(s, 'n1', 'Kitchen')).nodes[0]?.label).toBe('Kitchen');
    expect(errorOf(moveNode(s, 'zzz', 0, 0))).toEqual({ kind: 'unknown-node' });
  });

  it('removes a node together with every wire touching it', () => {
    let s = build('source', 'busbar', 'load');
    s = unwrap(connect(s, 'n1', 'n2'));
    s = unwrap(connect(s, 'n2', 'n3'));
    s = unwrap(removeNode(s, 'n2'));
    expect(s.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(s.wires).toEqual([]);
  });
});

describe('connect', () => {
  it('connects supply to consumer and lets a busbar fan out', () => {
    let s = build('source', 'busbar', 'load', 'load');
    s = unwrap(connect(s, 'n1', 'n2'));
    s = unwrap(connect(s, 'n2', 'n3'));
    s = unwrap(connect(s, 'n2', 'n4'));
    expect(s.wires.map((w) => [w.from, w.to])).toEqual([
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n2', 'n4'],
    ]);
  });

  it('rejects unknown nodes, self loops and duplicates', () => {
    const s = unwrap(connect(build('source', 'load'), 'n1', 'n2'));
    expect(errorOf(connect(s, 'n1', 'zzz'))).toEqual({ kind: 'unknown-node' });
    expect(errorOf(connect(s, 'n2', 'n2'))).toEqual({ kind: 'self-loop' });
    expect(errorOf(connect(s, 'n1', 'n2'))).toEqual({ kind: 'duplicate-wire' });
  });

  it('rejects wires into a source and out of a load', () => {
    const s = build('source', 'busbar', 'load');
    expect(errorOf(connect(s, 'n2', 'n1'))).toEqual({ kind: 'invalid-direction' });
    expect(errorOf(connect(s, 'n3', 'n2'))).toEqual({ kind: 'invalid-direction' });
  });

  it('allows the reverse wire between two busbars as a distinct wire', () => {
    let s = build('busbar', 'busbar');
    s = unwrap(connect(s, 'n1', 'n2'));
    expect(connect(s, 'n2', 'n1').ok).toBe(true);
  });

  it('removes a wire and rejects an unknown wire id', () => {
    const s = unwrap(connect(build('source', 'load'), 'n1', 'n2'));
    expect(unwrap(removeWire(s, 'w1')).wires).toEqual([]);
    expect(errorOf(removeWire(s, 'zzz'))).toEqual({ kind: 'unknown-wire' });
  });
});

describe('syncModuleNodes', () => {
  const labelOf = (ref: { moduleId: string }) => ref.moduleId;

  it('creates one unwired node per placement, ordered by rail and slot', () => {
    const p = panel(placement('p2', 0, 4), placement('p1', 0, 0), placement('p3', 1, 2));
    const s = syncModuleNodes(emptySchematic(), p, labelOf);
    expect(s.wires).toEqual([]);
    expect(s.nodes.map((n) => [n.placementId, n.x, n.y])).toEqual([
      ['p1', 0, 130],
      ['p2', 150, 130],
      ['p3', 0, 260],
    ]);
    expect(s.nodes.every((n) => n.kind === 'module')).toBe(true);
    expect(s.nodes[0]?.label).toBe('m-p1');
  });

  it('is idempotent and only adds nodes for new placements', () => {
    const first = syncModuleNodes(emptySchematic(), panel(placement('p1', 0, 0)), labelOf);
    expect(syncModuleNodes(first, panel(placement('p1', 0, 0)), labelOf)).toEqual(first);
    const second = syncModuleNodes(
      first,
      panel(placement('p1', 0, 0), placement('p2', 0, 2)),
      labelOf,
    );
    expect(second.nodes.map((n) => n.placementId)).toEqual(['p1', 'p2']);
  });

  it('keeps hand-edited positions and wires of existing nodes', () => {
    let s = syncModuleNodes(emptySchematic(), panel(placement('p1', 0, 0)), labelOf);
    s = unwrap(moveNode(s, 'n1', 999, 888));
    const again = syncModuleNodes(s, panel(placement('p1', 0, 0), placement('p2', 0, 2)), labelOf);
    expect(again.nodes[0]).toMatchObject({ x: 999, y: 888 });
  });
});

describe('findProblems', () => {
  it('reports nothing for a consistent project', () => {
    const p = panel(placement('p1', 0, 0));
    const s = syncModuleNodes(emptySchematic(), p, () => 'm');
    expect(findProblems(s, p)).toEqual([]);
  });

  it('flags a module node whose placement was removed, and keeps the node', () => {
    const s = syncModuleNodes(emptySchematic(), panel(placement('p1', 0, 0)), () => 'm');
    expect(findProblems(s, panel())).toEqual([{ kind: 'orphan-module', nodeId: 'n1' }]);
    expect(s.nodes).toHaveLength(1);
  });

  it('does not flag source, busbar and load nodes as orphans', () => {
    expect(findProblems(build('source', 'busbar', 'load'), panel())).toEqual([]);
  });

  it('flags wires that reference missing nodes', () => {
    const s: Schematic = { nodes: build('source').nodes, wires: [{ id: 'w1', from: 'n1', to: 'n9' }] };
    expect(findProblems(s, panel())).toEqual([{ kind: 'dangling-wire', wireId: 'w1' }]);
  });
});

describe('schematic geometry', () => {
  const node = (kind: 'source' | 'busbar' | 'load' | 'module', x: number, y: number) =>
    addNode(emptySchematic(), { kind, label: kind, x, y }).node;

  it('puts the input on top and the output on the bottom of a node', () => {
    const n = node('module', 100, 200);
    expect(inPort(n)).toEqual({ x: 160, y: 200 });
    expect(outPort(n)).toEqual({ x: 160, y: 250 });
  });

  it('routes a downward wire in three segments and an upward one in five', () => {
    const down = wirePath({ x: 0, y: 0 }, { x: 100, y: 200 });
    expect(down).toHaveLength(4);
    const up = wirePath({ x: 0, y: 200 }, { x: 100, y: 0 });
    expect(up).toHaveLength(6);
    expect(up[0]).toEqual({ x: 0, y: 200 });
    expect(up[5]).toEqual({ x: 100, y: 0 });
  });

  it('measures the distance from a point to a path', () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPath({ x: 50, y: 5 }, path)).toBe(5);
    expect(distanceToPath({ x: 110, y: 0 }, path)).toBe(10);
  });

  it('hits the topmost node and the output port of a non-load node only', () => {
    let s = emptySchematic();
    s = addNode(s, { kind: 'source', label: 's', x: 0, y: 0 }).schematic;
    s = addNode(s, { kind: 'load', label: 'l', x: 0, y: 200 }).schematic;
    expect(hitNode(s, { x: 10, y: 10 })?.id).toBe('n1');
    expect(hitNode(s, { x: 500, y: 500 })).toBeUndefined();
    expect(hitOutPort(s, { x: 55, y: 44 })?.id).toBe('n1');
    expect(hitOutPort(s, { x: 60, y: 244 })).toBeUndefined();
  });

  it('hits a wire near its path and misses it far away', () => {
    const s = unwrap(connect(build('source', 'load'), 'n1', 'n2'));
    const moved = unwrap(moveNode(s, 'n2', 0, 300));
    const start = outPort(moved.nodes[0]!);
    expect(hitWire(moved, { x: start.x + 2, y: start.y + 5 }, 6)?.id).toBe('w1');
    expect(hitWire(moved, { x: start.x + 80, y: start.y + 5 }, 6)).toBeUndefined();
  });

  it('frames all nodes with padding, and has default bounds when empty', () => {
    expect(schematicBounds(emptySchematic())).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
    const b = schematicBounds(build('source'));
    expect(b.minX).toBe(-40);
    expect(b.maxX).toBe(110 + 40);
  });
});

describe('freeSpot', () => {
  const start = { x: 0, y: 0 };

  it('uses the start position when nothing is there', () => {
    expect(freeSpot(emptySchematic(), 'source', start)).toEqual(start);
  });

  it('moves down past an occupied position without overlapping anything', () => {
    let s = emptySchematic();
    s = addNode(s, { kind: 'module', label: 'm', x: 0, y: 0 }).schematic;
    const spot = freeSpot(s, 'load', start);
    expect(spot.x).toBe(0);
    expect(spot.y).toBeGreaterThanOrEqual(50 + 20);
  });

  it('skips a whole stack of nodes', () => {
    let s = emptySchematic();
    for (let i = 0; i < 4; i++) s = addNode(s, { kind: 'module', label: 'm', x: 0, y: i * 70 }).schematic;
    expect(freeSpot(s, 'module', start).y).toBeGreaterThanOrEqual(3 * 70 + 50 + 20);
  });

  it('ignores nodes that are far to the side', () => {
    const s = addNode(emptySchematic(), { kind: 'module', label: 'm', x: 500, y: 0 }).schematic;
    expect(freeSpot(s, 'load', start)).toEqual(start);
  });
});
