import type { Placement } from '../layout/placement';
import { evaluateExpression, parseExpression } from '../library/logicExpression';
import { familyOf, type Conductor, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import { Components, netContextOf, PASSIVE_KINDS, type Resolve } from './context';
import { buildNets, terminalKey } from './nets';
import { freeNodeTerminals } from './nodeTerminals';
import { terminalsOf } from './terminals';

/** Devices that can interrupt a circuit by hand; for a contactor this stands in for its coil. */
export const SWITCHING_KINDS: readonly ModuleDef['kind'][] = ['breaker', 'rcd', 'rcbo', 'switch', 'contactor'];

export const CLOSED = 'closed';
export const OPEN = 'open';
/** A contactor in this position follows its coil. */
export const AUTO = 'auto';

/**
 * The positions a switching device can be set to, the default first, and none for a device that
 * does not switch. A device with two terminals of one conductor on its top side, as a changeover
 * switch has, takes one of its inputs (`1`, `2`) or is open; any other is closed or open.
 */
export function positionsOf(def: ModuleDef): string[] {
  if (!SWITCHING_KINDS.includes(def.kind)) return [];
  if (def.logic) return [AUTO, CLOSED, OPEN];
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
  /** For a module with logic, whether each of its inputs senses voltage; undefined for any other. */
  inputsOf(placementId: string): Record<string, boolean> | undefined;
  /** For a module with logic, how many of its contacts are closed and how many it has. */
  contactsOf(placementId: string): { closed: number; total: number } | undefined;
  /** Conductors of different kinds that meet only because a device is closed, which wires and bars alone would not have joined. */
  shorts: ShortCircuit[];
  /** Phase conductors of sources that are on and joined together, by wires or through closed devices. */
  parallelSources: ParallelSources[];
}

export interface ParallelSources {
  /** Ids of the source nodes whose phases are joined. */
  sources: string[];
  terminals: ShortTerminal[];
  devices: string[];
}

export interface ShortTerminal {
  key: string;
  owner: { kind: 'placement' | 'node'; id: string };
  terminalId: string;
  conductor: Conductor;
}

export interface ShortCircuit {
  /** Every terminal that is joined together. */
  terminals: ShortTerminal[];
  /** Placed devices whose closed contacts do the joining. */
  devices: string[];
}

/** Whether these conductors cannot be on one net: two phases, a phase and neutral or earth, DC plus and minus. */
export function conflictingConductors(conductors: Iterable<Conductor>): boolean {
  const fixed = new Set<Conductor>();
  let anyPhase = false;
  for (const c of conductors) {
    if (c === 'C') continue;
    if (c === 'L') anyPhase = true;
    else fixed.add(c);
  }
  const phases = [...fixed].filter((c) => familyOf(c) === 'phase');
  const others = [...fixed].filter((c) => familyOf(c) !== 'phase');
  return phases.length > 1 || others.length > 1 || (others.length === 1 && (phases.length > 0 || anyPhase));
}

const MAX_LOGIC_PASSES = 20;
const isMains = (conductor: Conductor) => ['phase', 'N', 'PE'].includes(familyOf(conductor));

/**
 * Which phase terminals carry voltage, given the position of every switching device and which
 * sources are on. Voltage reaches whatever is joined to a source by wires, by bars and combs, and
 * through a closed device from its input to its output of the same conductor. A device with logic
 * joins the terminals of its contacts that are closed, which depends on which of its inputs sense
 * voltage, so the state is found by repeating until no contact changes. Voltage is followed on
 * phase, neutral and earth, so a coil needs both of its terminals fed; control conductors are not.
 */
export function energy(project: Project, resolve: Resolve): Energy {
  const { schematic, panel } = project;
  const context = netContextOf(project, resolve);
  const isPhase = (conductor: Conductor) => familyOf(conductor) === 'phase';

  const joins: [string, string][] = [];
  for (const net of buildNets({ ...project, schematic: { ...schematic, wires: [] } }, resolve)) {
    for (const t of net.terminals.slice(1)) joins.push([net.terminals[0]!.key, t.key]);
  }
  for (const wire of schematic.wires) {
    const a = terminalKey(schematic, wire.a);
    const b = terminalKey(schematic, wire.b);
    if (a !== undefined && b !== undefined) joins.push([a, b]);
  }
  const staticJoins = joins.length;
  /** Which placed device made each join that goes through a device, so a short can say which one it is. */
  const deviceOf = new Map<string, string>();
  for (const placement of panel.placements) {
    const def = context.defs.get(placement.id);
    if (!def || def.logic || PASSIVE_KINDS.includes(def.kind)) continue;
    const position = positionOf(placement, def);
    if (position === OPEN) continue;
    const terminals = context.terminals.get(placement.id) ?? [];
    const seen = new Map<string, number>();
    for (const top of terminals.filter((t) => t.terminal.side === 'top' && isMains(t.terminal.conductor))) {
      const input = (seen.get(top.terminal.conductor) ?? 0) + 1;
      seen.set(top.terminal.conductor, input);
      if (position !== undefined && position !== CLOSED && position !== String(input)) continue;
      for (const bottom of terminals.filter((t) => t.terminal.side === 'bottom' && t.terminal.conductor === top.terminal.conductor)) {
        joins.push([top.key, bottom.key]);
        deviceOf.set(top.key, placement.id);
        deviceOf.set(bottom.key, placement.id);
      }
    }
  }

  interface Contact {
    placementId: string;
    index: number;
    keys: [string, string];
    closedWhen: ReturnType<typeof parseExpression>;
  }
  const contacts: Contact[] = panel.placements.flatMap((placement) => {
    const def = context.defs.get(placement.id);
    const prefix = `p:${placement.id}/`;
    return (def?.logic?.contacts ?? []).map((contact, index) => ({
      placementId: placement.id,
      index,
      keys: [prefix + contact.between[0], prefix + contact.between[1]] as [string, string],
      closedWhen: parseExpression(contact.closedWhen),
    }));
  });

  const sourceKeys = schematic.nodes
    .filter((n) => n.kind === 'source' && !n.off)
    .flatMap((n) => freeNodeTerminals(n).map((t) => `n:${n.id}/${t.id}`));
  const hasSource = schematic.nodes.some((n) => n.kind === 'source');

  const solve = (closed: ReadonlySet<Contact>) => {
    const components = new Components();
    for (const [a, b] of joins) components.join(a, b);
    for (const contact of closed) components.join(...contact.keys);
    const fed = new Set(sourceKeys.map((key) => components.find(key)));
    return { components, fed };
  };

  let closed: ReadonlySet<Contact> = new Set();
  let state = solve(closed);
  let inputs = new Map<string, Record<string, boolean>>();
  const flagValues = new Map<string, Record<string, boolean>>();
  for (let pass = 0; pass < MAX_LOGIC_PASSES && contacts.length > 0; pass++) {
    const { components, fed } = state;
    inputs = new Map();
    for (const placement of panel.placements) {
      const def = context.defs.get(placement.id);
      if (!def?.logic) continue;
      const position = positionOf(placement, def);
      const values: Record<string, boolean> = {};
      for (const [name, input] of Object.entries(def.logic.inputs)) {
        const roots = input.terminals.map((id) => components.find(`p:${placement.id}/${id}`));
        const powered = roots.filter((root) => fed.has(root));
        values[name] =
          position === CLOSED ? true : position === OPEN ? false
          : input.when === 'any' ? powered.length > 0
          : powered.length === roots.length && new Set(roots).size === roots.length;
      }
      inputs.set(placement.id, values);
      flagValues.set(placement.id, Object.fromEntries(Object.entries(def.logic.flags ?? {}).map(([name, flag]) => [name, placement.flags?.[name] ?? flag.default])));
    }
    const next = new Set(
      contacts.filter((c) => {
        const values = { ...flagValues.get(c.placementId), ...inputs.get(c.placementId) };
        return c.closedWhen.ok && evaluateExpression(c.closedWhen.expression, (name) => values[name] ?? false);
      }),
    );
    const unchanged = next.size === closed.size && [...next].every((c) => closed.has(c));
    closed = next;
    state = solve(closed);
    if (unchanged) break;
  }

  const { components, fed } = state;
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
      const phaseEnd = [terminalKey(schematic, wire.a), terminalKey(schematic, wire.b)].find((key) => {
        const terminal = key === undefined ? undefined : context.netOf.get(key)?.terminals.find((t) => t.key === key)?.terminal;
        return terminal !== undefined && isPhase(terminal.conductor);
      });
      if (phaseEnd !== undefined && !live(phaseEnd)) deadWires.add(wire.id);
    }
    for (const node of schematic.nodes) {
      const keys = phaseKeysOfNode(node.id);
      if (keys.length > 0 && !keys.some(live)) deadNodes.add(node.id);
    }
  }
  const records: ShortTerminal[] = [
    ...[...context.terminals].flatMap(([placementId, list]) =>
      list.map((t): ShortTerminal => ({ key: t.key, owner: { kind: 'placement', id: placementId }, terminalId: t.terminal.id, conductor: t.terminal.conductor })),
    ),
    ...schematic.nodes
      .filter((n) => n.kind !== 'module')
      .flatMap((n) => freeNodeTerminals(n).map((t): ShortTerminal => ({ key: `n:${n.id}/${t.id}`, owner: { kind: 'node', id: n.id }, terminalId: t.id, conductor: t.conductor }))),
  ];
  const staticOnly = new Components();
  for (const [a, b] of joins.slice(0, staticJoins)) staticOnly.join(a, b);
  const byJoined = new Map<string, ShortTerminal[]>();
  for (const record of records) {
    const root = components.find(record.key);
    byJoined.set(root, [...(byJoined.get(root) ?? []), record]);
  }
  const shorts: ShortCircuit[] = [];
  for (const group of byJoined.values()) {
    if (group.length < 2 || !conflictingConductors(group.map((t) => t.conductor))) continue;
    const bySingleNet = new Map<string, Conductor[]>();
    for (const t of group) bySingleNet.set(staticOnly.find(t.key), [...(bySingleNet.get(staticOnly.find(t.key)) ?? []), t.conductor]);
    if ([...bySingleNet.values()].some((conductors) => conflictingConductors(conductors))) continue;
    const devices = [...new Set(group.flatMap((t) => (deviceOf.has(t.key) ? [deviceOf.get(t.key)!] : [])))];
    const closedContacts = [...closed].filter((c) => group.some((t) => t.key === c.keys[0])).map((c) => c.placementId);
    shorts.push({ terminals: group, devices: [...new Set([...devices, ...closedContacts])] });
  }

  const sourceOn = new Map(schematic.nodes.filter((n) => n.kind === 'source').map((n) => [n.id, !n.off]));
  const parallelSources: ParallelSources[] = [];
  for (const group of byJoined.values()) {
    const sources = [...new Set(group.filter((t) => t.owner.kind === 'node' && sourceOn.get(t.owner.id) === true && familyOf(t.conductor) === 'phase').map((t) => t.owner.id))];
    if (sources.length < 2) continue;
    const devices = [...new Set(group.flatMap((t) => (deviceOf.has(t.key) ? [deviceOf.get(t.key)!] : [])))];
    const closedContacts = [...closed].filter((c) => group.some((t) => t.key === c.keys[0])).map((c) => c.placementId);
    parallelSources.push({ sources, terminals: group, devices: [...new Set([...devices, ...closedContacts])] });
  }

  return {
    hasSource,
    shorts,
    parallelSources,
    deadWires,
    deadNodes,
    placementLive: (placementId) => (context.terminals.get(placementId) ?? []).some((t) => isPhase(t.terminal.conductor) && live(t.key)),
    inputsOf: (placementId) => inputs.get(placementId),
    contactsOf: (placementId) => {
      const own = contacts.filter((c) => c.placementId === placementId);
      return own.length === 0 ? undefined : { closed: own.filter((c) => closed.has(c)).length, total: own.length };
    },
  };
}
