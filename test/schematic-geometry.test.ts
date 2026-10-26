import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import {
  computeLayout,
  distanceToPath,
  freeSpot,
  hitNode,
  hitPort,
  hitWire,
  pathMidpoint,
  portOf,
  schematicBounds,
  wirePath,
} from '../src/schematic/geometry';
import { routeWires } from '../src/schematic/router';
import { addNode, connect, connectAll, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

function scene() {
  const panel = panelOf([place('p1', 'mcb3', 0, 0), place('p2', 'nbar', 0, 4)]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: -200, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  return { panel, schematic, terminalsOf, layout: computeLayout(schematic, terminalsOf) };
}

describe('node layout', () => {
  it('puts input terminals on the top edge and outputs on the bottom edge', () => {
    const { layout } = scene();
    const node = layout.get('n1')!;
    const top = node.ports.filter((p) => p.terminal.side === 'top');
    const bottom = node.ports.filter((p) => p.terminal.side === 'bottom');
    expect(top.map((p) => p.terminal.name)).toEqual(['L1', 'L2', 'L3']);
    expect(top.every((p) => p.point.y === node.rect.y)).toBe(true);
    expect(bottom.every((p) => p.point.y === node.rect.y + node.rect.height)).toBe(true);
  });

  it('spaces terminals evenly inside the node and in order', () => {
    const { layout } = scene();
    const xs = layout.get('n1')!.ports.filter((p) => p.terminal.side === 'top').map((p) => p.point.x);
    const rect = layout.get('n1')!.rect;
    expect(xs[0]).toBeGreaterThan(rect.x);
    expect(xs[2]).toBeLessThan(rect.x + rect.width);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
  });

  it('widens a node with many terminals so they do not collide', () => {
    const { layout } = scene();
    const bar = layout.get('n2')!;
    expect(bar.rect.width).toBeGreaterThanOrEqual(3 * 26);
    const xs = bar.ports.filter((p) => p.terminal.side === 'top').map((p) => p.point.x);
    expect(Math.min(...xs.slice(1).map((x, i) => x - xs[i]!))).toBeGreaterThanOrEqual(26 - 0.001);
  });

  it('puts a source feeding downwards and a load taking from above', () => {
    const { layout } = scene();
    expect(layout.get('n3')!.ports.every((p) => p.terminal.side === 'bottom')).toBe(true);
    const load = addNode(emptySchematic(), { kind: 'load', label: 'L', x: 0, y: 0, conductors: ['L', 'N'] }).schematic;
    expect(computeLayout(load, nodeTerminalsLookup(panelOf([]), resolve)).get('n1')!.ports.every((p) => p.terminal.side === 'top')).toBe(true);
  });

  it('keeps a node whose module is missing, with no terminals', () => {
    const panel = panelOf([place('p1', 'ghost', 0, 0)]);
    const schematic = syncModuleNodes(emptySchematic(), panel, () => 'ghost');
    expect(computeLayout(schematic, nodeTerminalsLookup(panel, resolve)).get('n1')!.ports).toEqual([]);
  });
});

describe('hit testing', () => {
  it('hits the topmost node and nothing on empty space', () => {
    const { schematic, layout } = scene();
    const rect = layout.get('n1')!.rect;
    expect(hitNode(schematic, layout, { x: rect.x + 5, y: rect.y + 20 })?.id).toBe('n1');
    expect(hitNode(schematic, layout, { x: 5000, y: 5000 })).toBeUndefined();
  });

  it('hits a terminal within the port radius and no terminal in the middle of a node', () => {
    const { schematic, layout } = scene();
    const port = portOf(layout, { node: 'n1', terminal: 'top:L2' })!;
    const hit = hitPort(schematic, layout, { x: port.point.x + 3, y: port.point.y - 2 });
    expect(hit?.node.id).toBe('n1');
    expect(hit?.port.terminal.id).toBe('top:L2');
    const rect = layout.get('n1')!.rect;
    expect(hitPort(schematic, layout, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })).toBeUndefined();
  });

  it('finds a wire near its path and not far from it', () => {
    const { schematic, terminalsOf } = scene();
    const wired = connect(schematic, terminalsOf, { node: 'n3', terminal: 'bottom:L1' }, { node: 'n1', terminal: 'top:L1' });
    if (!wired.ok) throw new Error(wired.error.kind);
    const layout = computeLayout(wired.schematic, terminalsOf);
    const start = portOf(layout, { node: 'n3', terminal: 'bottom:L1' })!.point;
    const routes = routeWires(wired.schematic, layout);
    expect(hitWire(wired.schematic, routes, { x: start.x, y: start.y + 8 }, 6)?.id).toBe('w1');
    expect(hitWire(wired.schematic, routes, { x: start.x + 300, y: start.y + 8 }, 6)).toBeUndefined();
  });
});

describe('wire routing', () => {
  const bottom = (x: number, y: number) => ({ point: { x, y }, side: 'bottom' as const });
  const top = (x: number, y: number) => ({ point: { x, y }, side: 'top' as const });

  it('routes a downward wire in three segments between the two terminals', () => {
    const path = wirePath(bottom(0, 0), top(100, 200), 0);
    expect(path).toHaveLength(4);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[3]).toEqual({ x: 100, y: 200 });
    expect(path[1]!.y).toBe(path[2]!.y);
  });

  it('detours with stubs when the wire has to go back up', () => {
    const path = wirePath(bottom(0, 200), top(100, 0), 0);
    expect(path).toHaveLength(6);
    expect(path[1]).toEqual({ x: 0, y: 218 });
    expect(path[4]).toEqual({ x: 100, y: -18 });
  });

  it('runs past both terminals when two terminals face the same way', () => {
    const topToTop = wirePath(top(0, 100), top(100, 120), 0);
    expect(topToTop[1]!.y).toBeLessThan(100);
    const bottomToBottom = wirePath(bottom(0, 100), bottom(100, 120), 0);
    expect(bottomToBottom[1]!.y).toBeGreaterThan(120);
  });

  it('measures the distance from a point to a path', () => {
    const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distanceToPath({ x: 50, y: 5 }, path)).toBe(5);
    expect(distanceToPath({ x: 110, y: 0 }, path)).toBe(10);
  });
});

describe('free spot and bounds', () => {
  it('uses the start position when nothing is there', () => {
    const empty = computeLayout(emptySchematic(), () => []);
    expect(freeSpot(empty, { kind: 'load', label: 'L', conductors: ['L', 'N'] }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('moves down past an occupied position without overlapping anything', () => {
    const { layout } = scene();
    const occupied = layout.get('n1')!.rect;
    const spot = freeSpot(layout, { kind: 'load', label: 'L', conductors: ['L', 'N'] }, { x: occupied.x, y: occupied.y });
    expect(spot.x).toBe(occupied.x);
    expect(spot.y).toBeGreaterThanOrEqual(occupied.y + occupied.height + 20);
  });

  it('ignores nodes that are far to the side', () => {
    const { layout } = scene();
    expect(freeSpot(layout, { kind: 'load', label: 'L', conductors: ['L'] }, { x: 5000, y: 0 })).toEqual({ x: 5000, y: 0 });
  });

  it('frames all nodes with padding, and has default bounds when empty', () => {
    expect(schematicBounds(new Map())).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
    const { layout } = scene();
    const b = schematicBounds(layout);
    const rects = [...layout.values()].map((n) => n.rect);
    expect(b.minX).toBe(Math.min(...rects.map((r) => r.x)) - 40);
    expect(b.maxY).toBe(Math.max(...rects.map((r) => r.y + r.height)) + 40);
  });
});

describe('bundle wiring geometry', () => {
  it('never leaves a wire end without a terminal', () => {
    const { schematic, terminalsOf } = scene();
    const result = connectAll(schematic, terminalsOf, 'n3', 'n1') as { ok: true; schematic: Schematic };
    const layout = computeLayout(result.schematic, terminalsOf);
    for (const wire of result.schematic.wires) {
      expect(portOf(layout, wire.a)).toBeDefined();
      expect(portOf(layout, wire.b)).toBeDefined();
    }
  });
});

describe('pathMidpoint', () => {
  it('is the middle of a straight segment', () => {
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ x: 50, y: 0 });
  });

  it('walks around corners to the halfway point of the whole route', () => {
    const route = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }];
    expect(pathMidpoint(route)).toEqual({ x: 50, y: 100 });
  });

  it('lands inside the longer segment when the halves are uneven', () => {
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 90 }])).toEqual({ x: 10, y: 40 });
  });

  it('copes with a degenerate route', () => {
    expect(pathMidpoint([{ x: 5, y: 5 }, { x: 5, y: 5 }])).toEqual({ x: 5, y: 5 });
    expect(pathMidpoint([{ x: 7, y: 9 }])).toEqual({ x: 7, y: 9 });
  });
});
