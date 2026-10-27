import type { CableSettings } from '../electrical/cables';
import type { Resolve } from '../electrical/context';
import { circuitSchedule, ferruleCounts, wireList } from '../electrical/schedule';
import type { Project } from '../project';
import { bomTotals, buildBom, lineTotal } from '../project/bom';
import { circuitSummaries, CHECK_IDS, type CheckStatus } from '../electrical/summary';
import type { Selection } from './session';

export interface Column {
  label: string;
  /** Numbers are lined up on the right and sorted by value. */
  numeric?: boolean;
  /** The inspector field that edits this column; a typed value goes through `applyEdit` like in the inspector. */
  edit?: string;
}

export type Cell = string | number;

export interface Table {
  id: 'parts' | 'circuits' | 'wires' | 'ferrules' | 'checks';
  title: string;
  columns: Column[];
  rows: Cell[][];
  /** What each row is, as a selection, for the columns that can be edited; one entry for each row. */
  selections?: Selection[];
  /** For a cell, how it is doing, so it can be coloured; one list for each row, one entry for each cell. */
  marks?: Array<Array<CheckStatus | undefined>>;
  /** For a cell, a longer explanation to show on hover; shaped like `marks`. */
  titles?: string[][];
  /** What to say under the table, such as a total. */
  note?: string;
  /** What to say instead of an empty table. */
  empty: string;
}

const blank = (value: Cell | undefined): Cell => value ?? '';

/** The lists of a project that are also exported as CSV, as tables to read on the screen. */
export function tablesOf(project: Project, resolve: Resolve, settings?: CableSettings): Table[] {
  const bom = buildBom(project.panel, resolve);
  const totals = bomTotals(bom);
  const money = totals.totals.map((t) => `${t.amount}${t.currency ? ` ${t.currency}` : ''}`).join(' + ');
  const parts: Table = {
    id: 'parts',
    title: 'Parts',
    columns: [
      { label: 'Module' },
      { label: 'Kind' },
      { label: 'Rating, A', numeric: true },
      { label: 'Width, units', numeric: true },
      { label: 'Quantity', numeric: true },
      { label: 'Labels' },
      { label: 'Price', numeric: true },
      { label: 'Line total', numeric: true },
    ],
    rows: bom.map((row) => [
      row.def?.name ?? '(missing module)',
      blank(row.def?.kind),
      blank(row.def?.ratedCurrentA),
      blank(row.widthUnits),
      row.quantity,
      row.labels.join(', '),
      blank(row.def?.price),
      blank(lineTotal(row)),
    ]),
    note: bom.length === 0 ? undefined : `${money === '' ? 'No prices are given' : `Total ${money}`}${totals.unpriced > 0 ? `; ${totals.unpriced} row${totals.unpriced === 1 ? ' has' : 's have'} no price` : ''}.`,
    empty: 'Nothing is placed on the panel yet.',
  };
  const schedule = circuitSchedule(project, resolve, settings);
  const circuits: Table = {
    id: 'circuits',
    title: 'Circuits',
    columns: [
      { label: 'Load' },
      { label: 'Power, W', numeric: true, edit: 'powerW' },
      { label: 'Current, A', numeric: true },
      { label: 'Breaker' },
      { label: 'Breaker, A', numeric: true },
      { label: 'Cable, mm²', numeric: true, edit: 'crossSection' },
      { label: 'Needed, mm²', numeric: true },
      { label: 'Length, m', numeric: true, edit: 'lengthM' },
      { label: 'Drop, %', numeric: true },
    ],
    selections: schedule.map((c) => ({ nodeId: c.nodeId })),
    rows: schedule.map((c) => [
      c.load,
      c.powerW,
      Math.round(c.currentA * 100) / 100,
      blank(c.breaker),
      blank(c.breakerA),
      blank(c.chosenSectionMm2),
      blank(c.minimumSectionMm2),
      blank(c.lengthM),
      c.dropPercent === undefined ? '' : Math.round(c.dropPercent * 100) / 100,
    ]),
    empty: 'Give a load a power in the inspector to see its circuit here.',
  };
  const wireRows = wireList(project, resolve);
  const wires: Table = {
    id: 'wires',
    title: 'Wires',
    columns: [
      { label: 'Wire' },
      { label: 'Label', edit: 'label' },
      { label: 'From' },
      { label: 'To' },
      { label: 'Conductor' },
      { label: 'Cross-section, mm²', numeric: true, edit: 'section' },
      { label: 'Length, m', numeric: true },
      { label: 'Current, A', numeric: true },
    ],
    selections: wireRows.map((w) => ({ wireId: w.wireId })),
    rows: wireRows.map((w) => [w.wireId, blank(w.label), w.from, w.to, w.conductor, blank(w.sectionMm2), blank(w.lengthM), w.currentA === undefined ? '' : Math.round(w.currentA * 100) / 100]),
    empty: 'There are no wires yet.',
  };
  const ferrules: Table = {
    id: 'ferrules',
    title: 'Ferrules',
    columns: [{ label: 'Cross-section, mm²', numeric: true }, { label: 'Quantity', numeric: true }],
    rows: ferruleCounts(project).map((f) => [f.sectionMm2 === null ? 'not known' : f.sectionMm2, f.quantity]),
    empty: 'There are no wires yet, so no ferrules.',
  };
  return [parts, circuits, wires, ferrules];
}

/** The rows ordered by a column, numbers by value and empty cells last; the order of equal cells is kept. */
export function sortRows(table: Table, column: number, descending: boolean): Cell[][] {
  return sortedIndices(table, column, descending).map((i) => table.rows[i]!);
}

/** The same order as `sortRows`, as indices into `table.rows`, so a row on the screen can be traced back to its object. */
export function sortedIndices(table: Table, column: number, descending: boolean): number[] {
  const numeric = table.columns[column]?.numeric === true;
  const empty = (c: Cell | undefined) => c === undefined || c === '';
  const compare = (a: Cell | undefined, b: Cell | undefined): number => {
    if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
    if (numeric && typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  };
  const indexed = table.rows.map((row, i) => ({ row, i }));
  indexed.sort((x, y) => {
    const order = compare(x.row[column], y.row[column]);
    if (empty(x.row[column]) || empty(y.row[column])) return order || x.i - y.i;
    return (descending ? -order : order) || x.i - y.i;
  });
  return indexed.map(({ i }) => i);
}

const CHECK_LABELS: Record<(typeof CHECK_IDS)[number], string> = { cable: 'Cable', drop: 'Voltage drop', breaker: 'Breaker', rcd: 'RCD', earth: 'Earth' };
const RESULT_TEXT = { ok: 'Ok', attention: 'Needs attention', incomplete: 'Incomplete' } as const;
const RESULT_MARK = { ok: 'ok', attention: 'warning', incomplete: 'unknown' } as const;

/** What the calculations say about each circuit: one row for a load, one cell for each check, with the reason on hover. */
export function summaryTable(project: Project, resolve: Resolve, settings?: CableSettings): Table {
  const summaries = circuitSummaries(project, resolve, settings);
  const tally = (result: (typeof summaries)[number]['result']) => summaries.filter((s) => s.result === result).length;
  return {
    id: 'checks',
    title: 'Checks',
    columns: [{ label: 'Load' }, { label: 'Current, A', numeric: true }, ...CHECK_IDS.map((id) => ({ label: CHECK_LABELS[id] })), { label: 'Result' }],
    rows: summaries.map((s) => [s.load, Math.round(s.currentA * 100) / 100, ...s.checks.map((c) => c.text), RESULT_TEXT[s.result]]),
    marks: summaries.map((s) => [undefined, undefined, ...s.checks.map((c) => c.status), RESULT_MARK[s.result]]),
    titles: summaries.map((s) => ['', '', ...s.checks.map((c) => c.detail), '']),
    note: summaries.length === 0 ? undefined : `${summaries.length} circuit${summaries.length === 1 ? '' : 's'}: ${tally('ok')} ok, ${tally('attention')} need attention, ${tally('incomplete')} incomplete. Hover a cell for the reason. The cable table and the limits are the ones in File > Cable settings, which are not verified.`,
    empty: 'Give a load a power in the inspector to see its checks here.',
  };
}
