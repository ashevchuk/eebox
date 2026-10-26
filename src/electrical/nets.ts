import type { ModuleRef } from '../layout/placement';
import { familyOf, type Conductor, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import { freeNodeTerminals } from './nodeTerminals';
import { terminalsOf, type Terminal } from './terminals';

export interface NetTerminal {
  /** `p:<placement>/<terminal>` for module terminals, `n:<node>/<terminal>` for source and load terminals. */
  key: string;
  owner: { kind: 'placement' | 'node'; id: string };
  terminal: Terminal;
}

export interface Net {
  terminals: NetTerminal[];
}

/** One place where a comb pin touches a terminal. */
export interface CombContact {
  combId: string;
  pin: Conductor;
  placementId: string;
  terminalId: string;
}

export type NetProblem = { kind: 'mixed-families' | 'mixed-phases' | 'mixed-polarity'; net: Net };

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    let root = this.parent.get(key) ?? key;
    if (!this.parent.has(key)) this.parent.set(key, key);
    while (root !== this.parent.get(root)) root = this.parent.get(root)!;
    this.parent.set(key, root);
    return root;
  }

  union(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b));
  }
}

type Resolve = (ref: ModuleRef) => ModuleDef | undefined;

/** The `NetTerminal.key` of the terminal a wire end points at, whether or not that terminal exists. */
export function terminalKey(schematic: Project['schematic'], ref: { node: string; terminal: string }): string | undefined {
  const node = schematic.nodes.find((n) => n.id === ref.node);
  if (!node) return undefined;
  return node.kind === 'module' ? `p:${node.placementId}/${ref.terminal}` : `n:${node.id}/${ref.terminal}`;
}

/**
 * Every comb pin sits over one unit of the rail and touches the first terminal of a compatible
 * family on its side at that unit. A phase pin never touches N or PE terminals, and vice versa.
 */
export function combContacts(panel: Project['panel'], resolve: Resolve): CombContact[] {
  const contacts: CombContact[] = [];
  for (const comb of panel.combs) {
    const def = resolve(comb.module);
    if (!def?.comb) continue;
    const { pattern, side } = def.comb;
    for (let offset = 0; offset < (comb.widthUnits ?? def.widthUnits); offset++) {
      const unit = comb.slot + offset;
      const pin = pattern[offset % pattern.length]!;
      for (const placement of panel.placements) {
        const placed = placement.rail === comb.rail ? resolve(placement.module) : undefined;
        if (!placed) continue;
        const terminal = terminalsOf(placed, placement.widthUnits ?? placed.widthUnits).find(
          (t) =>
            t.side === side &&
            placement.slot + Math.floor(t.unit + 0.5) === unit &&
            familyOf(t.conductor) === familyOf(pin),
        );
        if (terminal) contacts.push({ combId: comb.id, pin, placementId: placement.id, terminalId: terminal.id });
      }
    }
  }
  return contacts;
}

/**
 * Groups the terminals that are electrically one conductor: through wires, through the inside of
 * terminal bars, and through comb pins of the same conductor. Nets of a single terminal are left out.
 */
export function buildNets(project: Project, resolve: Resolve): Net[] {
  const { panel, schematic } = project;
  const all = new Map<string, NetTerminal>();
  const uf = new UnionFind();

  for (const placement of panel.placements) {
    const def = resolve(placement.module);
    if (!def) continue;
    const byNet = new Map<string, string>();
    for (const terminal of terminalsOf(def, placement.widthUnits ?? def.widthUnits)) {
      const key = `p:${placement.id}/${terminal.id}`;
      all.set(key, { key, owner: { kind: 'placement', id: placement.id }, terminal });
      if (!terminal.net) continue;
      const first = byNet.get(terminal.net);
      if (first) uf.union(first, key);
      else byNet.set(terminal.net, key);
    }
  }
  for (const node of schematic.nodes) {
    if (node.kind === 'module') continue;
    for (const terminal of freeNodeTerminals(node)) {
      const key = `n:${node.id}/${terminal.id}`;
      all.set(key, { key, owner: { kind: 'node', id: node.id }, terminal });
    }
  }

  const keyOf = (ref: { node: string; terminal: string }): string | undefined => {
    const key = terminalKey(schematic, ref);
    return key !== undefined && all.has(key) ? key : undefined;
  };
  for (const wire of schematic.wires) {
    const a = keyOf(wire.a);
    const b = keyOf(wire.b);
    if (a && b) uf.union(a, b);
  }
  for (const contact of combContacts(panel, resolve)) {
    uf.union(`p:${contact.placementId}/${contact.terminalId}`, `comb:${contact.combId}/${contact.pin}`);
  }

  const groups = new Map<string, NetTerminal[]>();
  for (const terminal of all.values()) {
    const root = uf.find(terminal.key);
    groups.set(root, [...(groups.get(root) ?? []), terminal]);
  }
  return [...groups.values()]
    .filter((terminals) => terminals.length > 1)
    .map((terminals) => ({ terminals }))
    .sort((a, b) => a.terminals[0]!.key.localeCompare(b.terminals[0]!.key));
}

/** A net that joins different families is a short circuit; so are two different fixed phases or DC plus and minus. */
export function findNetProblems(nets: Net[]): NetProblem[] {
  const problems: NetProblem[] = [];
  for (const net of nets) {
    const conductors = net.terminals.map((t) => t.terminal.conductor);
    if (new Set(conductors.map(familyOf)).size > 1) {
      problems.push({ kind: 'mixed-families', net });
    } else if (new Set(conductors.filter((c) => c === 'L1' || c === 'L2' || c === 'L3')).size > 1) {
      problems.push({ kind: 'mixed-phases', net });
    } else if (conductors.includes('DCP') && conductors.includes('DCN')) {
      problems.push({ kind: 'mixed-polarity', net });
    }
  }
  return problems;
}
