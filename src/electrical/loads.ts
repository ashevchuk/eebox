import { familyOf } from '../library/types';
import type { Project } from '../project';
import {
  ampacityA,
  CROSS_SECTIONS_MM2,
  INSTALL_METHODS,
  minimumSectionMm2,
  type InstallMethod,
  type LoadedConductors,
} from './cables';
import { netContextOf, PASSIVE_KINDS, type Resolve } from './context';
import { buildNets, terminalKey } from './nets';
import { freeNodeTerminals } from './nodeTerminals';
import type { Terminal } from './terminals';
import type { SchematicNode } from '../schematic/model';

/** What a load draws and how its cable is laid. Only the power is required. */
export interface LoadSpec {
  powerW: number;
  powerFactor?: number;
  method?: InstallMethod;
  crossSectionMm2?: number;
}

export const PHASE_VOLTAGE_V = 230;
export const LINE_VOLTAGE_V = 400;
export const DEFAULT_POWER_FACTOR = 1;
export const DEFAULT_INSTALL_METHOD: InstallMethod = 'C';
export const MAX_POWER_W = 10_000_000;
export const MIN_POWER_FACTOR = 0.1;

/** Breakers and RCBOs are the modules whose rating protects the cable behind them. */
const PROTECTIVE_KINDS = ['breaker', 'rcbo'];

export function loadSpecProblem(spec: LoadSpec): string | null {
  if (!Number.isFinite(spec.powerW) || spec.powerW <= 0 || spec.powerW > MAX_POWER_W) {
    return `power must be above 0 and at most ${MAX_POWER_W} W`;
  }
  const { powerFactor, method, crossSectionMm2 } = spec;
  if (powerFactor !== undefined && !(powerFactor >= MIN_POWER_FACTOR && powerFactor <= 1)) {
    return `power factor must be from ${MIN_POWER_FACTOR} to 1`;
  }
  if (method !== undefined && !INSTALL_METHODS.includes(method)) return `method must be one of ${INSTALL_METHODS.join(', ')}`;
  if (crossSectionMm2 !== undefined && !(CROSS_SECTIONS_MM2 as readonly number[]).includes(crossSectionMm2)) {
    return `cross-section must be one of ${CROSS_SECTIONS_MM2.join(', ')} mm2`;
  }
  return null;
}

const phaseConductors = (node: SchematicNode) => (node.conductors ?? []).filter((c) => familyOf(c) === 'phase');

/** Single-phase and balanced three-phase loads are supported; anything else has no current. */
export function loadedConductorsOf(node: SchematicNode): LoadedConductors | undefined {
  const phases = phaseConductors(node).length;
  return phases === 1 ? 2 : phases === 3 ? 3 : undefined;
}

export function loadCurrentA(node: SchematicNode): number | undefined {
  if (node.kind !== 'load' || !node.load) return undefined;
  const { powerW, powerFactor = DEFAULT_POWER_FACTOR } = node.load;
  const phases = phaseConductors(node).length;
  if (phases === 1) return powerW / (PHASE_VOLTAGE_V * powerFactor);
  if (phases === 3) return powerW / (Math.sqrt(3) * LINE_VOLTAGE_V * powerFactor);
  return undefined;
}

export const formatAmps = (amps: number): string => String(Number(amps.toFixed(1)));

class Components {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    let root = this.parent.get(key) ?? key;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root)!;
    this.parent.set(key, root);
    return root;
  }

  join(a: string, b: string): void {
    this.parent.set(this.find(a), this.find(b));
  }
}

/**
 * The current each phase wire carries: the load current on the side of the wire that is cut off
 * from every source when the wire is taken away. Terminals are joined by the other wires, by bars
 * and combs, and through a module from its top to its bottom terminal of the same conductor.
 * A wire in a loop, or one that has a source on both sides, has no single current and is left out;
 * so are currents behind a phase bar, which passes current without being followed.
 */
export function wireCurrents(project: Project, resolve: Resolve): Map<string, number> {
  const { schematic } = project;
  const context = netContextOf(project, resolve);
  const rigid = buildNets({ ...project, schematic: { ...schematic, wires: [] } }, resolve);
  const isPhase = (t: Terminal) => familyOf(t.conductor) === 'phase';

  const joins: [string, string][] = rigid.flatMap((net) => net.terminals.slice(1).map((t): [string, string] => [net.terminals[0]!.key, t.key]));
  for (const [id, terminals] of context.terminals) {
    const def = context.defs.get(id);
    if (!def || PASSIVE_KINDS.includes(def.kind)) continue;
    for (const top of terminals.filter((t) => t.terminal.side === 'top' && isPhase(t.terminal))) {
      for (const bottom of terminals.filter((t) => t.terminal.side === 'bottom' && t.terminal.conductor === top.terminal.conductor)) {
        joins.push([top.key, bottom.key]);
      }
    }
  }

  const sources = new Set<string>();
  const drawn = new Map<string, number>();
  for (const node of schematic.nodes) {
    const amps = loadCurrentA(node);
    for (const t of freeNodeTerminals(node).filter(isPhase)) {
      const key = `n:${node.id}/${t.id}`;
      if (node.kind === 'source') sources.add(key);
      if (amps !== undefined) drawn.set(key, amps);
    }
  }

  const phaseWires = schematic.wires.flatMap((wire) => {
    const a = terminalKey(schematic, wire.a);
    const b = terminalKey(schematic, wire.b);
    const terminal = a === undefined ? undefined : context.netOf.get(a)?.terminals.find((t) => t.key === a)?.terminal;
    return a !== undefined && b !== undefined && terminal && isPhase(terminal) ? [{ id: wire.id, a, b }] : [];
  });
  const endpoints = (wire: { a: string; b: string }): [string, string] => [wire.a, wire.b];

  const result = new Map<string, number>();
  for (const wire of phaseWires) {
    const components = new Components();
    for (const [x, y] of joins) components.join(x, y);
    for (const other of phaseWires) if (other.id !== wire.id) components.join(...endpoints(other));
    const [rootA, rootB] = endpoints(wire).map((key) => components.find(key)) as [string, string];
    if (rootA === rootB) continue;
    const supplied = new Set([...sources].map((key) => components.find(key)));
    if (supplied.has(rootA) === supplied.has(rootB)) continue;
    const cutOff = supplied.has(rootA) ? rootB : rootA;
    let amps = 0;
    for (const [key, value] of drawn) if (components.find(key) === cutOff) amps += value;
    if (amps > 0) result.set(wire.id, amps);
  }
  return result;
}

export interface LoadReport {
  nodeId: string;
  currentA: number;
  loaded: LoadedConductors;
  method: InstallMethod;
  /** Rating of the breaker or RCBO the load hangs on, when one is wired directly to it. */
  breakerA?: number;
  /** The current a cable has to carry: the load current, or the breaker rating when that is higher. */
  requiredA: number;
  /** Smallest listed cross-section for `requiredA`; undefined when the table has none large enough. */
  minimumSectionMm2?: number;
  chosenSectionMm2?: number;
  chosenAmpacityA?: number;
}

export function loadReports(project: Project, resolve: Resolve): LoadReport[] {
  const context = netContextOf(project, resolve);
  return project.schematic.nodes.flatMap((node): LoadReport[] => {
    const currentA = loadCurrentA(node);
    const loaded = loadedConductorsOf(node);
    if (currentA === undefined || loaded === undefined || !node.load) return [];
    const firstPhase = freeNodeTerminals(node).find((t) => familyOf(t.conductor) === 'phase');
    const net = firstPhase && context.netOf.get(`n:${node.id}/${firstPhase.id}`);
    const ratings = (net?.terminals ?? []).flatMap((t) => {
      const def = t.owner.kind === 'placement' ? context.defs.get(t.owner.id) : undefined;
      return t.terminal.side === 'bottom' && def && PROTECTIVE_KINDS.includes(def.kind) && def.ratedCurrentA ? [def.ratedCurrentA] : [];
    });
    const breakerA = ratings.length > 0 ? Math.min(...ratings) : undefined;
    const requiredA = Math.max(currentA, breakerA ?? 0);
    const method = node.load.method ?? DEFAULT_INSTALL_METHOD;
    const chosenSectionMm2 = node.load.crossSectionMm2;
    const minimum = minimumSectionMm2(method, loaded, requiredA);
    const chosenAmpacityA = chosenSectionMm2 === undefined ? undefined : ampacityA(method, loaded, chosenSectionMm2);
    return [
      {
        nodeId: node.id,
        currentA,
        loaded,
        method,
        requiredA,
        ...(breakerA !== undefined ? { breakerA } : {}),
        ...(minimum !== undefined ? { minimumSectionMm2: minimum } : {}),
        ...(chosenSectionMm2 !== undefined ? { chosenSectionMm2 } : {}),
        ...(chosenAmpacityA !== undefined ? { chosenAmpacityA } : {}),
      },
    ];
  });
}
