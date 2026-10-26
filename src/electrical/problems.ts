import type { CableSettings } from './cables';
import type { Project } from '../project';
import { computeLayout } from '../schematic/geometry';
import { findOverlaps, TOUCH_MM } from '../schematic/overlaps';
import { routeWires } from '../schematic/router';
import { nodeTerminalsLookup } from './nodeTerminals';
import { wireList } from './schedule';
import { familyOf, type Conductor } from '../library/types';
import type { Resolve } from './context';
import { energy, type ParallelSources, type ShortCircuit } from './energy';
import { buildNets, findNetProblems, terminalKey } from './nets';
import { findRuleFindings, ownerName } from './rules';

export const NET_PROBLEM_TEXT = {
  'mixed-phases': 'different phases joined',
  'mixed-polarity': 'DC plus and minus joined',
  'mixed-families': 'phase, neutral, earth or control conductors joined',
} as const;

/**
 * Something to mark on the drawings, with the wires, the nodes and the placed modules that take part
 * in it. An error is a wiring fault, advice is something that is allowed but worth a look.
 */
export interface Finding {
  message: string;
  severity: 'error' | 'advice';
  wires: string[];
  nodes: string[];
  placements: string[];
}

export type ConnectionProblem = Finding;

interface Owner {
  kind: 'placement' | 'node';
  id: string;
}

/** The wires that touch any of the terminals, and the nodes and modules the terminals belong to. */
function marksOf(project: Project, keys: ReadonlySet<string>, owners: Owner[], devices: string[]): Omit<Finding, 'message' | 'severity'> {
  const { schematic } = project;
  const placements = new Set([...owners.filter((o) => o.kind === 'placement').map((o) => o.id), ...devices]);
  const nodes = new Set([
    ...owners.filter((o) => o.kind === 'node').map((o) => o.id),
    ...schematic.nodes.filter((n) => n.placementId !== undefined && placements.has(n.placementId)).map((n) => n.id),
  ]);
  const wires = schematic.wires
    .filter((w) => keys.has(terminalKey(schematic, w.a) ?? '') || keys.has(terminalKey(schematic, w.b) ?? ''))
    .map((w) => w.id);
  return { wires, nodes: [...nodes], placements: [...placements] };
}

function kindOfShort(conductors: Conductor[]): string {
  const phases = new Set(conductors.filter((c) => familyOf(c) === 'phase' && c !== 'L'));
  if (phases.size > 1) return NET_PROBLEM_TEXT['mixed-phases'];
  if (conductors.includes('DCP') && conductors.includes('DCN')) return NET_PROBLEM_TEXT['mixed-polarity'];
  return NET_PROBLEM_TEXT['mixed-families'];
}

function describeShort(project: Project, resolve: Resolve, short: ShortCircuit): string {
  const name = (owner: Owner) => `${ownerName(project, resolve, owner)} [${owner.id}]`;
  const seen = new Set<Conductor>();
  const terminals = [...short.terminals]
    .sort((a, b) => Number(a.owner.kind !== 'node') - Number(b.owner.kind !== 'node'))
    .filter((t) => t.conductor !== 'C' && !seen.has(t.conductor) && seen.add(t.conductor))
    .map((t) => `${name(t.owner)} ${t.terminalId}`);
  const through = short.devices.map((id) => name({ kind: 'placement', id })).join(', ');
  return `${kindOfShort(short.terminals.map((t) => t.conductor))} through a closed device${through ? ` (${through})` : ''}: ${terminals.join(', ')}`;
}

function describeParallel(project: Project, resolve: Resolve, parallel: ParallelSources): string {
  const names = parallel.sources.map((id) => `${ownerName(project, resolve, { kind: 'node', id })} [${id}]`);
  const through = parallel.devices.map((id) => `${ownerName(project, resolve, { kind: 'placement', id })} [${id}]`).join(', ');
  return `sources that are on are joined in parallel${through ? ` through ${through}` : ''}: ${names.join(', ')}`;
}

/**
 * Conductors that are joined when they must not be: on one net by wires, bars and combs, or through a
 * closed breaker, switch or contactor. Each comes with the wires, nodes and modules to mark.
 */
export function findConnectionProblems(project: Project, resolve: Resolve): ConnectionProblem[] {
  const fromNets = findNetProblems(buildNets(project, resolve)).map((p): ConnectionProblem => ({
    severity: 'error',
    message: `${NET_PROBLEM_TEXT[p.kind]}: ${p.net.terminals.map((t) => `${ownerName(project, resolve, t.owner)} [${t.owner.id}] ${t.terminal.id}`).join(', ')}`,
    ...marksOf(project, new Set(p.net.terminals.map((t) => t.key)), p.net.terminals.map((t) => t.owner), []),
  }));
  const fromDevices = energy(project, resolve).shorts.map((short): ConnectionProblem => ({
    severity: 'error',
    message: describeShort(project, resolve, short),
    ...marksOf(project, new Set(short.terminals.map((t) => t.key)), short.terminals.map((t) => t.owner), short.devices),
  }));
  const fromSources = energy(project, resolve).parallelSources.map((parallel): ConnectionProblem => ({
    severity: 'error',
    message: describeParallel(project, resolve, parallel),
    ...marksOf(project, new Set(parallel.terminals.map((t) => t.key)), parallel.terminals.map((t) => t.owner), parallel.devices),
  }));
  return [...fromNets, ...fromDevices, ...fromSources];
}

const withoutSide = (end: string) => end.replace(/ \((top|bottom)\)$/, '');

/** Wires drawn so close together that they look like one, with the wires to mark. */
export function findGlue(project: Project, resolve: Resolve): Finding[] {
  if (project.schematic.wires.length < 2) return [];
  const layout = computeLayout(project.schematic, nodeTerminalsLookup(project.panel, resolve));
  const overlaps = findOverlaps(routeWires(project.schematic, layout), TOUCH_MM);
  if (overlaps.length === 0) return [];
  const rows = new Map(wireList(project, resolve).map((row) => [row.wireId, row]));
  const named = (id: string) => {
    const row = rows.get(id);
    return row ? `${id} (${withoutSide(row.from)} \u2192 ${withoutSide(row.to)})` : id;
  };
  const pairs = new Map<string, [string, string]>();
  for (const o of overlaps) pairs.set([o.first.wire, o.second.wire].sort().join('+'), [o.first.wire, o.second.wire]);
  return [...pairs.values()].map(([a, b]): Finding => ({
    severity: 'advice',
    message: `wires ${named(a)} and ${named(b)} run on top of each other; Nodes > Separate overlapping wires moves them apart`,
    wires: [a, b],
    nodes: [],
    placements: [],
  }));
}

/** Everything to mark: the faults, then the advice of the rules and the wires that are stuck together. */
export function findFindings(project: Project, resolve: Resolve, settings?: CableSettings): Finding[] {
  return [
    ...findConnectionProblems(project, resolve),
    ...findRuleFindings(project, resolve, settings).map((f): Finding => ({ ...f, severity: 'advice', wires: [] })),
    ...findGlue(project, resolve),
  ];
}

/** Which of the wires, nodes or placed modules to mark and how: red for a fault, amber for advice, and a fault wins. */
export function markedBy(findings: Finding[], what: 'wires' | 'nodes' | 'placements'): Map<string, 'error' | 'advice'> {
  const marks = new Map<string, 'error' | 'advice'>();
  for (const finding of findings) {
    for (const id of finding[what]) if (finding.severity === 'error' || !marks.has(id)) marks.set(id, finding.severity);
  }
  return marks;
}
