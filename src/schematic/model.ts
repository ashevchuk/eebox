import { CROSS_SECTIONS_MM2 } from '../electrical/cables';
import { loadSpecProblem, type LoadSpec } from '../electrical/loads';
import { freeNodeTerminals } from '../electrical/nodeTerminals';
import type { Terminal } from '../electrical/terminals';
import { normalizeLabel } from '../layout/labels';
import type { ModuleRef, Panel } from '../layout/placement';
import { CONDUCTORS, canJoin, familyOf, type Conductor } from '../library/types';

export type NodeKind = 'source' | 'load' | 'module';

export interface SchematicNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  /** Set for `module` nodes only. */
  placementId?: string;
  /** Set for `source` and `load` nodes only: their terminals, one per conductor. */
  conductors?: Conductor[];
  /** What a `load` node draws; only on load nodes. */
  load?: LoadSpec;
  /** A `source` node that is switched off, to see what loses power; only on source nodes. */
  off?: boolean;
  /** Prospective short-circuit current at the source, in kA; only on source nodes. */
  shortCircuitKA?: number;
  /** Phase-to-neutral loop impedance at the source, in milliohms; only on source nodes. */
  loopImpedanceMOhm?: number;
}

export interface TerminalRef {
  node: string;
  /** Terminal id on that node, e.g. `top:L1`. */
  terminal: string;
}

/** A physical wire between two terminals; it has no direction. */
export interface Wire {
  id: string;
  a: TerminalRef;
  b: TerminalRef;
  /** Cable or circuit name shown on the wire. */
  label?: string;
  /** Cross-section of the conductor, which decides the size of the ferrules on its ends. */
  crossSectionMm2?: number;
  /**
   * A route drawn by hand: the coordinates of the interior segments, y first and then x, y, ...,
   * an odd number of them. The ends follow the terminals; see `schematic/manualRoute.ts`.
   */
  route?: number[];
}

export const MAX_ROUTE_LANES = 15;
export const MAX_ROUTE_COORDINATE = 100_000;

export const routeProblem = (route: unknown): string | null =>
  Array.isArray(route) &&
  route.length >= 1 &&
  route.length <= MAX_ROUTE_LANES &&
  route.length % 2 === 1 &&
  route.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_ROUTE_COORDINATE)
    ? null
    : `must be an odd number (1 to ${MAX_ROUTE_LANES}) of coordinates within ${MAX_ROUTE_COORDINATE}`;

export interface Schematic {
  nodes: SchematicNode[];
  wires: Wire[];
}

/** The terminals of a node, or undefined when the node is unknown or its module is missing. */
export type TerminalsOfNode = (node: SchematicNode) => Terminal[] | undefined;

export type SchematicError =
  | { kind: 'unknown-node' }
  | { kind: 'unknown-terminal' }
  | { kind: 'unknown-wire' }
  | { kind: 'same-terminal' }
  | { kind: 'duplicate-wire' }
  | { kind: 'incompatible-conductors' }
  | { kind: 'nothing-to-connect' }
  | { kind: 'invalid-label' }
  | { kind: 'not-a-free-node' }
  | { kind: 'not-a-load' }
  | { kind: 'not-a-source' }
  | { kind: 'invalid-load' }
  | { kind: 'invalid-section' }
  | { kind: 'invalid-route' }
  | { kind: 'invalid-conductors' };

export type SchematicResult =
  | { ok: true; schematic: Schematic }
  | { ok: false; error: SchematicError };

export type SchematicProblem =
  | { kind: 'orphan-module'; nodeId: string }
  | { kind: 'dangling-wire'; wireId: string };

const SKELETON_COLUMN_PITCH = 200;
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

/** A node always has a label, so unlike other labels it cannot be cleared. */
export function renameNode(schematic: Schematic, id: string, text: string): SchematicResult {
  const parsed = normalizeLabel(text);
  if (!parsed.ok || parsed.label === undefined) return failure('invalid-label');
  return updateNode(schematic, id, { label: parsed.label });
}

export function setWireLabel(schematic: Schematic, id: string, text: string): SchematicResult {
  const parsed = normalizeLabel(text);
  if (!parsed.ok) return failure('invalid-label');
  if (!schematic.wires.some((w) => w.id === id)) return failure('unknown-wire');
  const wires = schematic.wires.map((w) => {
    if (w.id !== id) return w;
    const { label: _previous, ...rest } = w;
    return parsed.label === undefined ? rest : { ...rest, label: parsed.label };
  });
  return { ok: true, schematic: { ...schematic, wires } };
}

export function removeNode(schematic: Schematic, id: string): SchematicResult {
  if (!schematic.nodes.some((n) => n.id === id)) return failure('unknown-node');
  return {
    ok: true,
    schematic: {
      nodes: schematic.nodes.filter((n) => n.id !== id),
      wires: schematic.wires.filter((w) => w.a.node !== id && w.b.node !== id),
    },
  };
}

const sameRef = (x: TerminalRef, y: TerminalRef) => x.node === y.node && x.terminal === y.terminal;

const isWired = (schematic: Schematic, a: TerminalRef, b: TerminalRef) =>
  schematic.wires.some((w) => (sameRef(w.a, a) && sameRef(w.b, b)) || (sameRef(w.a, b) && sameRef(w.b, a)));

function findTerminal(
  schematic: Schematic,
  terminalsOf: TerminalsOfNode,
  ref: TerminalRef,
): Terminal | 'unknown-node' | 'unknown-terminal' {
  const node = schematic.nodes.find((n) => n.id === ref.node);
  if (!node) return 'unknown-node';
  return terminalsOf(node)?.find((t) => t.id === ref.terminal) ?? 'unknown-terminal';
}

/** Wires may join terminals of the same family only: phase with phase, N with N, PE with PE. */
export function connect(
  schematic: Schematic,
  terminalsOf: TerminalsOfNode,
  a: TerminalRef,
  b: TerminalRef,
): SchematicResult {
  const first = findTerminal(schematic, terminalsOf, a);
  const second = findTerminal(schematic, terminalsOf, b);
  if (typeof first === 'string') return failure(first);
  if (typeof second === 'string') return failure(second);
  if (sameRef(a, b)) return failure('same-terminal');
  if (!canJoin(first.conductor, second.conductor)) return failure('incompatible-conductors');
  if (isWired(schematic, a, b)) return failure('duplicate-wire');
  const wire: Wire = { id: nextId('w', schematic.wires), a, b };
  return { ok: true, schematic: { ...schematic, wires: [...schematic.wires, wire] } };
}

/** Pairs equal conductors first, then leftover phases in order, so L1 L2 L3 N meets L N as L1-L, N-N. */
function pairTerminals(from: Terminal[], to: Terminal[]): Array<[Terminal, Terminal]> {
  const free = [...to];
  const exact = new Map<Terminal, Terminal>();
  for (const t of from) {
    const i = free.findIndex((u) => u.conductor === t.conductor);
    if (i >= 0) exact.set(t, free.splice(i, 1)[0]!);
  }
  const fallback = new Map<Terminal, Terminal>();
  for (const t of from) {
    if (exact.has(t) || familyOf(t.conductor) !== 'phase') continue;
    const i = free.findIndex((u) => familyOf(u.conductor) === 'phase');
    if (i >= 0) fallback.set(t, free.splice(i, 1)[0]!);
  }
  return from.flatMap((t) => {
    const partner = exact.get(t) ?? fallback.get(t);
    return partner ? [[t, partner] as [Terminal, Terminal]] : [];
  });
}

/**
 * Wires every pole of one node to the matching pole of another, using the sides that face each
 * other (the lower node is reached from the bottom of the upper one). Existing wires are kept.
 */
export function connectAll(
  schematic: Schematic,
  terminalsOf: TerminalsOfNode,
  fromId: string,
  toId: string,
): { ok: true; schematic: Schematic; added: number } | { ok: false; error: SchematicError } {
  const from = schematic.nodes.find((n) => n.id === fromId);
  const to = schematic.nodes.find((n) => n.id === toId);
  const fromTerminals = from && terminalsOf(from);
  const toTerminals = to && terminalsOf(to);
  if (!from || !to || !fromTerminals || !toTerminals) return { ok: false, error: { kind: 'unknown-node' } };
  if (fromId === toId) return { ok: false, error: { kind: 'same-terminal' } };

  const sides: Array<['top' | 'bottom', 'top' | 'bottom']> =
    to.y >= from.y
      ? [['bottom', 'top'], ['top', 'bottom']]
      : [['top', 'bottom'], ['bottom', 'top']];
  let result = schematic;
  let added = 0;
  for (const [fromSide, toSide] of sides) {
    const pairs = pairTerminals(
      fromTerminals.filter((t) => t.side === fromSide),
      toTerminals.filter((t) => t.side === toSide),
    );
    if (pairs.length === 0) continue;
    for (const [x, y] of pairs) {
      const wired = connect(result, terminalsOf, { node: fromId, terminal: x.id }, { node: toId, terminal: y.id });
      if (wired.ok) {
        result = wired.schematic;
        added++;
      }
    }
    break;
  }
  return added === 0 ? { ok: false, error: { kind: 'nothing-to-connect' } } : { ok: true, schematic: result, added };
}

/**
 * Changes which conductors a source or load has. Wires on terminals that no longer exist are
 * removed, and `droppedWires` says how many, so the caller can ask before committing.
 */
export function setNodeConductors(
  schematic: Schematic,
  id: string,
  conductors: Conductor[],
):
  | { ok: true; schematic: Schematic; droppedWires: number }
  | { ok: false; error: SchematicError } {
  const node = schematic.nodes.find((n) => n.id === id);
  if (!node) return { ok: false, error: { kind: 'unknown-node' } };
  if (node.kind === 'module') return { ok: false, error: { kind: 'not-a-free-node' } };
  const valid =
    conductors.length >= 1 &&
    new Set(conductors).size === conductors.length &&
    conductors.every((c) => CONDUCTORS.includes(c));
  if (!valid) return { ok: false, error: { kind: 'invalid-conductors' } };

  const kept = new Set(freeNodeTerminals({ ...node, conductors }).map((t) => t.id));
  const touchesRemoved = (ref: TerminalRef) => ref.node === id && !kept.has(ref.terminal);
  const wires = schematic.wires.filter((w) => !touchesRemoved(w.a) && !touchesRemoved(w.b));
  const ordered = CONDUCTORS.filter((c) => conductors.includes(c));
  return {
    ok: true,
    droppedWires: schematic.wires.length - wires.length,
    schematic: {
      nodes: schematic.nodes.map((n) => (n.id === id ? { ...n, conductors: ordered } : n)),
      wires,
    },
  };
}

/** Switches a source on or off; a source that is off feeds nothing. */
export function setSourceOff(schematic: Schematic, id: string, off: boolean): SchematicResult {
  const node = schematic.nodes.find((n) => n.id === id);
  if (!node) return failure('unknown-node');
  if (node.kind !== 'source') return failure('not-a-source');
  const { off: _previous, ...rest } = node;
  const updated: SchematicNode = off ? { ...rest, off: true } : rest;
  return { ok: true, schematic: { ...schematic, nodes: schematic.nodes.map((n) => (n.id === id ? updated : n)) } };
}

export type SourceProtectionKey = 'shortCircuitKA' | 'loopImpedanceMOhm';
export const MAX_SHORT_CIRCUIT_KA = 200;
export const MAX_LOOP_IMPEDANCE_MOHM = 100_000;

/** Sets what is known of the supply for the protection checks, or clears it with `undefined`. */
export function setSourceProtection(schematic: Schematic, id: string, key: SourceProtectionKey, value: number | undefined): SchematicResult {
  const node = schematic.nodes.find((n) => n.id === id);
  if (!node) return failure('unknown-node');
  if (node.kind !== 'source') return failure('not-a-source');
  const limit = key === 'shortCircuitKA' ? MAX_SHORT_CIRCUIT_KA : MAX_LOOP_IMPEDANCE_MOHM;
  if (value !== undefined && !(Number.isFinite(value) && value > 0 && value <= limit)) return failure('invalid-load');
  const { [key]: _previous, ...rest } = node;
  const updated: SchematicNode = value === undefined ? rest : { ...rest, [key]: value };
  return { ok: true, schematic: { ...schematic, nodes: schematic.nodes.map((n) => (n.id === id ? updated : n)) } };
}

/** Gives a wire a route drawn by hand, or clears it with `undefined` so the wire is routed automatically. */
export function setWireRoute(schematic: Schematic, id: string, route: number[] | undefined): SchematicResult {
  if (!schematic.wires.some((w) => w.id === id)) return failure('unknown-wire');
  if (route !== undefined && routeProblem(route) !== null) return failure('invalid-route');
  const wires = schematic.wires.map((w) => {
    if (w.id !== id) return w;
    const { route: _previous, ...rest } = w;
    return route === undefined ? rest : { ...rest, route: [...route] };
  });
  return { ok: true, schematic: { ...schematic, wires } };
}

/** Takes the hand-drawn route off every wire, so the router lays them all out again. */
export function clearWireRoutes(schematic: Schematic): { schematic: Schematic; cleared: number } {
  const cleared = schematic.wires.filter((w) => w.route).length;
  const wires = schematic.wires.map((w) => {
    const { route: _route, ...rest } = w;
    return rest;
  });
  return { schematic: cleared === 0 ? schematic : { ...schematic, wires }, cleared };
}

/** Sets the cross-section of a wire, or clears it with `undefined`. */
export function setWireSection(schematic: Schematic, id: string, sectionMm2: number | undefined): SchematicResult {
  if (!schematic.wires.some((w) => w.id === id)) return failure('unknown-wire');
  if (sectionMm2 !== undefined && !(CROSS_SECTIONS_MM2 as readonly number[]).includes(sectionMm2)) return failure('invalid-section');
  const wires = schematic.wires.map((w) => {
    if (w.id !== id) return w;
    const { crossSectionMm2: _previous, ...rest } = w;
    return sectionMm2 === undefined ? rest : { ...rest, crossSectionMm2: sectionMm2 };
  });
  return { ok: true, schematic: { ...schematic, wires } };
}

/** Sets what a load draws, or clears it with `undefined`. */
export function setNodeLoad(schematic: Schematic, id: string, load: LoadSpec | undefined): SchematicResult {
  const node = schematic.nodes.find((n) => n.id === id);
  if (!node) return failure('unknown-node');
  if (node.kind !== 'load') return failure('not-a-load');
  if (load && loadSpecProblem(load) !== null) return failure('invalid-load');
  const { load: _previous, ...rest } = node;
  const updated: SchematicNode = load ? { ...rest, load } : rest;
  return { ok: true, schematic: { ...schematic, nodes: schematic.nodes.map((n) => (n.id === id ? updated : n)) } };
}

export function removeWire(schematic: Schematic, id: string): SchematicResult {
  if (!schematic.wires.some((w) => w.id === id)) return failure('unknown-wire');
  return { ok: true, schematic: { ...schematic, wires: schematic.wires.filter((w) => w.id !== id) } };
}

/**
 * Adds an unwired node for every placement that has none, laid out by rail and slot order.
 * The topology cannot be derived from geometry, so no wires are made.
 */
export function syncModuleNodes(
  schematic: Schematic,
  panel: Panel,
  labelOf: (module: ModuleRef) => string,
): Schematic {
  const linked = new Set(schematic.nodes.map((n) => n.placementId));
  let result = schematic;
  panel.railLengthsUnits.forEach((_length, rail) => {
    const onRail = panel.placements.filter((p) => p.rail === rail).sort((a, b) => a.slot - b.slot);
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

const hasWires = (schematic: Schematic, nodeId: string) =>
  schematic.wires.some((w) => w.a.node === nodeId || w.b.node === nodeId);

const withoutNodes = (schematic: Schematic, ids: Set<string>): Schematic => ({
  ...schematic,
  nodes: schematic.nodes.filter((n) => !ids.has(n.id)),
});

/** Drops the node of a module that has just left the panel for good, unless wires hang on it. */
export function removeUnwiredNodeOf(schematic: Schematic, placementId: string): Schematic {
  const gone = new Set(
    schematic.nodes.filter((n) => n.placementId === placementId && !hasWires(schematic, n.id)).map((n) => n.id),
  );
  return gone.size === 0 ? schematic : withoutNodes(schematic, gone);
}

/**
 * Removes module nodes whose module is neither on a rail nor on the shelf, as long as no wire is
 * on them; a node with wires stays, so that nothing is lost without the user seeing it.
 */
export function removeOrphanNodes(
  schematic: Schematic,
  panel: Panel,
): { schematic: Schematic; removed: number; keptWired: number } {
  const known = new Set([...panel.placements, ...panel.shelf].map((p) => p.id));
  const orphans = schematic.nodes.filter((n) => n.kind === 'module' && !(n.placementId && known.has(n.placementId)));
  const unwired = new Set(orphans.filter((n) => !hasWires(schematic, n.id)).map((n) => n.id));
  return {
    schematic: unwired.size === 0 ? schematic : withoutNodes(schematic, unwired),
    removed: unwired.size,
    keptWired: orphans.length - unwired.size,
  };
}

/** Audits a schematic against its panel; also catches files edited by hand. */
export function findProblems(
  schematic: Schematic,
  panel: Panel,
  terminalsOf: TerminalsOfNode,
): SchematicProblem[] {
  const placementIds = new Set(panel.placements.map((p) => p.id));
  const hasTerminal = (ref: TerminalRef) => {
    const node = schematic.nodes.find((n) => n.id === ref.node);
    return node !== undefined && (terminalsOf(node)?.some((t) => t.id === ref.terminal) ?? false);
  };
  return [
    ...schematic.nodes
      .filter((n) => n.kind === 'module' && !(n.placementId && placementIds.has(n.placementId)))
      .map((n): SchematicProblem => ({ kind: 'orphan-module', nodeId: n.id })),
    ...schematic.wires
      .filter((w) => !hasTerminal(w.a) || !hasTerminal(w.b))
      .map((w): SchematicProblem => ({ kind: 'dangling-wire', wireId: w.id })),
  ];
}
