import type { ModuleRef, Panel } from '../layout/placement';
import type { ModuleDef } from '../library/types';
import { moduleKey } from './file';

export interface BomRow {
  libraryId: string;
  moduleId: string;
  def: ModuleDef | undefined;
  quantity: number;
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
];

export function buildBom(panel: Panel, resolve: (ref: ModuleRef) => ModuleDef | undefined): BomRow[] {
  const rows = new Map<string, BomRow>();
  for (const { module } of panel.placements) {
    const key = moduleKey(module);
    const row = rows.get(key);
    if (row) row.quantity += 1;
    else rows.set(key, { libraryId: module.libraryId, moduleId: module.moduleId, def: resolve(module), quantity: 1 });
  }
  return [...rows.values()].sort(
    (a, b) => a.libraryId.localeCompare(b.libraryId) || (a.def?.name ?? a.moduleId).localeCompare(b.def?.name ?? b.moduleId),
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
  const lines = rows.map(({ libraryId, moduleId, def, quantity }) =>
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
      def?.widthUnits,
      quantity,
    ]
      .map(cell)
      .join(','),
  );
  return `${[HEADER.map(cell).join(','), ...lines].join('\r\n')}\r\n`;
}
