import { MODULE_UNIT_MM } from '../library/types';
import { cableMarkers } from '../project/labels';
import { HEAD_MM, LINE_HEIGHT, markingStrips, TEXT_PADDING_MM, type MarkingLine } from '../project/marking';
import { FONT_FAMILY } from '../view/font';
import type { Session } from './session';

/** A printer that fits the page to the paper shrinks the strips; the ruler shows it. */
const RULER_MM = 100;
const RULER_TICK_MM = 10;

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const place = (el: HTMLElement, box: { left: number; top: number; width: number; height: number }): HTMLElement => {
  el.style.left = `${box.left}mm`;
  el.style.top = `${box.top}mm`;
  el.style.width = `${box.width}mm`;
  el.style.height = `${box.height}mm`;
  return el;
};

function ruler(): HTMLElement {
  const box = element('div', 'mark-ruler');
  const bar = element('div', 'mark-ruler-bar');
  bar.style.width = `${RULER_MM}mm`;
  for (let mm = 0; mm <= RULER_MM; mm += RULER_TICK_MM) {
    const tick = element('div', 'mark-ruler-tick');
    tick.style.left = `${mm}mm`;
    bar.append(tick);
  }
  box.append(bar, element('div', 'mark-ruler-caption', `${RULER_MM} mm: measure it after printing. Print at 100 %, not fitted to the page.`));
  return box;
}

function strip(line: MarkingLine, heightMm: number): HTMLElement {
  const lengthUnits = Math.max(...[...line.heads, ...line.texts].map((c) => c.offsetUnits + c.widthUnits));
  const box = element('div', 'mark-strip');
  box.style.width = `${lengthUnits * MODULE_UNIT_MM}mm`;
  box.style.height = `${heightMm}mm`;
  box.style.fontFamily = FONT_FAMILY;
  for (const head of line.heads) {
    const cell = place(element('div', 'mark-head', String(head.number)), { left: head.offsetUnits * MODULE_UNIT_MM, top: 0, width: head.widthUnits * MODULE_UNIT_MM, height: HEAD_MM });
    cell.style.background = head.colour;
    cell.style.color = head.textColour;
    box.append(cell);
  }
  for (const text of line.texts) {
    const cell = place(element('div', 'mark-text'), { left: text.offsetUnits * MODULE_UNIT_MM, top: HEAD_MM, width: text.widthUnits * MODULE_UNIT_MM, height: heightMm - HEAD_MM });
    cell.style.padding = `${TEXT_PADDING_MM}mm`;
    cell.style.fontSize = `${text.fontMm}mm`;
    cell.style.lineHeight = String(LINE_HEIGHT);
    cell.append(...text.lines.map((l) => element('div', 'mark-text-line', l)));
    box.append(cell);
  }
  return box;
}

/**
 * Fills the print sheet with the marking strips of the modules at their real size and with markers
 * for the ends of the cables. Cutting lines are drawn by the print stylesheet.
 */
export function fillLabelSheet(sheet: HTMLElement, session: Session): void {
  const parts: HTMLElement[] = [];
  const marking = markingStrips(session.project, session.resolve);
  if (marking.lines.length > 0) {
    parts.push(element('h2', 'label-heading', 'Module labels, actual size'), ruler());
    for (const line of marking.lines) {
      const row = element('div', 'strip-line');
      if (line.railLabel) row.append(element('div', 'strip-rail', line.railLabel));
      row.append(strip(line, marking.heightMm));
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
