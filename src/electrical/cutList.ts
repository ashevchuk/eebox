import { ductsOf } from '../layout/ducts';
import { mmFromUnits } from '../layout/units';
import { RAIL_HEIGHT } from '../view/geometry';
import type { Project } from '../project';
import { cell } from '../project/bom';
import type { Resolve } from './context';
import { wireList } from './schedule';

/** What is cut from a wire's length on top of what was measured, for the waste at the ends and for mistakes. */
export const RESERVE_PERCENT = 10;

export interface CutRow {
  item: 'Wire' | 'DIN rail' | 'Cable duct';
  size: string;
  count: number;
  /** All the pieces together, in mm; absent for wires that could not be measured. */
  lengthMm?: number;
  /** Wire only: the length to buy, with `RESERVE_PERCENT` on top. */
  withReserveMm?: number;
}

export const CUT_HEADER = ['Item', 'Size', 'Count', 'Length (mm)', 'With reserve (mm)'] as const;

export const cutCells = (row: CutRow): string[] => [
  row.item,
  row.size,
  String(row.count),
  row.lengthMm === undefined ? '' : String(row.lengthMm),
  row.withReserveMm === undefined ? '' : String(row.withReserveMm),
];

/**
 * What to cut and buy for the panel: the wires by cross-section with their estimated lengths added up (a
 * wire with an end that is not on the panel cannot be measured and is counted apart), the DIN rails
 * and the cable ducts. The wire lengths are the estimates of `wireRuns`, so they are as rough as those.
 */
export function cutList(project: Project, resolve: Resolve): CutRow[] {
  const rows: CutRow[] = [];

  const bySection = new Map<number | null, { count: number; lengthMm: number }>();
  let unmeasured = 0;
  for (const wire of wireList(project, resolve)) {
    if (wire.runMm === undefined) {
      unmeasured += 1;
      continue;
    }
    const section = wire.sectionMm2 ?? null;
    const total = bySection.get(section) ?? { count: 0, lengthMm: 0 };
    bySection.set(section, { count: total.count + 1, lengthMm: total.lengthMm + wire.runMm });
  }
  [...bySection]
    .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .forEach(([section, { count, lengthMm }]) =>
      rows.push({ item: 'Wire', size: section === null ? 'cross-section not known' : `${section} mm2`, count, lengthMm, withReserveMm: Math.ceil((lengthMm * (100 + RESERVE_PERCENT)) / 100) }),
    );
  if (unmeasured > 0) rows.push({ item: 'Wire', size: 'not measured: an end is not on the panel', count: unmeasured });

  const rails = project.panel.rails;
  if (rails.length > 0) rows.push({ item: 'DIN rail', size: `${RAIL_HEIGHT} mm`, count: rails.length, lengthMm: Math.round(rails.reduce((sum, r) => sum + mmFromUnits(r.lengthUnits), 0)) });

  const byWidth = new Map<number, { count: number; lengthMm: number }>();
  for (const duct of ductsOf(project.panel)) {
    const width = Math.min(duct.widthMm, duct.heightMm);
    const total = byWidth.get(width) ?? { count: 0, lengthMm: 0 };
    byWidth.set(width, { count: total.count + 1, lengthMm: total.lengthMm + Math.max(duct.widthMm, duct.heightMm) });
  }
  [...byWidth].sort(([a], [b]) => a - b).forEach(([width, { count, lengthMm }]) => rows.push({ item: 'Cable duct', size: `${width} mm wide`, count, lengthMm }));

  return rows;
}

export function cutListToCsv(rows: CutRow[]): string {
  const line = (cells: readonly string[]) => cells.map(cell).join(',');
  return `${[line(CUT_HEADER), ...rows.map((row) => line(cutCells(row)))].join('\r\n')}\r\n`;
}
