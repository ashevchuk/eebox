import { familyOf, type ModuleDef } from '../library/types';
import type { Project } from '../project';
import { DEFAULT_CABLE_SETTINGS, type CableSettings } from './cables';
import { formatAmps, loadReports, type LoadReport } from './loads';
import { netContextOf, PASSIVE_KINDS, type NetContext, type Resolve } from './context';
import type { Net, NetTerminal } from './nets';
import { freeNodeTerminals } from './nodeTerminals';
import { directionOf, type Direction } from './direction';
import { earthingFindings } from './earthingRules';
import { protectionWarnings } from './protection';
import type { Terminal } from './terminals';

type Owner = NetTerminal['owner'];

const RESIDUAL_CURRENT_KINDS: readonly ModuleDef['kind'][] = ['rcd', 'rcbo'];

/** The label a user gave an owner of terminals, or the name of its module. */
export function ownerName(project: Project, resolve: Resolve, owner: Owner): string {
  if (owner.kind === 'node') return project.schematic.nodes.find((n) => n.id === owner.id)?.label ?? owner.id;
  const placement = project.panel.placements.find((p) => p.id === owner.id);
  return placement?.label ?? (placement && resolve(placement.module)?.name) ?? owner.id;
}

const isPhase = (terminal: Terminal): boolean => familyOf(terminal.conductor) === 'phase';

type Context = NetContext & { name: (owner: Owner) => string; direction: Direction };

function contextOf(project: Project, resolve: Resolve): Context {
  const net = netContextOf(project, resolve);
  return { ...net, name: (owner) => ownerName(project, resolve, owner), direction: directionOf(net) };
}

/** A piece of advice with what to mark on the drawings: the nodes and the placed modules it is about. */
export interface RuleFinding {
  message: string;
  nodes: string[];
  placements: string[];
  /** Which rule found it, for the rules that a summary reports on its own. */
  rule?: 'open-earth' | 'no-rcd';
}

const about = (message: string, where: { nodes?: string[]; placements?: string[] }, rule?: RuleFinding['rule']): RuleFinding => ({
  message,
  nodes: where.nodes ?? [],
  placements: where.placements ?? [],
  ...(rule ? { rule } : {}),
});

/**
 * Design rules that a wiring can break without being wrong in itself. They are advice, so the
 * result is a list of messages and never prevents anything.
 */
export function findRuleWarnings(project: Project, resolve: Resolve, settings: CableSettings = DEFAULT_CABLE_SETTINGS): string[] {
  return findRuleFindings(project, resolve, settings).map((f) => f.message);
}

/** The same advice, each with the nodes and modules it is about; a module's own node is included. */
export function findRuleFindings(project: Project, resolve: Resolve, settings: CableSettings = DEFAULT_CABLE_SETTINGS): RuleFinding[] {
  const context = contextOf(project, resolve);
  const reports = loadReports(project, resolve, settings);
  const moduleNodeOf = (placementId: string) => project.schematic.nodes.filter((n) => n.placementId === placementId).map((n) => n.id);
  return [
    ...openEarth(context),
    ...earthingFindings(project, resolve, (id) => context.name({ kind: 'node', id })),
    ...unfedModules(context),
    ...modulesFedTheWrongWay(context),
    ...overloadedModules(context),
    ...loadsWithoutResidualCurrentProtection(context),
    ...cablesAgainstBreakers(reports, context.name),
    ...surgeProtectorsWithoutEarth(context),
    ...lightningProtectorsBehindResidualCurrentDevices(context),
    ...protectionWarnings(project, resolve, settings, reports, (id) => context.name({ kind: 'node', id })),
  ].map((f) => ({ ...f, nodes: [...new Set([...f.nodes, ...f.placements.flatMap(moduleNodeOf)])] }));
}

function openEarth({ project, netOf, name }: Context): RuleFinding[] {
  return project.schematic.nodes.flatMap((node) => {
    if (node.kind !== 'load') return [];
    const earth = freeNodeTerminals(node).find((t) => t.conductor === 'PE' || t.conductor === 'PEN');
    return earth && !netOf.has(`n:${node.id}/${earth.id}`)
      ? [about(`${name({ kind: 'node', id: node.id })} [${node.id}]: protective earth is not connected`, { nodes: [node.id] }, 'open-earth')]
      : [];
  });
}

function unfedModules({ project, netOf, defs, terminals, name, direction }: Context): RuleFinding[] {
  return project.panel.placements.flatMap((placement) => {
    const def = defs.get(placement.id);
    if (!def || PASSIVE_KINDS.includes(def.kind)) return [];
    const used = (isSide: (key: string) => boolean) => terminals.get(placement.id)!.some((t) => isSide(t.key) && netOf.has(t.key));
    return used(direction.isOutput) && !used(direction.isInput)
      ? [about(`${name({ kind: 'placement', id: placement.id })} [${placement.id}]: its outputs are connected but its input is not fed`, { placements: [placement.id] })]
      : [];
  });
}

/** A device that a source reaches through its output, or from both sides at once, is wired against its design or has something going round it. */
function modulesFedTheWrongWay({ project, name, direction }: Context): RuleFinding[] {
  const finding = (placementId: string, text: string) =>
    about(`${name({ kind: 'placement', id: placementId })} [${placementId}]: ${text}`, { placements: [placementId] });
  return project.panel.placements.flatMap((placement) => [
    ...(direction.fedThroughOutput.has(placement.id) ? [finding(placement.id, 'it is fed through a terminal that its maker marks as an output')] : []),
    ...(direction.fedFromBothSides.has(placement.id) ? [finding(placement.id, 'it is fed from both of its sides, so something goes round it')] : []),
  ]);
}

/** Per phase, the modules fed through a module's outputs must not draw more than the module is rated for. */
function overloadedModules({ project, nets, defs, name, direction }: Context): RuleFinding[] {
  return project.panel.placements.flatMap((placement) => {
    const rating = defs.get(placement.id)?.ratedCurrentA;
    if (!rating || direction.fedFromBothSides.has(placement.id)) return [];
    let worst = 0;
    for (const net of nets) {
      const suppliesPhase = net.terminals.some(
        (t) => t.owner.id === placement.id && direction.isOutput(t.key) && isPhase(t.terminal),
      );
      if (!suppliesPhase) continue;
      const drawn = new Map<string, number>();
      for (const t of net.terminals) {
        const consumer = t.owner.kind === 'placement' && t.owner.id !== placement.id ? defs.get(t.owner.id) : undefined;
        if (consumer?.ratedCurrentA && !PASSIVE_KINDS.includes(consumer.kind) && direction.isInput(t.key) && isPhase(t.terminal)) {
          drawn.set(t.owner.id, consumer.ratedCurrentA);
        }
      }
      worst = Math.max(worst, [...drawn.values()].reduce((a, b) => a + b, 0));
    }
    return worst > rating
      ? [about(`${name({ kind: 'placement', id: placement.id })} [${placement.id}]: the modules it feeds add up to ${worst} A on one phase, above its rating of ${rating} A`, { placements: [placement.id] })]
      : [];
  });
}

function loadsWithoutResidualCurrentProtection({ project, netOf, defs, terminals, name, direction }: Context): RuleFinding[] {
  const reachesSource = (net: Net, seen: Set<Net>): boolean => {
    if (seen.has(net)) return false;
    seen.add(net);
    return net.terminals.some((t) => {
      if (t.owner.kind === 'placement' ? !direction.isOutput(t.key) : t.terminal.side !== 'bottom') return false;
      if (t.owner.kind === 'node') return project.schematic.nodes.find((n) => n.id === t.owner.id)?.kind === 'source';
      const def = defs.get(t.owner.id);
      if (!def || RESIDUAL_CURRENT_KINDS.includes(def.kind)) return false;
      return (terminals.get(t.owner.id) ?? []).some((input) => {
        const upstream = direction.isInput(input.key) && isPhase(input.terminal) ? netOf.get(input.key) : undefined;
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
      ? [about(`${name({ kind: 'node', id: node.id })} [${node.id}]: it is fed without passing an RCD or RCBO`, { nodes: [node.id] }, 'no-rcd')]
      : [];
  });
}

/** A surge protector shunts the surge to earth, so one whose lines are connected and whose earth terminal is not protects nothing. */
function surgeProtectorsWithoutEarth({ project, netOf, defs, terminals, name }: Context): RuleFinding[] {
  return project.panel.placements.flatMap((placement) => {
    if (defs.get(placement.id)?.kind !== 'spd') return [];
    const own = terminals.get(placement.id) ?? [];
    const wired = (t: (typeof own)[number]) => netOf.has(t.key);
    const linesWired = own.some((t) => t.terminal.conductor !== 'PE' && wired(t));
    const earthWired = own.some((t) => t.terminal.conductor === 'PE' && wired(t));
    return linesWired && !earthWired
      ? [about(`${name({ kind: 'placement', id: placement.id })} [${placement.id}]: its lines are connected but its earth terminal is not, so it protects nothing`, { placements: [placement.id] })]
      : [];
  });
}

/** Lightning current must not go through an RCD: a protector of type 1 or 1+2 belongs ahead of it, so one fed from an RCD output is in the wrong place. */
function lightningProtectorsBehindResidualCurrentDevices({ project, netOf, defs, terminals, name, direction }: Context): RuleFinding[] {
  return project.panel.placements.flatMap((placement) => {
    const def = defs.get(placement.id);
    if (def?.kind !== 'spd' || (def.spdType !== '1' && def.spdType !== '1+2')) return [];
    const behind = (terminals.get(placement.id) ?? []).some((t) => {
      if (!direction.isInput(t.key) || t.terminal.conductor === 'PE') return false;
      return (netOf.get(t.key)?.terminals ?? []).some((other) => {
        const otherDef = other.owner.kind === 'placement' ? defs.get(other.owner.id) : undefined;
        return direction.isOutput(other.key) && otherDef !== undefined && RESIDUAL_CURRENT_KINDS.includes(otherDef.kind);
      });
    });
    return behind
      ? [about(`${name({ kind: 'placement', id: placement.id })} [${placement.id}]: a type ${def.spdType} surge protector is fed from the output of an RCD; it belongs ahead of the RCD`, { placements: [placement.id] })]
      : [];
  });
}

/** What protects the cable behind it: a breaker, or a fuse, which the messages then call by its name. */
const deviceName = (report: LoadReport): string => (report.breakerKind === 'fuse' ? 'fuse' : 'breaker');

/** A circuit needs load current <= breaker rating <= what the cable carries. */
function cablesAgainstBreakers(reports: LoadReport[], name: Context['name']): RuleFinding[] {
  return reports.flatMap((report) => {
    const who = `${name({ kind: 'node', id: report.nodeId })} [${report.nodeId}]`;
    const warnings: string[] = [];
    const where = { nodes: [report.nodeId], placements: report.breakerPlacementId ? [report.breakerPlacementId] : [] };
    if (report.breakerA !== undefined && report.currentA > report.breakerA) {
      warnings.push(`${who}: it draws ${formatAmps(report.currentA)} A but its ${deviceName(report)} is rated ${report.breakerA} A`);
    }
    if (report.chosenAmpacityA !== undefined && report.chosenAmpacityA < report.requiredA) {
      const reference = report.breakerA !== undefined && report.breakerA >= report.currentA ? `the ${deviceName(report)} rating of ${report.breakerA} A` : `the load current of ${formatAmps(report.currentA)} A`;
      warnings.push(`${who}: a ${report.chosenSectionMm2} mm2 cable carries ${report.chosenAmpacityA} A, below ${reference}`);
    }
    if (report.chosenSectionMm2 !== undefined && report.dropPercent !== undefined && report.dropPercent > report.dropLimitPercent) {
      warnings.push(
        `${who}: the voltage drop over ${report.lengthM} m of ${report.chosenSectionMm2} mm2 is ${report.dropPercent.toFixed(1)} %, above the limit of ${report.dropLimitPercent} %`,
      );
    }
    if (report.minimumSectionMm2 === undefined) {
      warnings.push(
        report.minimumByCurrentMm2 === undefined
          ? `${who}: no listed cross-section carries ${formatAmps(report.requiredA)} A`
          : `${who}: no listed cross-section keeps the voltage drop within ${report.dropLimitPercent} %`,
      );
    }
    return warnings.map((message) => about(message, where));
  });
}
