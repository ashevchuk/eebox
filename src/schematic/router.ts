import type { Point } from '../view/Camera';
import { WIRE_STUB, portOf, wirePath, type Layout, type Rect } from './geometry';
import { pathFromLanes } from './manualRoute';
import type { Schematic } from './model';

/** Space kept free around every node, so wires do not graze it. */
const CLEARANCE = 8;
/** Distance between the parallel lanes a wire may take beside a node or in a gap. */
const LANE = 10;
const LANES_AROUND_NODE = 3;
const LANES_IN_GAP = 2;
const BEND_COST = 24;
const OVERLAP_COST_PER_PX = 6;
const MAX_EXPANSIONS = 60000;
/** Lines of the grid that are not needed to leave a terminal or follow a hand-drawn wire are left out when they are closer than this to another, or the router would put two wires there. */
const MIN_LINE_GAP = 10;

type Direction = 0 | 1 | 2 | 3;
const START: 4 = 4;
const STEPS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const OPPOSITE: Record<number, number> = { 0: 1, 1: 0, 2: 3, 3: 2 };

class MinHeap {
  private readonly items: Array<{ f: number; state: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(f: number, state: number): void {
    const items = this.items;
    items.push({ f, state });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.f <= items[i]!.f) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): { f: number; state: number } {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left]!.f < items[smallest]!.f) smallest = left;
        if (right < items.length && items[right]!.f < items[smallest]!.f) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

/** The lines that have to be there, and of the others those that are a gap away from every line kept. */
function gridLines(required: number[], optional: number[]): number[] {
  const kept = sortedUnique(required);
  for (const value of sortedUnique(optional)) if (kept.every((k) => Math.abs(k - value) >= MIN_LINE_GAP)) kept.push(value);
  return kept.sort((a, b) => a - b);
}

function sortedUnique(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.filter((v, i) => i === 0 || v - sorted[i - 1]! > 0.01);
}

function inflate(r: Rect): Rect {
  return { x: r.x - CLEARANCE, y: r.y - CLEARANCE, width: r.width + 2 * CLEARANCE, height: r.height + 2 * CLEARANCE };
}

interface Endpoint {
  wireId: string;
  port: Point;
  stub: Point;
  /** Direction the wire leaves the terminal: +1 down, -1 up. */
  dir: 1 | -1;
}

interface Search {
  xs: number[];
  ys: number[];
  obstacles: Rect[];
  used: Map<string, number>;
  blocked: Map<number, boolean>;
}

/** True when the grid edge from vertex (i, j) one step in `step` would run through a node. */
function edgeBlocked(search: Search, i: number, j: number, step: [number, number]): boolean {
  const { xs, ys, obstacles, blocked } = search;
  const ni = i + step[0];
  const nj = j + step[1];
  const key = (Math.min(i, ni) * ys.length + Math.min(j, nj)) * 2 + (step[0] !== 0 ? 0 : 1);
  const cached = blocked.get(key);
  if (cached !== undefined) return cached;
  const x1 = Math.min(xs[i]!, xs[ni]!);
  const x2 = Math.max(xs[i]!, xs[ni]!);
  const y1 = Math.min(ys[j]!, ys[nj]!);
  const y2 = Math.max(ys[j]!, ys[nj]!);
  const result = obstacles.some((o) =>
    step[0] !== 0
      ? y1 > o.y && y1 < o.y + o.height && x1 < o.x + o.width && x2 > o.x
      : x1 > o.x && x1 < o.x + o.width && y1 < o.y + o.height && y2 > o.y,
  );
  blocked.set(key, result);
  return result;
}

const edgeId = (ny: number, i: number, j: number, ni: number, nj: number) =>
  `${Math.min(i * ny + j, ni * ny + nj)}-${Math.max(i * ny + j, ni * ny + nj)}`;

/** Cheapest orthogonal path between two vertices, or undefined when the nodes wall it in. */
function search(s: Search, from: Endpoint, to: Endpoint): Array<[number, number]> | undefined {
  const { xs, ys, used } = s;
  const ny = ys.length;
  const index = (values: number[], v: number) => values.findIndex((x) => Math.abs(x - v) <= 0.01);
  const si = index(xs, from.stub.x);
  const sj = index(ys, from.stub.y);
  const gi = index(xs, to.stub.x);
  const gj = index(ys, to.stub.y);
  if (si < 0 || sj < 0 || gi < 0 || gj < 0) return undefined;

  const stateOf = (i: number, j: number, d: number) => (i * ny + j) * 5 + d;
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const heap = new MinHeap();
  const startState = stateOf(si, sj, from.dir === 1 ? 2 : 3);
  g.set(startState, 0);
  heap.push(Math.abs(xs[si]! - xs[gi]!) + Math.abs(ys[sj]! - ys[gj]!), startState);

  let expansions = 0;
  while (heap.size > 0 && expansions++ < MAX_EXPANSIONS) {
    const { state } = heap.pop();
    const dir = state % 5;
    const vertex = (state - dir) / 5;
    const i = Math.floor(vertex / ny);
    const j = vertex % ny;
    if (i === gi && j === gj) {
      const path: Array<[number, number]> = [];
      for (let at: number | undefined = state; at !== undefined; at = came.get(at)) {
        const v = (at - (at % 5)) / 5;
        path.push([Math.floor(v / ny), v % ny]);
      }
      return path.reverse();
    }
    for (let d = 0; d < 4; d++) {
      if (dir !== START && OPPOSITE[dir] === d) continue;
      const step = STEPS[d]!;
      const ni = i + step[0];
      const nj = j + step[1];
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ny || edgeBlocked(s, i, j, step)) continue;
      const length = Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!);
      const overlap = (used.get(edgeId(ny, i, j, ni, nj)) ?? 0) * OVERLAP_COST_PER_PX * length;
      const cost = (g.get(state) ?? 0) + length + overlap + (dir !== START && dir !== d ? BEND_COST : 0);
      const next = stateOf(ni, nj, d as Direction);
      if (cost >= (g.get(next) ?? Infinity)) continue;
      g.set(next, cost);
      came.set(next, state);
      heap.push(cost + Math.abs(xs[ni]! - xs[gi]!) + Math.abs(ys[nj]! - ys[gj]!), next);
    }
  }
  return undefined;
}

/** Marks the grid edges a hand-drawn wire runs along as taken, so wires routed after it keep off them. */
function markUsed(s: Search, path: Point[]): void {
  const index = (values: number[], v: number) => values.findIndex((x) => Math.abs(x - v) <= 0.01);
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const b = path[k]!;
    const [i1, j1, i2, j2] = [index(s.xs, a.x), index(s.ys, a.y), index(s.xs, b.x), index(s.ys, b.y)];
    if (i1 < 0 || j1 < 0 || i2 < 0 || j2 < 0) continue;
    const di = Math.sign(i2 - i1);
    const dj = Math.sign(j2 - j1);
    for (let i = i1, j = j1; i !== i2 || j !== j2; i += di, j += dj) {
      const id = edgeId(s.ys.length, i, j, i + di, j + dj);
      s.used.set(id, (s.used.get(id) ?? 0) + 1);
    }
  }
}

function withoutRedundantPoints(points: Point[]): Point[] {
  const kept: Point[] = [];
  for (const p of points) {
    const last = kept[kept.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const before = kept[kept.length - 2];
    if (last && before && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) kept.pop();
    kept.push(p);
  }
  return kept;
}

let cache: { signature: string; routes: Map<string, Point[]> } | undefined;

function signatureOf(schematic: Schematic, layout: Layout): string {
  const nodes = [...layout.values()].map((n) => [n.node.id, n.rect.x, n.rect.y, n.rect.width, n.rect.height, n.ports.map((p) => p.terminal.id)]);
  const wires = schematic.wires.map((w) => [w.id, w.a.node, w.a.terminal, w.b.node, w.b.terminal, w.route]);
  return JSON.stringify([nodes, wires]);
}

/**
 * Routes every wire as an orthogonal path from terminal to terminal that leaves each terminal
 * straight out of its edge, goes around the nodes, bends as little as it can, and keeps off the
 * wires routed before it, so parallel wires end up on neighbouring lanes. A wire that cannot be
 * routed falls back to the simple shape. The last result is reused while nothing has changed.
 */
export function routeWires(schematic: Schematic, layout: Layout): Map<string, Point[]> {
  const signature = signatureOf(schematic, layout);
  if (cache?.signature === signature) return cache.routes;

  const endpoints = schematic.wires.flatMap((wire) => {
    const a = portOf(layout, wire.a);
    const b = portOf(layout, wire.b);
    if (!a || !b) return [];
    const make = (port: Point, side: 'top' | 'bottom'): Endpoint => {
      const dir = side === 'bottom' ? 1 : -1;
      return { wireId: wire.id, port, dir, stub: { x: port.x, y: port.y + dir * WIRE_STUB } };
    };
    return [{ wire, from: make(a.point, a.terminal.side), to: make(b.point, b.terminal.side), sides: [a.terminal.side, b.terminal.side] as const }];
  });

  const manual = new Map<string, Point[]>();
  for (const { wire, from, to, sides } of endpoints) {
    if (wire.route) manual.set(wire.id, pathFromLanes({ point: from.port, side: sides[0] }, { point: to.port, side: sides[1] }, wire.route));
  }

  const obstacles = [...layout.values()].map((n) => inflate(n.rect));
  const xRequired: number[] = [];
  const yRequired: number[] = [];
  const xOptional: number[] = [];
  const yOptional: number[] = [];
  for (const o of obstacles) {
    for (let k = 0; k < LANES_AROUND_NODE; k++) {
      xOptional.push(o.x - k * LANE, o.x + o.width + k * LANE);
      yOptional.push(o.y - k * LANE, o.y + o.height + k * LANE);
    }
  }
  for (const path of manual.values()) {
    for (const p of path) {
      xRequired.push(p.x);
      yRequired.push(p.y);
    }
  }
  for (const { from, to } of endpoints) {
    xRequired.push(from.stub.x, to.stub.x);
    yRequired.push(from.stub.y, to.stub.y);
    for (let k = -LANES_IN_GAP; k <= LANES_IN_GAP; k++) {
      xOptional.push((from.stub.x + to.stub.x) / 2 + k * LANE);
      yOptional.push((from.stub.y + to.stub.y) / 2 + k * LANE);
    }
  }
  const s: Search = { xs: gridLines(xRequired, xOptional), ys: gridLines(yRequired, yOptional), obstacles, used: new Map(), blocked: new Map() };
  /**
   * A terminal whose stub ends inside the clearance of a nearby node is shut in by the clearance
   * alone, so such a wire is searched against the bodies of the nodes instead of their clearance.
   */
  const bodies: Search = { ...s, obstacles: [...layout.values()].map((n) => n.rect), blocked: new Map() };
  const inClearance = (p: Point) => obstacles.some((o) => p.x > o.x && p.x < o.x + o.width && p.y > o.y && p.y < o.y + o.height);

  const routes = new Map<string, Point[]>();
  for (const [id, path] of manual) {
    routes.set(id, path);
    markUsed(s, path);
  }
  for (const { wire, from, to, sides } of endpoints) {
    if (manual.has(wire.id)) continue;
    const found = search(s, from, to) ?? (inClearance(from.stub) || inClearance(to.stub) ? search(bodies, from, to) : undefined);
    if (!found) {
      routes.set(wire.id, wirePath({ point: from.port, side: sides[0] }, { point: to.port, side: sides[1] }, 0));
      continue;
    }
    for (let k = 1; k < found.length; k++) {
      const [i, j] = found[k - 1]!;
      const [ni, nj] = found[k]!;
      const id = edgeId(s.ys.length, i, j, ni, nj);
      s.used.set(id, (s.used.get(id) ?? 0) + 1);
    }
    const points = found.map(([i, j]) => ({ x: s.xs[i]!, y: s.ys[j]! }));
    routes.set(wire.id, withoutRedundantPoints([from.port, ...points, to.port]));
  }
  cache = { signature, routes };
  return routes;
}
