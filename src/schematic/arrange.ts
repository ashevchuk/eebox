import type { Layout, Rect } from './geometry';
import type { Schematic, SchematicNode } from './model';

/** Distance between nodes of a row, and between rows, which has room for the wires that run between them. */
export const ARRANGE_GAP_X = 40;
export const ARRANGE_GAP_Y = 90;
/** Positions are kept on this grid, as those made by hand are. */
export const GRID_MM = 10;
const BARYCENTRE_SWEEPS = 4;

const snap = (value: number): number => Math.round(value / GRID_MM) * GRID_MM;

export type NodeAlign = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

function moved(schematic: Schematic, positions: ReadonlyMap<string, { x: number; y: number }>): Schematic {
  return { ...schematic, nodes: schematic.nodes.map((n): SchematicNode => (positions.has(n.id) ? { ...n, ...positions.get(n.id)! } : n)) };
}

function rectsOf(layout: Layout, ids: readonly string[]): Array<{ id: string; rect: Rect }> {
  return ids.flatMap((id) => {
    const rect = layout.get(id)?.rect;
    return rect ? [{ id, rect }] : [];
  });
}

/** The nodes lined up on an edge or a middle of the box that covers them. */
export function alignNodes(schematic: Schematic, layout: Layout, ids: readonly string[], how: NodeAlign): Schematic {
  const items = rectsOf(layout, ids);
  if (items.length < 2) return schematic;
  const left = Math.min(...items.map((i) => i.rect.x));
  const right = Math.max(...items.map((i) => i.rect.x + i.rect.width));
  const top = Math.min(...items.map((i) => i.rect.y));
  const bottom = Math.max(...items.map((i) => i.rect.y + i.rect.height));
  const positions = new Map<string, { x: number; y: number }>();
  for (const { id, rect } of items) {
    const x = how === 'left' ? left : how === 'right' ? right - rect.width : how === 'centre' ? (left + right) / 2 - rect.width / 2 : rect.x;
    const y = how === 'top' ? top : how === 'bottom' ? bottom - rect.height : how === 'middle' ? (top + bottom) / 2 - rect.height / 2 : rect.y;
    positions.set(id, { x: snap(x), y: snap(y) });
  }
  return moved(schematic, positions);
}

/** Three nodes or more spread so that the gaps between them are equal, the outer two staying where they are. */
export function distributeNodes(schematic: Schematic, layout: Layout, ids: readonly string[], axis: 'horizontal' | 'vertical'): Schematic {
  const items = rectsOf(layout, ids);
  if (items.length < 3) return schematic;
  const horizontal = axis === 'horizontal';
  const start = (r: Rect) => (horizontal ? r.x : r.y);
  const size = (r: Rect) => (horizontal ? r.width : r.height);
  const ordered = [...items].sort((a, b) => start(a.rect) + size(a.rect) / 2 - (start(b.rect) + size(b.rect) / 2));
  const first = ordered[0]!.rect;
  const last = ordered[ordered.length - 1]!.rect;
  const total = ordered.reduce((sum, i) => sum + size(i.rect), 0);
  const gap = (start(last) + size(last) - start(first) - total) / (ordered.length - 1);
  const positions = new Map<string, { x: number; y: number }>();
  let edge = start(first);
  for (const { id, rect } of ordered) {
    positions.set(id, horizontal ? { x: snap(edge), y: rect.y } : { x: rect.x, y: snap(edge) });
    edge += size(rect) + gap;
  }
  return moved(schematic, positions);
}

/** How many wires lie between nodes, by node id, for the nodes that are wired. */
function neighboursOf(schematic: Schematic): Map<string, string[]> {
  const next = new Map<string, string[]>(schematic.nodes.map((n) => [n.id, []]));
  for (const wire of schematic.wires) {
    if (wire.a.node === wire.b.node) continue;
    next.get(wire.a.node)?.push(wire.b.node);
    next.get(wire.b.node)?.push(wire.a.node);
  }
  return next;
}

/**
 * Rows of nodes, a row for how far a node is from a source along the wires, with the loads in the last
 * row and the nodes that no wire reaches in a row under it, as a diagram of a supply is read from the top.
 */
export function levelsOf(schematic: Schematic): string[][] {
  const next = neighboursOf(schematic);
  const level = new Map<string, number>();
  const queue = schematic.nodes.filter((n) => n.kind === 'source').map((n) => n.id);
  for (const id of queue) level.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const other of next.get(id) ?? []) {
      if (!level.has(other)) {
        level.set(other, level.get(id)! + 1);
        queue.push(other);
      }
    }
  }
  const reached = schematic.nodes.filter((n) => level.has(n.id));
  const deepest = Math.max(0, ...reached.filter((n) => n.kind !== 'load').map((n) => level.get(n.id)!));
  const rows: string[][] = [];
  const put = (row: number, id: string) => {
    (rows[row] ??= []).push(id);
  };
  for (const node of reached) put(node.kind === 'load' ? deepest + 1 : level.get(node.id)!, node.id);
  const looseRow = rows.length;
  for (const node of schematic.nodes.filter((n) => !level.has(n.id))) put(looseRow, node.id);
  return rows.map((row) => row ?? []).filter((row) => row.length > 0);
}

/** The nodes of each row put in an order that keeps the wires between rows from crossing much: each toward the middle of what it is wired to. */
function ordered(rows: string[][], next: Map<string, string[]>, x: ReadonlyMap<string, number>): string[][] {
  const order = new Map<string, number>();
  const result = rows.map((row) => [...row].sort((a, b) => (x.get(a) ?? 0) - (x.get(b) ?? 0)));
  const index = () => result.forEach((row) => row.forEach((id, i) => order.set(id, i / Math.max(1, row.length - 1))));
  index();
  const sweep = (row: string[], toward: string[]) => {
    const key = (id: string) => {
      const links = (next.get(id) ?? []).filter((o) => toward.includes(o));
      return links.length === 0 ? (order.get(id) ?? 0) : links.reduce((sum, o) => sum + (order.get(o) ?? 0), 0) / links.length;
    };
    row.sort((a, b) => key(a) - key(b) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
    row.forEach((id, i) => order.set(id, i / Math.max(1, row.length - 1)));
  };
  for (let pass = 0; pass < BARYCENTRE_SWEEPS; pass++) {
    for (let r = 1; r < result.length; r++) sweep(result[r]!, result[r - 1]!);
    for (let r = result.length - 2; r >= 0; r--) sweep(result[r]!, result[r + 1]!);
  }
  return result;
}

/** Every node put in its row, the rows centred on one another, with room between for the wires. */
export function arrangeNodes(schematic: Schematic, layout: Layout): Schematic {
  const rows = ordered(levelsOf(schematic), neighboursOf(schematic), new Map(schematic.nodes.map((n) => [n.id, n.x])));
  const widthOf = (id: string) => layout.get(id)?.rect.width ?? 0;
  const heightOf = (id: string) => layout.get(id)?.rect.height ?? 0;
  const rowWidth = (row: string[]) => row.reduce((sum, id) => sum + widthOf(id), 0) + ARRANGE_GAP_X * Math.max(0, row.length - 1);
  const widest = Math.max(0, ...rows.map(rowWidth));
  const top = Math.min(...schematic.nodes.map((n) => n.y));
  const left = Math.min(...schematic.nodes.map((n) => n.x));
  const positions = new Map<string, { x: number; y: number }>();
  let y = top;
  for (const row of rows) {
    let x = left + (widest - rowWidth(row)) / 2;
    for (const id of row) {
      positions.set(id, { x: snap(x), y: snap(y) });
      x += widthOf(id) + ARRANGE_GAP_X;
    }
    y += Math.max(...row.map(heightOf)) + ARRANGE_GAP_Y;
  }
  return moved(schematic, positions);
}
