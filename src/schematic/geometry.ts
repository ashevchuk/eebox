import type { Bounds, Point } from '../view/Camera';
import type { NodeKind, Schematic, SchematicNode, Wire } from './model';

export const PORT_RADIUS = 7;
const WIRE_STUB = 16;
const BOUNDS_PADDING = 40;
const SIZES: Record<NodeKind, { width: number; height: number }> = {
  source: { width: 110, height: 44 },
  busbar: { width: 220, height: 16 },
  load: { width: 120, height: 44 },
  module: { width: 120, height: 50 },
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const nodeRect = (node: SchematicNode): Rect => ({
  x: node.x,
  y: node.y,
  ...SIZES[node.kind],
});

export function inPort(node: SchematicNode): Point {
  const r = nodeRect(node);
  return { x: r.x + r.width / 2, y: r.y };
}

export function outPort(node: SchematicNode): Point {
  const r = nodeRect(node);
  return { x: r.x + r.width / 2, y: r.y + r.height };
}

export function wirePath(from: Point, to: Point): Point[] {
  const outY = from.y + WIRE_STUB;
  const inY = to.y - WIRE_STUB;
  if (outY <= inY) {
    const midY = (outY + inY) / 2;
    return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
  }
  const midX = (from.x + to.x) / 2;
  return [
    from,
    { x: from.x, y: outY },
    { x: midX, y: outY },
    { x: midX, y: inY },
    { x: to.x, y: inY },
    to,
  ];
}

export function wireEndpoints(schematic: Schematic, wire: Wire): [SchematicNode, SchematicNode] | null {
  const from = schematic.nodes.find((n) => n.id === wire.from);
  const to = schematic.nodes.find((n) => n.id === wire.to);
  return from && to ? [from, to] : null;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distanceToPath(p: Point, path: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    best = Math.min(best, distanceToSegment(p, path[i - 1]!, path[i]!));
  }
  return best;
}

export function hitNode(schematic: Schematic, p: Point): SchematicNode | undefined {
  return [...schematic.nodes].reverse().find((node) => {
    const r = nodeRect(node);
    return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  });
}

/** Nodes that cannot feed anything (loads) have no output port to grab. */
export function hitOutPort(schematic: Schematic, p: Point): SchematicNode | undefined {
  return [...schematic.nodes]
    .reverse()
    .find((node) => node.kind !== 'load' && Math.hypot(p.x - outPort(node).x, p.y - outPort(node).y) <= PORT_RADIUS + 3);
}

export function hitWire(schematic: Schematic, p: Point, tolerance: number): Wire | undefined {
  return schematic.wires.find((wire) => {
    const ends = wireEndpoints(schematic, wire);
    return ends !== null && distanceToPath(p, wirePath(outPort(ends[0]), inPort(ends[1]))) <= tolerance;
  });
}

const FREE_SPOT_GAP = 20;
const FREE_SPOT_STEP = 60;
const FREE_SPOT_MAX_STEPS = 200;

/** First position at or below `start` where a new node of `kind` overlaps no existing node. */
export function freeSpot(schematic: Schematic, kind: NodeKind, start: Point): Point {
  const { width, height } = SIZES[kind];
  const isFree = (y: number) =>
    schematic.nodes.every((node) => {
      const r = nodeRect(node);
      return (
        start.x >= r.x + r.width + FREE_SPOT_GAP ||
        r.x >= start.x + width + FREE_SPOT_GAP ||
        y >= r.y + r.height + FREE_SPOT_GAP ||
        r.y >= y + height + FREE_SPOT_GAP
      );
    });
  for (let step = 0; step < FREE_SPOT_MAX_STEPS; step++) {
    const y = start.y + step * FREE_SPOT_STEP;
    if (isFree(y)) return { x: start.x, y };
  }
  return start;
}

export function schematicBounds(schematic: Schematic): Bounds {
  if (schematic.nodes.length === 0) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const rects = schematic.nodes.map(nodeRect);
  return {
    minX: Math.min(...rects.map((r) => r.x)) - BOUNDS_PADDING,
    minY: Math.min(...rects.map((r) => r.y)) - BOUNDS_PADDING,
    maxX: Math.max(...rects.map((r) => r.x + r.width)) + BOUNDS_PADDING,
    maxY: Math.max(...rects.map((r) => r.y + r.height)) + BOUNDS_PADDING,
  };
}
