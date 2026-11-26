import type { Resolve } from '../electrical/context';
import { designated, isDevice } from '../layout/designations';
import { LEGEND_COLUMNS, LEGEND_COLUMN_NAMES, type LegendColumn } from '../layout/legend';
import type { ModuleDef } from '../library/types';
import type { Project } from '../project';
import { cell } from './bom';
import { moduleMarkings } from './marking';

/** One line of the legend: a device, or neighbours that say the same, under the number and colour of their strips. */
export interface LegendRow {
  placementIds: string[];
  numbers: number[];
  colour: string;
  textColour: string;
  refs: string[];
  icon?: string;
  text: string;
  /** The RCD or RCBO the group comes from, or the group set by hand; empty outside any group. */
  group: string;
  rating: string;
  /** Cross-sections in mm2, smallest first. */
  sections: number[];
}

const rating = (def: ModuleDef | undefined): string => (def?.ratedCurrentA === undefined ? '' : `${def.curve ?? ''}${def.ratedCurrentA}`);

/**
 * The legend of the panel: the devices on the rails in the order of their numbers, with the texts,
 * colours and icons of their strips. Neighbours with the same text, group, icon, rating and
 * cross-section share a row. The cross-section is that of the cables of the loads a device feeds,
 * else that of the wires on its terminals that state one.
 */
export function legendRows(project: Project, resolve: Resolve): LegendRow[] {
  const { panel, schematic } = project;
  const byId = new Map(panel.placements.map((p) => [p.id, p]));
  const sectionsOf = (placementId: string, loadIds: readonly string[]): number[] => {
    const fromLoads = loadIds.flatMap((id) => schematic.nodes.find((n) => n.id === id)?.load?.crossSectionMm2 ?? []);
    const node = schematic.nodes.find((n) => n.placementId === placementId);
    const fromWires = node ? schematic.wires.filter((w) => (w.a.node === node.id || w.b.node === node.id) && w.crossSectionMm2 !== undefined).map((w) => w.crossSectionMm2!) : [];
    return [...new Set(fromLoads.length > 0 ? fromLoads : fromWires)].sort((a, b) => a - b);
  };
  const groupName = (key: string | undefined): string => {
    if (key === undefined) return '';
    if (key.startsWith('group:')) return key.slice('group:'.length);
    const rcd = byId.get(key.slice('rcd:'.length));
    return rcd ? designated(rcd, rcd.label ?? resolve(rcd.module)?.name ?? rcd.module.moduleId) : '';
  };

  const rows: Array<LegendRow & { key: string }> = [];
  for (const mark of moduleMarkings(project, resolve)) {
    const placement = byId.get(mark.placementId)!;
    const def = resolve(placement.module);
    if (!isDevice(def)) continue;
    const row = {
      placementIds: [placement.id],
      numbers: [mark.number],
      colour: mark.colour,
      textColour: mark.textColour,
      refs: placement.ref ? [placement.ref] : [],
      ...(mark.marking.icon ? { icon: mark.marking.icon } : {}),
      text: mark.marking.text,
      group: groupName(mark.marking.groupKey),
      rating: rating(def),
      sections: sectionsOf(placement.id, mark.derived?.loadIds ?? []),
    };
    const key = JSON.stringify([row.text, mark.marking.groupKey ?? '', row.icon ?? '', row.colour, row.rating, row.sections]);
    const last = rows[rows.length - 1];
    if (last && row.text !== '' && last.key === key && last.numbers[last.numbers.length - 1] === mark.number - 1) {
      last.placementIds.push(placement.id);
      last.numbers.push(mark.number);
      last.refs.push(...row.refs);
      continue;
    }
    rows.push({ ...row, key });
  }
  return rows.map(({ key: _key, ...row }) => row);
}

/** Numbers as a person reads them: runs as 3–5, the rest with commas. */
export function numberRange(numbers: readonly number[]): string {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= numbers.length; i++) {
    if (i < numbers.length && numbers[i] === numbers[i - 1]! + 1) continue;
    const from = numbers[start]!;
    const to = numbers[i - 1]!;
    parts.push(from === to ? String(from) : to === from + 1 ? `${from}, ${to}` : `${from}–${to}`);
    start = i;
  }
  return parts.join(', ');
}

/** The text of a cell of a column; the icon column has none, its picture is drawn by the sheet. */
export function legendCell(row: LegendRow, column: LegendColumn, iconName: (key: string) => string = (k) => k): string {
  switch (column) {
    case 'number':
      return numberRange(row.numbers);
    case 'ref':
      return row.refs.join(', ');
    case 'icon':
      return row.icon ? iconName(row.icon) : '';
    case 'text':
      return row.text;
    case 'group':
      return row.group;
    case 'rating':
      return row.rating;
    case 'section':
      return row.sections.join(', ');
  }
}

/** The headings printed over the columns; the units go in the heading so the cells hold numbers only. */
export const LEGEND_HEADINGS: Record<LegendColumn, string> = { ...LEGEND_COLUMN_NAMES, number: 'No.', rating: 'A', section: 'mm²' };

export function legendToCsv(rows: readonly LegendRow[], iconName: (key: string) => string): string {
  const header = LEGEND_COLUMNS.map((c) => cell(LEGEND_COLUMN_NAMES[c]));
  const lines = rows.map((row) => LEGEND_COLUMNS.map((c) => cell(legendCell(row, c, iconName) || undefined)).join(','));
  return `${[header.join(','), ...lines].join('\r\n')}\r\n`;
}
