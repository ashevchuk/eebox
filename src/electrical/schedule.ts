import type { Project } from '../project';
import { cell } from '../project/bom';
import { DEFAULT_CABLE_SETTINGS, type CableSettings, type InstallMethod } from './cables';
import type { Conductor } from '../library/types';
import { formatAmps, loadReports, wireCurrents } from './loads';
import { nodeTerminalsLookup } from './nodeTerminals';
import { ownerName } from './rules';
import type { Resolve } from './context';

/** One load with what feeds it and the cable that was chosen or is needed. */
export interface CircuitRow {
  nodeId: string;
  load: string;
  powerW: number;
  currentA: number;
  /** The module the load hangs on, with its rating. */
  breaker?: string;
  breakerA?: number;
  method: InstallMethod;
  /** Conductors in the cable, earth included. */
  cores: number;
  lengthM?: number;
  chosenSectionMm2?: number;
  minimumSectionMm2?: number;
  ampacityA?: number;
  dropPercent?: number;
}

export function circuitSchedule(project: Project, resolve: Resolve, settings: CableSettings = DEFAULT_CABLE_SETTINGS): CircuitRow[] {
  return loadReports(project, resolve, settings).flatMap((report): CircuitRow[] => {
    const node = project.schematic.nodes.find((n) => n.id === report.nodeId);
    if (!node?.load) return [];
    return [
      {
        nodeId: node.id,
        load: node.label,
        powerW: node.load.powerW,
        currentA: report.currentA,
        method: report.method,
        cores: node.conductors?.length ?? 0,
        ...(report.breakerPlacementId
          ? { breaker: ownerName(project, resolve, { kind: 'placement', id: report.breakerPlacementId }) }
          : {}),
        ...(report.breakerA !== undefined ? { breakerA: report.breakerA } : {}),
        ...(report.lengthM !== undefined ? { lengthM: report.lengthM } : {}),
        ...(report.chosenSectionMm2 !== undefined ? { chosenSectionMm2: report.chosenSectionMm2 } : {}),
        ...(report.minimumSectionMm2 !== undefined ? { minimumSectionMm2: report.minimumSectionMm2 } : {}),
        ...(report.chosenAmpacityA !== undefined ? { ampacityA: report.chosenAmpacityA } : {}),
        ...(report.dropPercent !== undefined ? { dropPercent: report.dropPercent } : {}),
      },
    ];
  });
}

export interface FerruleRow {
  /** Null for wires whose cross-section is not known. */
  sectionMm2: number | null;
  quantity: number;
}

/**
 * Ferrules needed: two per wire, one on each end, of the size of the wire's own cross-section or,
 * when it has none, of the cable of the load it leads to. The sizes come first, the unknown last.
 */
export function ferruleCounts(project: Project): FerruleRow[] {
  const { nodes, wires } = project.schematic;
  const loadSection = (nodeId: string) => nodes.find((n) => n.id === nodeId && n.kind === 'load')?.load?.crossSectionMm2;
  const counts = new Map<number | null, number>();
  for (const wire of wires) {
    const section = wire.crossSectionMm2 ?? loadSection(wire.a.node) ?? loadSection(wire.b.node) ?? null;
    counts.set(section, (counts.get(section) ?? 0) + 2);
  }
  return [...counts]
    .map(([sectionMm2, quantity]): FerruleRow => ({ sectionMm2, quantity }))
    .sort((a, b) => (a.sectionMm2 ?? Infinity) - (b.sectionMm2 ?? Infinity));
}

export const CIRCUIT_HEADER = [
  'Load', 'Power (W)', 'Current (A)', 'Breaker', 'Breaker (A)', 'Laying method', 'Cores', 'Length (m)',
  'Cable (mm2)', 'Minimum (mm2)', 'Carries (A)', 'Voltage drop (%)',
] as const;

export const circuitCells = (row: CircuitRow): string[] => [
  row.load,
  String(row.powerW),
  formatAmps(row.currentA),
  row.breaker ?? '',
  row.breakerA === undefined ? '' : String(row.breakerA),
  row.method,
  String(row.cores),
  row.lengthM === undefined ? '' : String(row.lengthM),
  row.chosenSectionMm2 === undefined ? '' : String(row.chosenSectionMm2),
  row.minimumSectionMm2 === undefined ? '' : String(row.minimumSectionMm2),
  row.ampacityA === undefined ? '' : String(row.ampacityA),
  row.dropPercent === undefined ? '' : row.dropPercent.toFixed(1),
];

export const ferruleCells = (row: FerruleRow): string[] => [row.sectionMm2 === null ? 'not specified' : String(row.sectionMm2), String(row.quantity)];

/** The circuits, then a blank line and the ferrules; text from labels is escaped against spreadsheet formulas. */
export function scheduleToCsv(circuits: CircuitRow[], ferrules: FerruleRow[]): string {
  const line = (cells: readonly string[]) => cells.map(cell).join(',');
  return `${[
    line(CIRCUIT_HEADER),
    ...circuits.map((row) => line(circuitCells(row))),
    '',
    line(['Ferrule (mm2)', 'Quantity']),
    ...ferrules.map((row) => line(ferruleCells(row))),
  ].join('\r\n')}\r\n`;
}

/** One wire, as a fitter wants it listed: where it starts, where it ends and what it is. */
export interface WireRow {
  wireId: string;
  label?: string;
  from: string;
  to: string;
  conductor: Conductor;
  sectionMm2?: number;
  lengthM?: number;
  currentA?: number;
}

/**
 * Every wire with its ends named by the label of the module or node and the label or name of the
 * terminal. The cross-section is the wire's own or that of the cable of the load it leads to, and the
 * length that of the load's cable.
 */
export function wireList(project: Project, resolve: Resolve): WireRow[] {
  const { schematic, panel } = project;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const currents = wireCurrents(project, resolve);
  const loadOf = (nodeId: string) => schematic.nodes.find((n) => n.id === nodeId && n.kind === 'load')?.load;

  const end = (ref: { node: string; terminal: string }): { text: string; conductor?: Conductor } => {
    const node = schematic.nodes.find((n) => n.id === ref.node);
    if (!node) return { text: `${ref.node} ${ref.terminal}` };
    const terminal = terminalsOf(node)?.find((t) => t.id === ref.terminal);
    const placement = node.kind === 'module' ? panel.placements.find((p) => p.id === node.placementId) : undefined;
    const name = placement?.terminalLabels?.[ref.terminal] ?? terminal?.name ?? ref.terminal;
    const side = ref.terminal.split(':')[0];
    return { text: `${placement?.label ?? node.label} ${name} (${side})`, ...(terminal ? { conductor: terminal.conductor } : {}) };
  };

  return schematic.wires.map((wire): WireRow => {
    const from = end(wire.a);
    const to = end(wire.b);
    const load = loadOf(wire.a.node) ?? loadOf(wire.b.node);
    const sectionMm2 = wire.crossSectionMm2 ?? load?.crossSectionMm2;
    const currentA = currents.get(wire.id);
    return {
      wireId: wire.id,
      ...(wire.label ? { label: wire.label } : {}),
      from: from.text,
      to: to.text,
      conductor: from.conductor ?? to.conductor ?? 'L',
      ...(sectionMm2 !== undefined ? { sectionMm2 } : {}),
      ...(load?.lengthM !== undefined ? { lengthM: load.lengthM } : {}),
      ...(currentA !== undefined ? { currentA } : {}),
    };
  });
}

export const WIRE_HEADER = ['Wire', 'Label', 'From', 'To', 'Conductor', 'Cross-section (mm2)', 'Length (m)', 'Current (A)'] as const;

export const wireCells = (row: WireRow): string[] => [
  row.wireId,
  row.label ?? '',
  row.from,
  row.to,
  row.conductor,
  row.sectionMm2 === undefined ? '' : String(row.sectionMm2),
  row.lengthM === undefined ? '' : String(row.lengthM),
  row.currentA === undefined ? '' : formatAmps(row.currentA),
];

export function wireListToCsv(rows: WireRow[]): string {
  const line = (cells: readonly string[]) => cells.map(cell).join(',');
  return `${[line(WIRE_HEADER), ...rows.map((row) => line(wireCells(row)))].join('\r\n')}\r\n`;
}
