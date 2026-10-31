import { wireRuns } from '../layout/wireLength';
import type { Project } from '../project';
import { cell } from '../project/bom';
import { DEFAULT_CABLE_SETTINGS, type CableSettings, type InstallMethod } from './cables';
import type { Conductor } from '../library/types';
import { formatAmps, loadReports, wireCurrents } from './loads';
import { nodeTerminalsLookup } from './nodeTerminals';
import { terminalsOf } from './terminals';
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
  /** Estimated length of the wire between its terminals on the panel, in mm; absent when an end has no place on it. */
  runMm?: number;
  currentA?: number;
}

/** Names the end of a wire by the label of its module or node and the label or name of its terminal. */
function endNamer(project: Project, resolve: Resolve): (ref: { node: string; terminal: string }) => { text: string; conductor?: Conductor } {
  const { schematic, panel } = project;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  return (ref) => {
    const node = schematic.nodes.find((n) => n.id === ref.node);
    if (!node) return { text: `${ref.node} ${ref.terminal}` };
    const terminal = terminalsOf(node)?.find((t) => t.id === ref.terminal);
    const placement = node.kind === 'module' ? panel.placements.find((p) => p.id === node.placementId) : undefined;
    const name = placement?.terminalLabels?.[ref.terminal] ?? terminal?.name ?? ref.terminal;
    const side = ref.terminal.split(':')[0];
    return { text: `${placement?.label ?? node.label} ${name} (${side})`, ...(terminal ? { conductor: terminal.conductor } : {}) };
  };
}

/**
 * Every wire with its ends named by the label of the module or node and the label or name of the
 * terminal. The cross-section is the wire's own or that of the cable of the load it leads to, and the
 * length that of the load's cable.
 */
export function wireList(project: Project, resolve: Resolve): WireRow[] {
  const { schematic } = project;
  const currents = wireCurrents(project, resolve);
  const loadOf = (nodeId: string) => schematic.nodes.find((n) => n.id === nodeId && n.kind === 'load')?.load;

  const end = endNamer(project, resolve);
  const runs = wireRuns(project, resolve);

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
      ...(runs.has(wire.id) ? { runMm: runs.get(wire.id) } : {}),
      ...(currentA !== undefined ? { currentA } : {}),
    };
  });
}

export const WIRE_HEADER = ['Wire', 'Label', 'From', 'To', 'Conductor', 'Cross-section (mm2)', 'Length (m)', 'Run (mm)', 'Current (A)'] as const;

export const wireCells = (row: WireRow): string[] => [
  row.wireId,
  row.label ?? '',
  row.from,
  row.to,
  row.conductor,
  row.sectionMm2 === undefined ? '' : String(row.sectionMm2),
  row.lengthM === undefined ? '' : String(row.lengthM),
  row.runMm === undefined ? '' : String(row.runMm),
  row.currentA === undefined ? '' : formatAmps(row.currentA),
];

export function wireListToCsv(rows: WireRow[]): string {
  const line = (cells: readonly string[]) => cells.map(cell).join(',');
  return `${[line(WIRE_HEADER), ...rows.map((row) => line(wireCells(row)))].join('\r\n')}\r\n`;
}

export interface WireEndLabel {
  /** What this end of the wire is joined to: this end, an arrow, the far end. */
  text: string;
  /** Wire label, conductor and cross-section. */
  detail: string;
  copies: number;
}

const withoutSide = (end: string) => end.replace(/ \((top|bottom)\)$/, '');

/**
 * One label for each end of each wire, as a marker sleeve or a flag on the wire shows it: where this
 * end is, an arrow, and where the other end goes, so either end tells where to look.
 */
export function wireEndLabels(rows: WireRow[]): WireEndLabel[] {
  return rows.flatMap((row) => {
    const here = withoutSide(row.from);
    const there = withoutSide(row.to);
    const detail = [row.label, row.conductor, row.sectionMm2 === undefined ? undefined : `${row.sectionMm2} mm2`].filter(Boolean).join(', ');
    return [
      { text: `${here} \u2192 ${there}`, detail, copies: 1 },
      { text: `${there} \u2192 ${here}`, detail, copies: 1 },
    ];
  });
}

export const WIRE_LABEL_HEADER = ['Label 1', 'Label 2', 'Copies'] as const;

/** Quotes what a spreadsheet or a label program would take for more than one cell; the delimiter is a semicolon. */
function labelCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** For label printers: one label per row, semicolons between the columns, and a header row. */
export function wireEndLabelsToCsv(labels: WireEndLabel[]): string {
  const line = (cells: ReadonlyArray<string | number>) => cells.map(labelCell).join(';');
  return `${[line(WIRE_LABEL_HEADER), ...labels.map((l) => line([l.text, l.detail, l.copies]))].join('\r\n')}\r\n`;
}

/** One terminal of a terminal block, or the pair that is joined inside it, with what is wired to each side. */
export interface TerminalRow {
  /** The block: its label on the panel, else the name of its module. */
  strip: string;
  /** The number or label of the terminal, as it is printed on the block. */
  terminal: string;
  conductor: Conductor;
  /** The other ends of the wires on the top side, such as `PLC DI1 (top)`. */
  top: string[];
  bottom: string[];
}

export const TERMINAL_HEADER = ['Strip', 'Terminal', 'Conductor', 'Top connects to', 'Bottom connects to'] as const;

export const terminalCells = (row: TerminalRow): string[] => [row.strip, row.terminal, row.conductor, row.top.join('; '), row.bottom.join('; ')];

/**
 * The schedule of the terminal blocks (kind `terminal`): a row for each terminal, or for each pair of
 * terminals that the block joins inside, in the order along the block, and where its wires go on each
 * side. This is what a fitter wires from and a panel builder checks against.
 */
export function terminalSchedule(project: Project, resolve: Resolve): TerminalRow[] {
  const { schematic, panel } = project;
  const end = endNamer(project, resolve);
  const rows: TerminalRow[] = [];
  for (const placement of panel.placements) {
    const def = resolve(placement.module);
    if (def?.kind !== 'terminal') continue;
    const node = schematic.nodes.find((n) => n.kind === 'module' && n.placementId === placement.id);
    const strip = placement.label ?? def.name;
    const groups = new Map<string, ReturnType<typeof terminalsOf>>();
    for (const terminal of terminalsOf(def, placement.widthUnits ?? def.widthUnits)) {
      const key = terminal.net ?? terminal.id;
      groups.set(key, [...(groups.get(key) ?? []), terminal]);
    }
    const ordered = [...groups.values()].sort((a, b) => Math.min(...a.map((t) => t.unit)) - Math.min(...b.map((t) => t.unit)));
    for (const group of ordered) {
      const labelled = group.find((t) => placement.terminalLabels?.[t.id] !== undefined) ?? group[0]!;
      const endsOn = (side: 'top' | 'bottom'): string[] =>
        !node
          ? []
          : schematic.wires.flatMap((wire) => {
              const mine = group.filter((t) => t.side === side).map((t) => t.id);
              if (wire.a.node === node.id && mine.includes(wire.a.terminal)) return [end(wire.b).text];
              if (wire.b.node === node.id && mine.includes(wire.b.terminal)) return [end(wire.a).text];
              return [];
            });
      rows.push({ strip, terminal: placement.terminalLabels?.[labelled.id] ?? labelled.name, conductor: group[0]!.conductor, top: endsOn('top'), bottom: endsOn('bottom') });
    }
  }
  return rows;
}

export function terminalScheduleToCsv(rows: TerminalRow[]): string {
  const line = (cells: readonly string[]) => cells.map(cell).join(',');
  return `${[line(TERMINAL_HEADER), ...rows.map((row) => line(terminalCells(row)))].join('\r\n')}\r\n`;
}
