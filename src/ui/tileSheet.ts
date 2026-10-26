import { TILE_HEIGHT_MM, TILE_OVERLAP_MM, TILE_WIDTH_MM, tileLayout } from '../project/tiles';
import { LIGHT_THEME } from '../view/theme';
import { renderToSvg } from './exportImage';
import type { Session } from './session';
import type { View } from './view';

const element = (tag: string, className: string, text?: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/**
 * Fills the print sheet with the panel at 1:1, cut into overlapping A4 sheets. World units are
 * millimetres, so the drawing is shown at its size in mm and each sheet shows the part of it that
 * lies under the sheet.
 */
export function fillTileSheet(sheet: HTMLElement, session: Session, panelView: View): void {
  const bounds = panelView.fitBounds();
  const widthMm = bounds.maxX - bounds.minX;
  const heightMm = bounds.maxY - bounds.minY;
  const parsed = new DOMParser().parseFromString(renderToSvg(panelView, session, LIGHT_THEME, 'full-'), 'image/svg+xml');
  const layout = tileLayout(widthMm, heightMm);
  const total = layout.tiles.length;

  sheet.replaceChildren(
    ...layout.tiles.map((tile, index) => {
      const page = element('div', 'tile');
      const drawing = element('div', 'tile-drawing');
      const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
      drawing.append(svg);
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = `${widthMm}mm`;
      svg.style.height = `${heightMm}mm`;
      drawing.style.left = `${-tile.x}mm`;
      drawing.style.top = `${-tile.y}mm`;
      page.append(drawing);

      const lastColumn = tile.column === layout.columns - 1;
      const lastRow = tile.row === layout.rows - 1;
      if (!lastColumn) page.append(guide('tile-guide-x', TILE_WIDTH_MM - TILE_OVERLAP_MM));
      if (!lastRow) page.append(guide('tile-guide-y', TILE_HEIGHT_MM - TILE_OVERLAP_MM));
      const title = session.project.panel.title ?? 'Panel';
      page.append(
        element('div', 'tile-caption', `${title}, 1:1 · sheet ${index + 1} of ${total} · column ${tile.column + 1}, row ${tile.row + 1} · print at 100 %, glue ${TILE_OVERLAP_MM} mm overlaps`),
      );
      return page;
    }),
  );
}

/** A dashed line where the next sheet begins. */
function guide(className: string, offsetMm: number): HTMLElement {
  const line = element('div', className);
  if (className === 'tile-guide-x') line.style.left = `${offsetMm}mm`;
  else line.style.top = `${offsetMm}mm`;
  return line;
}
