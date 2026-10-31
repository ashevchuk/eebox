import { TILE_HEIGHT_MM, TILE_OVERLAP_MM, TILE_WIDTH_MM, sheetsWithContent, tileLayout } from '../project/tiles';
import { FONT_FAMILY } from '../view/font';
import { printArea } from '../view/geometry';
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

interface PrintedTile {
  page: HTMLElement;
  plateName: string;
  position: string;
}

/**
 * Fills the print sheet with every plate at 1:1, one after the other, each cut into overlapping A4 sheets.
 * World units are millimetres, so a drawing is shown at its size in mm and each sheet shows the part of it
 * that lies under the sheet. The plate on view is put back afterwards.
 */
export function fillTileSheet(sheet: HTMLElement, session: Session, panelView: View): void {
  const onView = session.plateId;
  const tiles: PrintedTile[] = [];
  try {
    for (const plate of session.project.panel.plates) {
      session.plateId = plate.id;
      tiles.push(...plateTiles(session, panelView, plate.name));
    }
  } finally {
    session.plateId = onView;
  }
  const { plates, title } = session.project.panel;
  sheet.replaceChildren(
    ...tiles.map(({ page, plateName, position }, index) => {
      const name = `${title ?? 'Panel'}${plates.length > 1 ? `, ${plateName}` : ''}`;
      page.append(element('div', 'tile-caption', `${name}, 1:1 · sheet ${index + 1} of ${tiles.length} · ${position} · print at 100 %, glue ${TILE_OVERLAP_MM} mm overlaps`));
      return page;
    }),
  );
}

/** The sheets that hold something of the plate on view. */
function plateTiles(session: Session, panelView: View, plateName: string): PrintedTile[] {
  const measuring = document.createElement('canvas').getContext('2d')!;
  measuring.font = `8px ${FONT_FAMILY}`;
  const combInfo = (item: { module: Parameters<Session['resolve']>[0]; widthUnits?: number }) => {
    const def = session.resolve(item.module);
    return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
  };
  const { bounds, rects } = printArea(session.scope.panel, session.sizes, combInfo, (text) => measuring.measureText(text).width);
  const widthMm = bounds.maxX - bounds.minX;
  const heightMm = bounds.maxY - bounds.minY;
  session.bareDrawing = true;
  let markup: string;
  try {
    markup = renderToSvg(panelView, session, LIGHT_THEME, 'full-', bounds);
  } finally {
    session.bareDrawing = false;
  }
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const layout = tileLayout(widthMm, heightMm);
  const printed = sheetsWithContent(
    layout,
    rects.map((r) => ({ ...r, x: r.x - bounds.minX, y: r.y - bounds.minY })),
  );

  return printed.map((tile) => {
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
    return { page, plateName, position: `column ${tile.column + 1}, row ${tile.row + 1}` };
  });
}

/** A dashed line where the next sheet begins. */
function guide(className: string, offsetMm: number): HTMLElement {
  const line = element('div', className);
  if (className === 'tile-guide-x') line.style.left = `${offsetMm}mm`;
  else line.style.top = `${offsetMm}mm`;
  return line;
}
