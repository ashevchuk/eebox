import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { computeLayout, portOf, wirePath, type Layout, type Rect } from '../src/schematic/geometry';
import {
  addNode,
  connect,
  connectAll,
  emptySchematic,
  moveNode,
  syncModuleNodes,
  type Schematic,
  type SchematicResult,
} from '../src/schematic/model';
import { routeWires } from '../src/schematic/router';
import type { Point } from '../src/view/Camera';
import { panelOf, place, resolve } from './fixtures';

const unwrap = (r: SchematicResult): Schematic => {
  if (!r.ok) throw new Error(r.error.kind);
  return r.schematic;
};

interface Scene {
  schematic: Schematic;
  layout: Layout;
  routes: Map<string, Point[]>;
}

/** A source above a row of modules; extra nodes can be placed in the way. */
function scene(setup: (s: Schematic, terminalsOf: ReturnType<typeof nodeTerminalsLookup>) => Schematic): Scene {
  const panel = panelOf([place('p1', 'mcb3', 0, 0), place('p2', 'mcb3', 0, 4), place('p3', 'rcd4', 0, 8)]);
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 100, y: -200, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  schematic = setup(schematic, terminalsOf);
  const layout = computeLayout(schematic, terminalsOf);
  return { schematic, layout, routes: routeWires(schematic, layout) };
}

const segments = (path: Point[]) => path.slice(1).map((p, i) => [path[i]!, p] as const);
const isOrthogonal = (path: Point[]) => segments(path).every(([a, b]) => Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01);

function crossesInterior(path: Point[], rect: Rect): boolean {
  return segments(path).some(([a, b]) => {
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    return x2 > rect.x && x1 < rect.x + rect.width && y2 > rect.y && y1 < rect.y + rect.height && !(x1 === x2 && (x1 <= rect.x || x1 >= rect.x + rect.width)) && !(y1 === y2 && (y1 <= rect.y || y1 >= rect.y + rect.height));
  });
}

/** Length shared by two routes along the same line. */
function sharedLength(a: Point[], b: Point[]): number {
  let total = 0;
  for (const [p, q] of segments(a)) {
    for (const [r, s] of segments(b)) {
      const horizontal = Math.abs(p.y - q.y) < 0.01 && Math.abs(r.y - s.y) < 0.01 && Math.abs(p.y - r.y) < 0.01;
      const vertical = Math.abs(p.x - q.x) < 0.01 && Math.abs(r.x - s.x) < 0.01 && Math.abs(p.x - r.x) < 0.01;
      if (horizontal) total += Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)));
      if (vertical) total += Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)));
    }
  }
  return total;
}

const wireOne = (s: Schematic, t: ReturnType<typeof nodeTerminalsLookup>) =>
  unwrap(connect(s, t, { node: 'n4', terminal: 'bottom:L1' }, { node: 'n1', terminal: 'top:L1' }));

describe('routeWires', () => {
  it('draws a wire from terminal to terminal, in right angles, leaving each straight out of its edge', () => {
    const { routes, layout, schematic } = scene(wireOne);
    const path = routes.get('w1')!;
    const source = layout.get('n4')!.ports.find((p) => p.terminal.id === 'bottom:L1')!.point;
    const target = layout.get('n1')!.ports.find((p) => p.terminal.id === 'top:L1')!.point;
    expect(path[0]).toEqual(source);
    expect(path[path.length - 1]).toEqual(target);
    expect(isOrthogonal(path)).toBe(true);
    expect(path[1]!.x).toBeCloseTo(source.x);
    expect(path[1]!.y).toBeGreaterThan(source.y);
    expect(path[path.length - 2]!.x).toBeCloseTo(target.x);
    expect(path[path.length - 2]!.y).toBeLessThan(target.y);
    expect(schematic.wires).toHaveLength(1);
  });

  it('has no needless zigzag in a plain case: straight down, across, straight down', () => {
    const { routes } = scene(wireOne);
    expect(routes.get('w1')!.length).toBeLessThanOrEqual(4);
  });

  it('goes around a node that is in the way instead of through it', () => {
    const { routes, layout } = scene((s, t) => {
      const wired = wireOne(s, t);
      const blocker = addNode(wired, { kind: 'load', label: 'Block', x: 60, y: -80, conductors: ['L', 'N', 'PE', 'L1', 'L2', 'L3'] });
      return unwrap(moveNode(blocker.schematic, blocker.node.id, 40, -90));
    });
    const path = routes.get('w1')!;
    expect(isOrthogonal(path)).toBe(true);
    const blocker = [...layout.values()].find((n) => n.node.label === 'Block')!;
    const from = portOf(layout, { node: 'n4', terminal: 'bottom:L1' })!;
    const to = portOf(layout, { node: 'n1', terminal: 'top:L1' })!;
    const naive = wirePath({ point: from.point, side: 'bottom' }, { point: to.point, side: 'top' }, 0);
    expect(crossesInterior(naive, blocker.rect)).toBe(true);
    for (const { rect, node } of layout.values()) {
      if (node.id === 'n4' || node.id === 'n1') continue;
      expect(crossesInterior(path, rect)).toBe(false);
    }
  });

  it('keeps clear of every node on the way for each wire of a full bundle', () => {
    const { routes, layout } = scene((s, t) => {
      const result = connectAll(s, t, 'n4', 'n3');
      if (!result.ok) throw new Error(result.error.kind);
      return result.schematic;
    });
    expect(routes.size).toBe(4);
    for (const path of routes.values()) {
      expect(isOrthogonal(path)).toBe(true);
      for (const { rect, node } of layout.values()) {
        if (node.id === 'n4' || node.id === 'n3') continue;
        expect(crossesInterior(path, rect)).toBe(false);
      }
    }
  });

  it('puts parallel wires between the same two nodes on separate lanes', () => {
    const { routes } = scene((s, t) => {
      const result = connectAll(s, t, 'n4', 'n2');
      if (!result.ok) throw new Error(result.error.kind);
      return result.schematic;
    });
    const all = [...routes.values()];
    expect(all).toHaveLength(3);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(sharedLength(all[i]!, all[j]!)).toBeLessThan(1);
    }
  });

  it('is deterministic', () => {
    const first = scene(wireOne).routes.get('w1');
    const second = scene(wireOne).routes.get('w1');
    expect(second).toEqual(first);
  });

  it('reuses its result while nothing changes, and recomputes when a node moves', () => {
    const base = scene(wireOne);
    expect(routeWires(base.schematic, base.layout)).toBe(base.routes);
    const moved = scene((s, t) => unwrap(moveNode(wireOne(s, t), 'n1', 400, 300)));
    expect(moved.routes).not.toBe(base.routes);
    expect(moved.routes.get('w1')).not.toEqual(base.routes.get('w1'));
  });

  it('routes a wire that has to go back up, around the node it leaves from', () => {
    const { routes, layout } = scene((s, t) => unwrap(connect(s, t, { node: 'n1', terminal: 'bottom:L1' }, { node: 'n4', terminal: 'bottom:L1' })));
    const path = routes.get('w1')!;
    expect(isOrthogonal(path)).toBe(true);
    for (const { rect, node } of layout.values()) {
      if (node.id !== 'n1' && node.id !== 'n4') expect(crossesInterior(path, rect)).toBe(false);
    }
  });

  it('skips wires whose terminal no longer exists, without failing the others', () => {
    const { routes } = scene((s, t) => {
      const wired = wireOne(s, t);
      return { ...wired, wires: [...wired.wires, { id: 'w9', a: { node: 'n4', terminal: 'bottom:L2' }, b: { node: 'n1', terminal: 'top:Q' } }] };
    });
    expect(routes.has('w1')).toBe(true);
    expect(routes.has('w9')).toBe(false);
  });

  it('still returns a path when the terminals are walled in by an overlapping node', () => {
    const { routes } = scene((s, t) => {
      const wired = wireOne(s, t);
      const sitting = addNode(wired, { kind: 'load', label: 'On top', x: 100, y: -200, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] });
      return sitting.schematic;
    });
    expect(routes.get('w1')!.length).toBeGreaterThanOrEqual(2);
  });

  it('copes with a larger schematic in reasonable time', () => {
    const panel = panelOf(Array.from({ length: 12 }, (_, i) => place(`p${i}`, 'mcb1', i < 6 ? 0 : 1, (i % 6) * 2)));
    const terminalsOf = nodeTerminalsLookup(panel, resolve);
    let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: -200, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
    for (let i = 1; i <= 12; i++) {
      schematic = unwrap(connect(schematic, terminalsOf, { node: 'n13', terminal: 'bottom:L1' }, { node: `n${i}`, terminal: 'top:L' }));
    }
    const layout = computeLayout(schematic, terminalsOf);
    const started = performance.now();
    const routes = routeWires(schematic, layout);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(routes.size).toBe(12);
    for (const path of routes.values()) expect(isOrthogonal(path)).toBe(true);
  });
});
