import type { Project } from '../project';
import { cell } from '../project/bom';
import { DEFAULT_CABLE_SETTINGS, type CableSettings, type InstallMethod } from './cables';
import { formatAmps, loadReports } from './loads';
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
