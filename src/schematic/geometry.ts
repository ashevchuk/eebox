import { freeNodeTerminals } from '../electrical/nodeTerminals';
import type { Terminal } from '../electrical/terminals';
import type { TerminalSide } from '../library/types';
import type { Bounds, Point } from '../view/Camera';
import type {
  NodeKind,
  Schematic,
  SchematicNode,
  TerminalRef,
  TerminalsOfNode,
  Wire,
} from './model';

export const PORT_RADIUS = 6;
const PORT_HIT_RADIUS = PORT_RADIUS + 4;
const TERMINAL_PITCH = 26;
const SIDE_MARGIN = 12;
const MIN_WIDTH = 110;
const NODE_HEIGHT: Record<NodeKind, number> = { source: 44, load: 44, module: 56 };
export const WIRE_STUB = 18;
const BOUNDS_PADDING = 40;
const ROUTE_MARGIN = 10;
const FREE_SPOT_GAP = 20;
const FREE_SPOT_STEP = 60;
const FREE_SPOT_MAX_STEPS = 200;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PortLayout {
  terminal: Terminal;
  point: Point;
}

export interface NodeLayout {
  node: SchematicNode;
  rect: Rect;
  ports: PortLayout[];
}

export type Layout = Map<string, NodeLayout>;

export interface Endpoint {
  point: Point;
  side: TerminalSide;
}

export function layoutNode(node: SchematicNode, terminals: Terminal[]): NodeLayout {
  const perSide = { top: 0, bottom: 0 };
  terminals.forEach((t) => perSide[t.side]++);
  const widest = Math.max(perSide.top, perSide.bottom);
  const width = Math.max(MIN_WIDTH, widest * TERMINAL_PITCH + 2 * SIDE_MARGIN);
  const rect: Rect = { x: node.x, y: node.y, width, height: NODE_HEIGHT[node.kind] };
  const seen = { top: 0, bottom: 0 };
  const ports = terminals.map((terminal): PortLayout => {
    const index = seen[terminal.side]++;
    const span = (width - 2 * SIDE_MARGIN) / perSide[terminal.side];
    return {
      terminal,
      point: {
        x: rect.x + SIDE_MARGIN + (index + 0.5) * span,
        y: terminal.side === 'top' ? rect.y : rect.y + rect.height,
      },
    };
  });
  return { node, rect, ports };
}

export function computeLayout(schematic: Schematic, terminalsOf: TerminalsOfNode): Layout {
  return new Map(schematic.nodes.map((node) => [node.id, layoutNode(node, terminalsOf(node) ?? [])]));
}

export function portOf(layout: Layout, ref: TerminalRef): PortLayout | undefined {
  return layout.get(ref.node)?.ports.find((p) => p.terminal.id === ref.terminal);
}

export function hitNode(schematic: Schematic, layout: Layout, p: Point): SchematicNode | undefined {
  return [...schematic.nodes].reverse().find((node) => {
    const r = layout.get(node.id)?.rect;
    return r !== undefined && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  });
}

export function hitPort(
  schematic: Schematic,
  layout: Layout,
  p: Point,
): { node: SchematicNode; port: PortLayout } | undefined {
  for (const node of [...schematic.nodes].reverse()) {
    const port = layout
      .get(node.id)
      ?.ports.find((candidate) => Math.hypot(p.x - candidate.point.x, p.y - candidate.point.y) <= PORT_HIT_RADIUS);
    if (port) return { node, port };
  }
  return undefined;
}

/** Orthogonal route that leaves and enters each terminal straight out of its side. */
export function wirePath(a: Endpoint, b: Endpoint, channel: number): Point[] {
  const dirA = a.side === 'bottom' ? 1 : -1;
  const dirB = b.side === 'bottom' ? 1 : -1;
  const stubA = { x: a.point.x, y: a.point.y + dirA * WIRE_STUB };
  const stubB = { x: b.point.x, y: b.point.y + dirB * WIRE_STUB };
  const bridge = (y: number): Point[] => [a.point, { x: a.point.x, y }, { x: b.point.x, y }, b.point];

  if (dirA === 1 && dirB === -1 && stubA.y <= stubB.y) return bridge((stubA.y + stubB.y) / 2 + channel);
  if (dirA === -1 && dirB === 1 && stubB.y <= stubA.y) return bridge((stubA.y + stubB.y) / 2 + channel);
  if (dirA === dirB) {
    const beyond = dirA === 1 ? Math.max(stubA.y, stubB.y) : Math.min(stubA.y, stubB.y);
    return bridge(beyond + dirA * (WIRE_STUB / 2) + channel);
  }
  const x = (a.point.x + b.point.x) / 2 + channel;
  return [a.point, stubA, { x, y: stubA.y }, { x, y: stubB.y }, stubB, b.point];
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

/** The point halfway along the route, where a wire's label is drawn. */
export function pathMidpoint(path: Point[]): Point {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y));
  let remaining = lengths.reduce((sum, l) => sum + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length || i === lengths.length - 1) {
      const t = length === 0 ? 0 : remaining / length;
      const a = path[i]!;
      const b = path[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return path[0] ?? { x: 0, y: 0 };
}

export function hitWire(
  schematic: Schematic,
  routes: Map<string, Point[]>,
  p: Point,
  tolerance: number,
): Wire | undefined {
  return [...schematic.wires].reverse().find((wire) => {
    const path = routes.get(wire.id);
    return path !== undefined && distanceToPath(p, path) <= tolerance;
  });
}

/** First position at or below `start` where a new node of this kind and size overlaps nothing. */
export function freeSpot(
  layout: Layout,
  prototype: Omit<SchematicNode, 'id' | 'x' | 'y'>,
  start: Point,
): Point {
  const { width, height } = layoutNode({ ...prototype, id: '', x: 0, y: 0 }, freeNodeTerminals({ ...prototype, id: '', x: 0, y: 0 })).rect;
  const isFree = (y: number) =>
    [...layout.values()].every(({ rect: r }) =>
      start.x >= r.x + r.width + FREE_SPOT_GAP ||
      r.x >= start.x + width + FREE_SPOT_GAP ||
      y >= r.y + r.height + FREE_SPOT_GAP ||
      r.y >= y + height + FREE_SPOT_GAP,
    );
  for (let step = 0; step < FREE_SPOT_MAX_STEPS; step++) {
    const y = start.y + step * FREE_SPOT_STEP;
    if (isFree(y)) return { x: start.x, y };
  }
  return start;
}

/** The bounds, grown to take in every point of the wire routes, which may run outside the nodes. */
export function boundsWithRoutes(bounds: Bounds, routes: Map<string, Point[]>): Bounds {
  const points = [...routes.values()].flat();
  return {
    minX: Math.min(bounds.minX, ...points.map((p) => p.x - ROUTE_MARGIN)),
    minY: Math.min(bounds.minY, ...points.map((p) => p.y - ROUTE_MARGIN)),
    maxX: Math.max(bounds.maxX, ...points.map((p) => p.x + ROUTE_MARGIN)),
    maxY: Math.max(bounds.maxY, ...points.map((p) => p.y + ROUTE_MARGIN)),
  };
}

/** Height of the box behind a wire label, and the padding it leaves around the text. */
export const WIRE_LABEL_HEIGHT = 14;
export const WIRE_LABEL_PADDING = 8;
const WIRE_LABEL_CHARACTER_MM = 5.5;

/** The box of a wire label centred at `at`; the width is an upper estimate, since no canvas measures it here. */
export function wireLabelBox(text: string, at: Point): Bounds {
  const half = (text.length * WIRE_LABEL_CHARACTER_MM + WIRE_LABEL_PADDING) / 2;
  return { minX: at.x - half, minY: at.y - WIRE_LABEL_HEIGHT / 2, maxX: at.x + half, maxY: at.y + WIRE_LABEL_HEIGHT / 2 };
}

/** The bounds, grown to take in the given label boxes. */
export function boundsWithBoxes(bounds: Bounds, boxes: readonly Bounds[]): Bounds {
  return {
    minX: Math.min(bounds.minX, ...boxes.map((b) => b.minX)),
    minY: Math.min(bounds.minY, ...boxes.map((b) => b.minY)),
    maxX: Math.max(bounds.maxX, ...boxes.map((b) => b.maxX)),
    maxY: Math.max(bounds.maxY, ...boxes.map((b) => b.maxY)),
  };
}

export function schematicBounds(layout: Layout): Bounds {
  if (layout.size === 0) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const rects = [...layout.values()].map((n) => n.rect);
  return {
    minX: Math.min(...rects.map((r) => r.x)) - BOUNDS_PADDING,
    minY: Math.min(...rects.map((r) => r.y)) - BOUNDS_PADDING,
    maxX: Math.max(...rects.map((r) => r.x + r.width)) + BOUNDS_PADDING,
    maxY: Math.max(...rects.map((r) => r.y + r.height)) + BOUNDS_PADDING,
  };
}
