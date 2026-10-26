import type { ModuleRef, Panel } from '../layout/placement';

export type NodeKind = 'source' | 'busbar' | 'load' | 'module';

export interface SchematicNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  /** Set for `module` nodes only. */
  placementId?: string;
}

/** Directed from the supplying node's output to the consuming node's input. */
export interface Wire {
  id: string;
  from: string;
  to: string;
}

export interface Schematic {
  nodes: SchematicNode[];
  wires: Wire[];
}

export type SchematicError =
  | { kind: 'unknown-node' }
  | { kind: 'unknown-wire' }
  | { kind: 'self-loop' }
  | { kind: 'duplicate-wire' }
  | { kind: 'invalid-direction' };

export type SchematicResult =
  | { ok: true; schematic: Schematic }
  | { ok: false; error: SchematicError };

export type SchematicProblem =
  | { kind: 'orphan-module'; nodeId: string }
  | { kind: 'dangling-wire'; wireId: string };

const SKELETON_COLUMN_PITCH = 150;
const SKELETON_ROW_PITCH = 130;

export const emptySchematic = (): Schematic => ({ nodes: [], wires: [] });

function nextId(prefix: string, existing: { id: string }[]): string {
  const used = existing
    .map((item) => new RegExp(`^${prefix}(\\d+)$`).exec(item.id))
    .map((m) => (m ? Number(m[1]) : 0));
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

const failure = (kind: SchematicError['kind']): SchematicResult => ({ ok: false, error: { kind } });

export function addNode(
  schematic: Schematic,
  node: Omit<SchematicNode, 'id'>,
): { schematic: Schematic; node: SchematicNode } {
  const created: SchematicNode = { ...node, id: nextId('n', schematic.nodes) };
  return { schematic: { ...schematic, nodes: [...schematic.nodes, created] }, node: created };
}

function updateNode(
  schematic: Schematic,
  id: string,
  change: Partial<Pick<SchematicNode, 'x' | 'y' | 'label'>>,
): SchematicResult {
  if (!schematic.nodes.some((n) => n.id === id)) return failure('unknown-node');
  return {
    ok: true,
    schematic: {
      ...schematic,
      nodes: schematic.nodes.map((n) => (n.id === id ? { ...n, ...change } : n)),
    },
  };
}

export const moveNode = (schematic: Schematic, id: string, x: number, y: number) =>
  updateNode(schematic, id, { x, y });

export const renameNode = (schematic: Schematic, id: string, label: string) =>
  updateNode(schematic, id, { label });

export function removeNode(schematic: Schematic, id: string): SchematicResult {
  if (!schematic.nodes.some((n) => n.id === id)) return failure('unknown-node');
  return {
    ok: true,
    schematic: {
      nodes: schematic.nodes.filter((n) => n.id !== id),
      wires: schematic.wires.filter((w) => w.from !== id && w.to !== id),
    },
  };
}

export function connect(schematic: Schematic, from: string, to: string): SchematicResult {
  const source = schematic.nodes.find((n) => n.id === from);
  const target = schematic.nodes.find((n) => n.id === to);
  if (!source || !target) return failure('unknown-node');
  if (from === to) return failure('self-loop');
  if (source.kind === 'load' || target.kind === 'source') return failure('invalid-direction');
  if (schematic.wires.some((w) => w.from === from && w.to === to)) return failure('duplicate-wire');
  const wire: Wire = { id: nextId('w', schematic.wires), from, to };
  return { ok: true, schematic: { ...schematic, wires: [...schematic.wires, wire] } };
}

export function removeWire(schematic: Schematic, id: string): SchematicResult {
  if (!schematic.wires.some((w) => w.id === id)) return failure('unknown-wire');
  return { ok: true, schematic: { ...schematic, wires: schematic.wires.filter((w) => w.id !== id) } };
}

/**
 * Adds an unwired node for every placement that has none, laid out by rail and
 * slot order. The topology cannot be derived from geometry, so no wires are made.
 */
export function syncModuleNodes(
  schematic: Schematic,
  panel: Panel,
  labelOf: (module: ModuleRef) => string,
): Schematic {
  const linked = new Set(schematic.nodes.map((n) => n.placementId));
  let result = schematic;
  panel.railLengthsUnits.forEach((_length, rail) => {
    const onRail = panel.placements
      .filter((p) => p.rail === rail)
      .sort((a, b) => a.slot - b.slot);
    onRail.forEach((placement, column) => {
      if (linked.has(placement.id)) return;
      result = addNode(result, {
        kind: 'module',
        label: labelOf(placement.module),
        x: column * SKELETON_COLUMN_PITCH,
        y: (rail + 1) * SKELETON_ROW_PITCH,
        placementId: placement.id,
      }).schematic;
    });
  });
  return result;
}

/** Audits a schematic against its panel; also catches files edited by hand. */
export function findProblems(schematic: Schematic, panel: Panel): SchematicProblem[] {
  const placementIds = new Set(panel.placements.map((p) => p.id));
  const nodeIds = new Set(schematic.nodes.map((n) => n.id));
  return [
    ...schematic.nodes
      .filter((n) => n.kind === 'module' && !(n.placementId && placementIds.has(n.placementId)))
      .map((n): SchematicProblem => ({ kind: 'orphan-module', nodeId: n.id })),
    ...schematic.wires
      .filter((w) => !nodeIds.has(w.from) || !nodeIds.has(w.to))
      .map((w): SchematicProblem => ({ kind: 'dangling-wire', wireId: w.id })),
  ];
}
