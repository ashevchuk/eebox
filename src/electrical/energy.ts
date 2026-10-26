import type { Placement } from '../layout/placement';
import { familyOf, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import { Components, netContextOf, PASSIVE_KINDS, type Resolve } from './context';
import { buildNets, terminalKey } from './nets';
import { freeNodeTerminals } from './nodeTerminals';
import { terminalsOf } from './terminals';

/** Devices that can interrupt a circuit by hand; for a contactor this stands in for its coil. */
export const SWITCHING_KINDS: readonly ModuleDef['kind'][] = ['breaker', 'rcd', 'rcbo', 'switch', 'contactor'];

export const CLOSED = 'closed';
export const OPEN = 'open';

/**
 * The positions a switching device can be set to, the default first, and none for a device that
 * does not switch. A device with two terminals of one conductor on its top side, as a changeover
 * switch has, takes one of its inputs (`1`, `2`) or is open; any other is closed or open.
 */
export function positionsOf(def: ModuleDef): string[] {
  if (!SWITCHING_KINDS.includes(def.kind)) return [];
  const perConductor = new Map<string, number>();
  for (const t of terminalsOf(def)) {
    if (t.side === 'top' && familyOf(t.conductor) === 'phase') perConductor.set(t.conductor, (perConductor.get(t.conductor) ?? 0) + 1);
  }
  return Math.max(0, ...perConductor.values()) > 1 ? ['1', '2', OPEN] : [CLOSED, OPEN];
}

/** The position a placed device is in: the one it was set to, or the default; undefined if it does not switch. */
export function positionOf(placement: Pick<Placement, 'state'>, def: ModuleDef): string | undefined {
  const positions = positionsOf(def);
  if (positions.length === 0) return undefined;
  return placement.state !== undefined && positions.includes(placement.state) ? placement.state : positions[0];
}

export interface Energy {
  /** False when no source is on: nothing is then reported as dead, there is nothing to feed it. */
  hasSource: boolean;
  /** Phase wires that carry no voltage. */
  deadWires: ReadonlySet<string>;
  /** Nodes with phase terminals none of which carries voltage. */
  deadNodes: ReadonlySet<string>;
  /** Whether some phase terminal of a placed module carries voltage. */
  placementLive(placementId: string): boolean;
}

/**
 * Which phase terminals carry voltage, given the position of every switching device and which
 * sources are on. Voltage reaches whatever is joined to a source by wires, by bars and combs, and
 * through a closed device from its input to its output of the same conductor. Neutral, earth and
 * control conductors are not followed, and a relay or a contactor is not driven by its coil: the
 * position is set by hand.
 */
export function energy(project: Project, resolve: Resolve): Energy {
  const { schematic, panel } = project;
  const context = netContextOf(project, resolve);
  const isPhase = (conductor: Parameters<typeof familyOf>[0]) => familyOf(conductor) === 'phase';
  const components = new Components();

  for (const net of buildNets({ ...project, schematic: { ...schematic, wires: [] } }, resolve)) {
    for (const t of net.terminals.slice(1)) components.join(net.terminals[0]!.key, t.key);
  }
  for (const wire of schematic.wires) {
    const a = terminalKey(schematic, wire.a);
    const b = terminalKey(schematic, wire.b);
    if (a !== undefined && b !== undefined) components.join(a, b);
  }
  for (const placement of panel.placements) {
    const def = context.defs.get(placement.id);
    if (!def || PASSIVE_KINDS.includes(def.kind)) continue;
    const position = positionOf(placement, def);
    if (position === OPEN) continue;
    const terminals = context.terminals.get(placement.id) ?? [];
    const seen = new Map<string, number>();
    for (const top of terminals.filter((t) => t.terminal.side === 'top' && isPhase(t.terminal.conductor))) {
      const input = (seen.get(top.terminal.conductor) ?? 0) + 1;
      seen.set(top.terminal.conductor, input);
      if (position !== undefined && position !== CLOSED && position !== String(input)) continue;
      for (const bottom of terminals.filter((t) => t.terminal.side === 'bottom' && t.terminal.conductor === top.terminal.conductor)) {
        components.join(top.key, bottom.key);
      }
    }
  }

  const sourceKeys = schematic.nodes
    .filter((n) => n.kind === 'source' && !n.off)
    .flatMap((n) => freeNodeTerminals(n).filter((t) => isPhase(t.conductor)).map((t) => `n:${n.id}/${t.id}`));
  const hasSource = schematic.nodes.some((n) => n.kind === 'source');
  const fed = new Set(sourceKeys.map((key) => components.find(key)));
  const live = (key: string) => fed.has(components.find(key));

  const phaseKeysOfNode = (nodeId: string): string[] => {
    const node = schematic.nodes.find((n) => n.id === nodeId)!;
    if (node.kind !== 'module') return freeNodeTerminals(node).filter((t) => isPhase(t.conductor)).map((t) => `n:${node.id}/${t.id}`);
    return (context.terminals.get(node.placementId ?? '') ?? []).filter((t) => isPhase(t.terminal.conductor)).map((t) => t.key);
  };

  const deadWires = new Set<string>();
  const deadNodes = new Set<string>();
  if (hasSource) {
    for (const wire of schematic.wires) {
      const key = terminalKey(schematic, wire.a);
      const terminal = key === undefined ? undefined : context.netOf.get(key)?.terminals.find((t) => t.key === key)?.terminal;
      if (key !== undefined && terminal && isPhase(terminal.conductor) && !live(key)) deadWires.add(wire.id);
    }
    for (const node of schematic.nodes) {
      const keys = phaseKeysOfNode(node.id);
      if (keys.length > 0 && !keys.some(live)) deadNodes.add(node.id);
    }
  }
  return {
    hasSource,
    deadWires,
    deadNodes,
    placementLive: (placementId) => (context.terminals.get(placementId) ?? []).some((t) => isPhase(t.terminal.conductor) && live(t.key)),
  };
}
