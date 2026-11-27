import type { LegendSettings } from '../layout/legend';
import type { IconDef } from '../library/icons';
import { shapesToSvg } from '../library/svgExport';
import { LEGEND_HEADINGS, legendCell, legendRows } from '../project/legend';
import { FONT_FAMILY } from '../view/font';
import { fillCell } from './printSheet';
import type { Session } from './session';

/** An icon in a row is as tall as two lines of its letters. */
const ICON_LINES = 2;

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** Fills the print sheet with the legend of the panel: a table with the chosen columns, the number cells in the colours of the strips. */
export function fillLegendSheet(sheet: HTMLElement, session: Session, settings: LegendSettings, iconName: (key: string) => string): void {
  const rows = legendRows(session.project, session.resolve);
  if (rows.length === 0) {
    sheet.replaceChildren(element('p', 'label-heading', 'There are no devices on the rails yet.'));
    return;
  }
  const table = document.createElement('table');
  table.className = 'legend-table';
  table.style.fontFamily = FONT_FAMILY;
  table.style.fontSize = `${settings.fontMm}mm`;
  const head = table.createTHead().insertRow();
  for (const column of settings.columns) head.append(element('th', `legend-${column}`, LEGEND_HEADINGS[column]));
  for (const row of rows) {
    const line = document.createElement('tr');
    for (const column of settings.columns) {
      const td = element('td', `legend-${column}`);
      if (column === 'icon') {
        const icon: IconDef | undefined = row.icon === undefined ? undefined : session.resolveIcon(row.icon);
        if (icon) {
          const picture = element('div', 'legend-picture');
          picture.style.height = `${settings.fontMm * ICON_LINES}mm`;
          picture.title = iconName(row.icon!);
          // The shapes passed the art validator (colours, path grammar, numbers) and their text is escaped, so the markup holds nothing else.
          picture.innerHTML = shapesToSvg(icon.art, icon.widthMm, icon.heightMm);
          td.append(picture);
        }
      } else {
        fillCell(td, legendCell(row, column, iconName));
      }
      if (column === 'number') {
        td.style.background = row.colour;
        td.style.color = row.textColour;
      }
      line.append(td);
    }
    table.append(line);
  }
  const parts: HTMLElement[] = [];
  if (session.project.panel.title) parts.push(element('h2', 'label-heading', session.project.panel.title));
  parts.push(table);
  sheet.replaceChildren(...parts);
}
