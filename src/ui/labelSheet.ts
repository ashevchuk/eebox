import { MODULE_UNIT_MM } from '../library/types';
import { cableMarkers, labelStrips } from '../project/labels';
import type { Session } from './session';

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/**
 * Fills the print sheet with the labels of the modules at their real size, one cell per module, and
 * with markers for the ends of the cables. Cutting lines are drawn by the print stylesheet.
 */
export function fillLabelSheet(sheet: HTMLElement, session: Session): void {
  const parts: HTMLElement[] = [];
  const strips = labelStrips(session.project.panel, session.resolve);
  if (strips.length > 0) {
    parts.push(element('h2', 'label-heading', 'Module labels, actual size'));
    for (const line of strips) {
      const row = element('div', 'strip-line');
      if (line.railLabel) row.append(element('div', 'strip-rail', line.railLabel));
      const rail = element('div', 'strip-rail-cells');
      for (const cell of line.cells) {
        const box = element('div', 'strip-cell', cell.text);
        box.style.left = `${cell.offsetUnits * MODULE_UNIT_MM}mm`;
        box.style.width = `${cell.widthUnits * MODULE_UNIT_MM}mm`;
        rail.append(box);
      }
      row.append(rail);
      parts.push(row);
    }
  }
  const markers = cableMarkers(session.project);
  if (markers.length > 0) {
    parts.push(element('h2', 'label-heading', 'Cable markers'));
    const grid = element('div', 'marker-grid');
    for (const marker of markers) {
      for (let copy = 0; copy < marker.copies; copy++) {
        const box = element('div', 'marker', marker.text);
        if (marker.detail) box.append(element('div', 'marker-detail', marker.detail));
        grid.append(box);
      }
    }
    parts.push(grid);
  }
  if (parts.length === 0) parts.push(element('p', 'label-heading', 'Nothing to label yet.'));
  sheet.replaceChildren(...parts);
}
