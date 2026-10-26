import type { ModuleRef, Panel } from '../layout/placement';
import type { ModuleDef } from '../library/types';
import { moduleKey } from './file';

export interface BomRow {
  libraryId: string;
  moduleId: string;
  def: ModuleDef | undefined;
  /** Copies of one module with different custom widths are different items. */
  widthUnits: number | undefined;
  quantity: number;
  /** Custom labels of the placed items, in panel order. */
  labels: string[];
}

const HEADER = [
  'Library',
  'Module',
  'SKU',
  'Name',
  'Kind',
  'Poles',
  'Rated current (A)',
  'Curve',
  'Breaking capacity (kA)',
  'Residual current (mA)',
  'Width (units)',
  'Quantity',
  'Labels',
];

export function buildBom(panel: Panel, resolve: (ref: ModuleRef) => ModuleDef | undefined): BomRow[] {
  const rows = new Map<string, BomRow>();
  for (const { module, label, widthUnits: override } of [...panel.placements, ...panel.combs]) {
    const def = resolve(module);
    const widthUnits = override ?? def?.widthUnits;
    const key = `${moduleKey(module)}|${widthUnits}`;
    const row =
      rows.get(key) ??
      { libraryId: module.libraryId, moduleId: module.moduleId, def, widthUnits, quantity: 0, labels: [] };
    row.quantity += 1;
    if (label) row.labels.push(label);
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.libraryId.localeCompare(b.libraryId) ||
      (a.def?.name ?? a.moduleId).localeCompare(b.def?.name ?? b.moduleId) ||
      (a.widthUnits ?? 0) - (b.widthUnits ?? 0),
  );
}

/** Library text is untrusted; a leading formula character would execute in a spreadsheet. */
function cell(value: string | number | undefined): string {
  if (value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function bomToCsv(rows: BomRow[]): string {
  const lines = rows.map(({ libraryId, moduleId, def, widthUnits, quantity, labels }) =>
    [
      libraryId,
      moduleId,
      def?.sku,
      def?.name ?? '(missing module)',
      def?.kind,
      def?.poles,
      def?.ratedCurrentA,
      def?.curve,
      def?.breakingCapacityKA,
      def?.residualCurrentMa,
      widthUnits,
      quantity,
      labels.join('; ') || undefined,
    ]
      .map(cell)
      .join(','),
  );
  return `${[HEADER.map(cell).join(','), ...lines].join('\r\n')}\r\n`;
}
