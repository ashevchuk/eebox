import { familyOf } from '../library/types';
import type { Project } from '../project';
import {
  ampacityA,
  CROSS_SECTIONS_MM2,
  DEFAULT_CABLE_SETTINGS,
  INSTALL_METHODS,
  minimumSectionMm2,
  type CableSettings,
  type InstallMethod,
  type LoadedConductors,
} from './cables';
import { Components, netContextOf, PASSIVE_KINDS, type Resolve } from './context';
import { buildNets, terminalKey } from './nets';
import { freeNodeTerminals } from './nodeTerminals';
import type { Terminal } from './terminals';
import type { SchematicNode } from '../schematic/model';

/** What a load draws and how its cable is laid. Only the power is required. */
export const CIRCUIT_KINDS = ['other', 'lighting'] as const;
export type CircuitKind = (typeof CIRCUIT_KINDS)[number];

export interface LoadSpec {
  powerW: number;
  powerFactor?: number;
  method?: InstallMethod;
  crossSectionMm2?: number;
  /** Length of the cable from the panel to the load, in metres; needed for the voltage drop. */
  lengthM?: number;
  /** Lighting circuits have a stricter voltage drop limit. */
  circuit?: CircuitKind;
}

export const PHASE_VOLTAGE_V = 230;
export const LINE_VOLTAGE_V = 400;
export const DEFAULT_POWER_FACTOR = 1;
export const DEFAULT_INSTALL_METHOD: InstallMethod = 'C';
export const MAX_POWER_W = 10_000_000;
export const MIN_POWER_FACTOR = 0.1;
export const MAX_CABLE_LENGTH_M = 1000;

/** Breakers and RCBOs are the modules whose rating protects the cable behind them. */
export const PROTECTIVE_KINDS = ['breaker', 'rcbo'];

export function loadSpecProblem(spec: LoadSpec): string | null {
  if (!Number.isFinite(spec.powerW) || spec.powerW <= 0 || spec.powerW > MAX_POWER_W) {
    return `power must be above 0 and at most ${MAX_POWER_W} W`;
  }
  const { powerFactor, method, crossSectionMm2, lengthM, circuit } = spec;
  if (powerFactor !== undefined && !(powerFactor >= MIN_POWER_FACTOR && powerFactor <= 1)) {
    return `power factor must be from ${MIN_POWER_FACTOR} to 1`;
  }
  if (method !== undefined && !INSTALL_METHODS.includes(method)) return `method must be one of ${INSTALL_METHODS.join(', ')}`;
  if (crossSectionMm2 !== undefined && !(CROSS_SECTIONS_MM2 as readonly number[]).includes(crossSectionMm2)) {
    return `cross-section must be one of ${CROSS_SECTIONS_MM2.join(', ')} mm2`;
  }
  if (lengthM !== undefined && !(lengthM > 0 && lengthM <= MAX_CABLE_LENGTH_M)) {
    return `length must be above 0 and at most ${MAX_CABLE_LENGTH_M} m`;
  }
  if (circuit !== undefined && !CIRCUIT_KINDS.includes(circuit)) return `circuit must be one of ${CIRCUIT_KINDS.join(', ')}`;
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

/**
 * Voltage drop of a final circuit as a percentage of the phase voltage, by the simplified formula of
 * IEC 60364-5-52: b * I * L * (R cos(phi) + X sin(phi)), with b = 2 for single phase and 1 for
 * three phase, R the resistance per metre of the cable and X its reactance.
 */
export function voltageDropPercent(
  node: SchematicNode,
  sectionMm2: number,
  settings: CableSettings = DEFAULT_CABLE_SETTINGS,
): number | undefined {
  const current = loadCurrentA(node);
  const length = node.load?.lengthM;
  if (current === undefined || length === undefined) return undefined;
  const powerFactor = node.load?.powerFactor ?? DEFAULT_POWER_FACTOR;
  const sine = Math.sqrt(Math.max(0, 1 - powerFactor * powerFactor));
  const resistance = settings.resistivityOhmMm2PerM / sectionMm2;
  const b = phaseConductors(node).length === 1 ? 2 : 1;
  const drop = b * current * length * (resistance * powerFactor + settings.reactanceOhmPerM * sine);
  return (drop / PHASE_VOLTAGE_V) * 100;
}

export function voltageDropLimitPercent(node: SchematicNode, settings: CableSettings = DEFAULT_CABLE_SETTINGS): number {
  return settings.voltageDropLimitPercent[node.load?.circuit ?? 'other'];
}

export const formatAmps = (amps: number): string => String(Number(amps.toFixed(1)));

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
    const terminalAt = (key: string | undefined) => (key === undefined ? undefined : context.netOf.get(key)?.terminals.find((t) => t.key === key)?.terminal);
    const carriesPhase = [a, b].some((key) => {
      const terminal = terminalAt(key);
      return terminal !== undefined && isPhase(terminal);
    });
    return a !== undefined && b !== undefined && carriesPhase ? [{ id: wire.id, a, b }] : [];
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
  /** Smallest cross-section that carries `requiredA`, before the voltage drop is taken into account. */
  minimumByCurrentMm2?: number;
  chosenSectionMm2?: number;
  chosenAmpacityA?: number;
  lengthM?: number;
  dropLimitPercent: number;
  /** Voltage drop at the chosen cross-section, or at the minimum one when none is chosen. */
  dropPercent?: number;
  /** The module the load hangs on, so a schedule can name its breaker. */
  breakerPlacementId?: string;
}

export function loadReports(project: Project, resolve: Resolve, settings: CableSettings = DEFAULT_CABLE_SETTINGS): LoadReport[] {
  const context = netContextOf(project, resolve);
  return project.schematic.nodes.flatMap((node): LoadReport[] => {
    const currentA = loadCurrentA(node);
    const loaded = loadedConductorsOf(node);
    if (currentA === undefined || loaded === undefined || !node.load) return [];
    const firstPhase = freeNodeTerminals(node).find((t) => familyOf(t.conductor) === 'phase');
    const net = firstPhase && context.netOf.get(`n:${node.id}/${firstPhase.id}`);
    const breakers = (net?.terminals ?? []).flatMap((t) => {
      const def = t.owner.kind === 'placement' ? context.defs.get(t.owner.id) : undefined;
      return t.terminal.side === 'bottom' && def && PROTECTIVE_KINDS.includes(def.kind) && def.ratedCurrentA
        ? [{ placementId: t.owner.id, ratedA: def.ratedCurrentA }]
        : [];
    });
    const breaker = breakers.reduce<(typeof breakers)[number] | undefined>((lowest, b) => (!lowest || b.ratedA < lowest.ratedA ? b : lowest), undefined);
    const requiredA = Math.max(currentA, breaker?.ratedA ?? 0);
    const method = node.load.method ?? DEFAULT_INSTALL_METHOD;
    const chosenSectionMm2 = node.load.crossSectionMm2;
    const limit = voltageDropLimitPercent(node, settings);
    const withinLimit = (section: number) => (voltageDropPercent(node, section, settings) ?? 0) <= limit;
    const minimumByCurrent = minimumSectionMm2(method, loaded, requiredA, settings);
    const minimum = minimumSectionMm2(method, loaded, requiredA, settings, withinLimit);
    const chosenAmpacityA = chosenSectionMm2 === undefined ? undefined : ampacityA(method, loaded, chosenSectionMm2, settings);
    const dropSection = chosenSectionMm2 ?? minimum;
    const dropPercent = dropSection === undefined ? undefined : voltageDropPercent(node, dropSection, settings);
    return [
      {
        nodeId: node.id,
        currentA,
        loaded,
        method,
        requiredA,
        dropLimitPercent: limit,
        ...(breaker ? { breakerA: breaker.ratedA, breakerPlacementId: breaker.placementId } : {}),
        ...(minimum !== undefined ? { minimumSectionMm2: minimum } : {}),
        ...(minimumByCurrent !== undefined ? { minimumByCurrentMm2: minimumByCurrent } : {}),
        ...(chosenSectionMm2 !== undefined ? { chosenSectionMm2 } : {}),
        ...(chosenAmpacityA !== undefined ? { chosenAmpacityA } : {}),
        ...(node.load.lengthM !== undefined ? { lengthM: node.load.lengthM } : {}),
        ...(dropPercent !== undefined ? { dropPercent } : {}),
      },
    ];
  });
}
