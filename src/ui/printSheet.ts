import { buildBom, type BomRow } from '../project/bom';
import { renderToSvg } from './exportImage';
import type { Session } from './session';
import type { View } from './view';

const BOM_COLUMNS = ['Qty', 'Module', 'SKU', 'Kind', 'Poles', 'Rating', 'Width', 'Labels'] as const;

/** One BOM row as the printed table shows it, in the order of `BOM_COLUMNS`. */
export function bomCells(row: BomRow): string[] {
  const { def } = row;
  const rating = [
    def?.ratedCurrentA ? `${def.ratedCurrentA} A` : '',
    def?.curve ?? '',
    def?.residualCurrentMa ? `${def.residualCurrentMa} mA` : '',
    def?.breakingCapacityKA ? `${def.breakingCapacityKA} kA` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    String(row.quantity),
    def?.name ?? `${row.moduleId} (module not found)`,
    def?.sku ?? '',
    def?.kind ?? '',
    def ? String(def.poles) : '',
    rating,
    row.widthUnits === undefined ? '' : `${row.widthUnits} u`,
    row.labels.join(', '),
  ];
}

function drawingOf(view: View, session: Session, caption: string): HTMLElement {
  const figure = document.createElement('figure');
  const parsed = new DOMParser().parseFromString(renderToSvg(view, session), 'image/svg+xml');
  figure.append(document.importNode(parsed.documentElement, true));
  const text = document.createElement('figcaption');
  text.textContent = caption;
  figure.append(text);
  return figure;
}

function bomTable(rows: BomRow[]): HTMLTableElement {
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const name of BOM_COLUMNS) head.insertCell().textContent = name;
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of bomCells(row)) tr.insertCell().textContent = cell;
  }
  return table;
}

/**
 * Fills the print sheet with the panel, the wiring schematic and the parts list. Page breaks and
 * visibility are the job of the print stylesheet.
 */
export function fillPrintSheet(sheet: HTMLElement, session: Session, views: { panel: View; schematic: View }): void {
  const { panel, schematic } = session.project;
  const title = document.createElement('h1');
  title.textContent = panel.title ?? 'Panel';
  const parts: HTMLElement[] = [title, drawingOf(views.panel, session, 'Panel layout')];
  if (schematic.nodes.length > 0) parts.push(drawingOf(views.schematic, session, 'Wiring schematic'));
  const rows = buildBom(panel, session.resolve);
  if (rows.length > 0) {
    const heading = document.createElement('h2');
    heading.textContent = 'Parts list';
    parts.push(heading, bomTable(rows));
  }
  sheet.replaceChildren(...parts);
}
