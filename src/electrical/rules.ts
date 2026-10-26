import type { ModuleRef } from '../layout/placement';
import { familyOf, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import { buildNets, type Net, type NetTerminal } from './nets';
import { freeNodeTerminals } from './nodeTerminals';
import { terminalsOf, type Terminal } from './terminals';

type Resolve = (ref: ModuleRef) => ModuleDef | undefined;
type Owner = NetTerminal['owner'];

const PASSIVE_KINDS: readonly ModuleDef['kind'][] = ['busbar', 'terminal'];
const RESIDUAL_CURRENT_KINDS: readonly ModuleDef['kind'][] = ['rcd', 'rcbo'];

/** The label a user gave an owner of terminals, or the name of its module. */
export function ownerName(project: Project, resolve: Resolve, owner: Owner): string {
  if (owner.kind === 'node') return project.schematic.nodes.find((n) => n.id === owner.id)?.label ?? owner.id;
  const placement = project.panel.placements.find((p) => p.id === owner.id);
  return placement?.label ?? (placement && resolve(placement.module)?.name) ?? owner.id;
}

const isPhase = (terminal: Terminal): boolean => familyOf(terminal.conductor) === 'phase';

interface Context {
  project: Project;
  nets: Net[];
  netOf: Map<string, Net>;
  /** Placed modules whose definition is known, by placement id. */
  defs: Map<string, ModuleDef>;
  /** Terminals of each placed module with their net keys. */
  terminals: Map<string, { key: string; terminal: Terminal }[]>;
  name: (owner: Owner) => string;
}

function contextOf(project: Project, resolve: Resolve): Context {
  const nets = buildNets(project, resolve);
  const netOf = new Map<string, Net>();
  for (const net of nets) for (const t of net.terminals) netOf.set(t.key, net);
  const defs = new Map<string, ModuleDef>();
  const terminals = new Map<string, { key: string; terminal: Terminal }[]>();
  for (const placement of project.panel.placements) {
    const def = resolve(placement.module);
    if (!def) continue;
    defs.set(placement.id, def);
    terminals.set(
      placement.id,
      terminalsOf(def, placement.widthUnits ?? def.widthUnits).map((terminal) => ({
        key: `p:${placement.id}/${terminal.id}`,
        terminal,
      })),
    );
  }
  return { project, nets, netOf, defs, terminals, name: (owner) => ownerName(project, resolve, owner) };
}

/**
 * Design rules that a wiring can break without being wrong in itself. They are advice, so the
 * result is a list of messages and never prevents anything.
 */
export function findRuleWarnings(project: Project, resolve: Resolve): string[] {
  const context = contextOf(project, resolve);
  return [
    ...openEarth(context),
    ...unfedModules(context),
    ...overloadedModules(context),
    ...loadsWithoutResidualCurrentProtection(context),
  ];
}

function openEarth({ project, netOf, name }: Context): string[] {
  return project.schematic.nodes.flatMap((node) => {
    if (node.kind !== 'load') return [];
    const earth = freeNodeTerminals(node).find((t) => t.conductor === 'PE');
    return earth && !netOf.has(`n:${node.id}/${earth.id}`)
      ? [`${name({ kind: 'node', id: node.id })} [${node.id}]: protective earth is not connected`]
      : [];
  });
}

function unfedModules({ project, netOf, defs, terminals, name }: Context): string[] {
  return project.panel.placements.flatMap((placement) => {
    const def = defs.get(placement.id);
    if (!def || PASSIVE_KINDS.includes(def.kind)) return [];
    const used = (side: Terminal['side']) =>
      terminals.get(placement.id)!.some((t) => t.terminal.side === side && netOf.has(t.key));
    return used('bottom') && !used('top')
      ? [`${name({ kind: 'placement', id: placement.id })} [${placement.id}]: its outputs are connected but its input is not fed`]
      : [];
  });
}

/** Per phase, the modules fed through a module's outputs must not draw more than the module is rated for. */
function overloadedModules({ project, nets, defs, name }: Context): string[] {
  return project.panel.placements.flatMap((placement) => {
    const rating = defs.get(placement.id)?.ratedCurrentA;
    if (!rating) return [];
    let worst = 0;
    for (const net of nets) {
      const suppliesPhase = net.terminals.some(
        (t) => t.owner.id === placement.id && t.terminal.side === 'bottom' && isPhase(t.terminal),
      );
      if (!suppliesPhase) continue;
      const drawn = new Map<string, number>();
      for (const t of net.terminals) {
        const consumer = t.owner.kind === 'placement' && t.owner.id !== placement.id ? defs.get(t.owner.id) : undefined;
        if (consumer?.ratedCurrentA && !PASSIVE_KINDS.includes(consumer.kind) && t.terminal.side === 'top' && isPhase(t.terminal)) {
          drawn.set(t.owner.id, consumer.ratedCurrentA);
        }
      }
      worst = Math.max(worst, [...drawn.values()].reduce((a, b) => a + b, 0));
    }
    return worst > rating
      ? [`${name({ kind: 'placement', id: placement.id })} [${placement.id}]: the modules it feeds add up to ${worst} A on one phase, above its rating of ${rating} A`]
      : [];
  });
}

function loadsWithoutResidualCurrentProtection({ project, netOf, defs, terminals, name }: Context): string[] {
  const reachesSource = (net: Net, seen: Set<Net>): boolean => {
    if (seen.has(net)) return false;
    seen.add(net);
    return net.terminals.some((t) => {
      if (t.terminal.side !== 'bottom') return false;
      if (t.owner.kind === 'node') return project.schematic.nodes.find((n) => n.id === t.owner.id)?.kind === 'source';
      const def = defs.get(t.owner.id);
      if (!def || RESIDUAL_CURRENT_KINDS.includes(def.kind)) return false;
      return (terminals.get(t.owner.id) ?? []).some((input) => {
        const upstream = input.terminal.side === 'top' && isPhase(input.terminal) ? netOf.get(input.key) : undefined;
        return upstream !== undefined && reachesSource(upstream, seen);
      });
    });
  };

  return project.schematic.nodes.flatMap((node) => {
    if (node.kind !== 'load') return [];
    const fed = freeNodeTerminals(node)
      .filter(isPhase)
      .flatMap((t) => netOf.get(`n:${node.id}/${t.id}`) ?? []);
    return fed.some((net) => reachesSource(net, new Set()))
      ? [`${name({ kind: 'node', id: node.id })} [${node.id}]: it is fed without passing an RCD or RCBO`]
      : [];
  });
}
