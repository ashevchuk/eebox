import type { Orientation, Paper } from '../project/printOptions';
import type { Panel } from './placement';

/** The columns a printed legend of the panel can have, in the order they are printed. */
export const LEGEND_COLUMNS = ['number', 'ref', 'icon', 'text', 'group', 'rating', 'section'] as const;
export type LegendColumn = (typeof LEGEND_COLUMNS)[number];

export const LEGEND_COLUMN_NAMES: Record<LegendColumn, string> = {
  number: 'Number',
  ref: 'Designation',
  icon: 'Icon',
  text: 'Description',
  group: 'Group',
  rating: 'Rating',
  section: 'Cross-section',
};

export const LEGEND_PAPERS = ['A4', 'A3'] as const satisfies readonly Paper[];
export const LEGEND_ORIENTATIONS = ['portrait', 'landscape'] as const satisfies readonly Orientation[];
export const MIN_LEGEND_FONT_MM = 2.5;
export const MAX_LEGEND_FONT_MM = 10;

/** How the legend of the panel is printed; kept with the project so it prints the same every time. */
export interface LegendSettings {
  columns: LegendColumn[];
  fontMm: number;
  paper: (typeof LEGEND_PAPERS)[number];
  orientation: (typeof LEGEND_ORIENTATIONS)[number];
}

export const DEFAULT_LEGEND: LegendSettings = { columns: ['number', 'text', 'rating', 'section'], fontMm: 5, paper: 'A4', orientation: 'portrait' };

export const legendOf = (panel: Panel): LegendSettings => panel.legend ?? DEFAULT_LEGEND;

/** For the file validator, and for settings chosen in the dialog. */
export function legendProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object';
  const legend = value as Record<string, unknown>;
  const unknown = Object.keys(legend).find((k) => !['columns', 'fontMm', 'paper', 'orientation'].includes(k));
  if (unknown) return `has an unknown field "${unknown}"`;
  const columns = legend.columns;
  if (!Array.isArray(columns) || columns.length === 0 || columns.some((c) => !(LEGEND_COLUMNS as readonly unknown[]).includes(c)) || new Set(columns).size !== columns.length) {
    return `columns must be one or more of ${LEGEND_COLUMNS.join(', ')}, each once`;
  }
  if (typeof legend.fontMm !== 'number' || !(legend.fontMm >= MIN_LEGEND_FONT_MM && legend.fontMm <= MAX_LEGEND_FONT_MM)) return `fontMm must be ${MIN_LEGEND_FONT_MM} to ${MAX_LEGEND_FONT_MM}`;
  if (!(LEGEND_PAPERS as readonly unknown[]).includes(legend.paper)) return `paper must be one of ${LEGEND_PAPERS.join(', ')}`;
  if (!(LEGEND_ORIENTATIONS as readonly unknown[]).includes(legend.orientation)) return `orientation must be one of ${LEGEND_ORIENTATIONS.join(', ')}`;
  return null;
}

/** Keeps the settings with the panel, in the order of `LEGEND_COLUMNS`; the defaults are not stored. */
export function setLegend(panel: Panel, legend: LegendSettings): { ok: true; panel: Panel } | { ok: false; message: string } {
  const ordered: LegendSettings = { ...legend, columns: LEGEND_COLUMNS.filter((c) => legend.columns.includes(c)) };
  const problem = legendProblem(ordered);
  if (problem) return { ok: false, message: problem };
  const { legend: _previous, ...rest } = panel;
  const same =
    ordered.columns.join() === DEFAULT_LEGEND.columns.join() && ordered.fontMm === DEFAULT_LEGEND.fontMm && ordered.paper === DEFAULT_LEGEND.paper && ordered.orientation === DEFAULT_LEGEND.orientation;
  return { ok: true, panel: same ? rest : { ...rest, legend: ordered } };
}
