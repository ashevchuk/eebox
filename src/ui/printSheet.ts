import { circuitCells, circuitSchedule, CIRCUIT_HEADER, ferruleCells, ferruleCounts } from '../electrical/schedule';
import { buildBom, type BomRow } from '../project/bom';
import { LIGHT_THEME } from '../view/theme';
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

/** `idPrefix` keeps the ids inside one drawing from capturing the references of another on the same page. */
function drawingOf(view: View, session: Session, caption: string, idPrefix: string): HTMLElement {
  const figure = document.createElement('figure');
  const parsed = new DOMParser().parseFromString(renderToSvg(view, session, LIGHT_THEME, idPrefix), 'image/svg+xml');
  figure.append(document.importNode(parsed.documentElement, true));
  const text = document.createElement('figcaption');
  text.textContent = caption;
  figure.append(text);
  return figure;
}

function table(header: readonly string[], rows: string[][]): HTMLTableElement {
  const element = document.createElement('table');
  const head = element.createTHead().insertRow();
  for (const name of header) head.insertCell().textContent = name;
  const body = element.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const text of row) tr.insertCell().textContent = text;
  }
  return element;
}

function section(heading: string, content: HTMLElement): HTMLElement[] {
  const title = document.createElement('h2');
  title.textContent = heading;
  return [title, content];
}

/**
 * Fills the print sheet with the panel, the wiring schematic and the parts list. Page breaks and
 * visibility are the job of the print stylesheet.
 */
export function fillPrintSheet(sheet: HTMLElement, session: Session, views: { panel: View; schematic: View }): void {
  const { panel, schematic } = session.project;
  const title = document.createElement('h1');
  title.textContent = panel.title ?? 'Panel';
  const parts: HTMLElement[] = [title, drawingOf(views.panel, session, 'Panel layout', 'panel-')];
  if (schematic.nodes.length > 0) parts.push(drawingOf(views.schematic, session, 'Wiring schematic', 'schematic-'));
  const rows = buildBom(panel, session.resolve);
  if (rows.length > 0) parts.push(...section('Parts list', table(BOM_COLUMNS, rows.map(bomCells))));
  const circuits = circuitSchedule(session.project, session.resolve, session.cableSettings);
  if (circuits.length > 0) parts.push(...section('Circuits', table(CIRCUIT_HEADER, circuits.map(circuitCells))));
  const ferrules = ferruleCounts(session.project);
  if (ferrules.length > 0) parts.push(...section('Ferrules', table(['Ferrule (mm2)', 'Quantity'], ferrules.map(ferruleCells))));
  sheet.replaceChildren(...parts);
}
