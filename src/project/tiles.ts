/** Printable area of an A4 sheet in landscape with 10 mm margins, less a little for rounding in the print engine. */
export const TILE_WIDTH_MM = 276;
export const TILE_HEIGHT_MM = 188;
/** How far neighbouring sheets overlap, so they can be glued edge over edge. */
export const TILE_OVERLAP_MM = 10;

export interface Tile {
  column: number;
  row: number;
  /** Where the sheet starts on the drawing, in mm from its top-left corner. */
  x: number;
  y: number;
}

export interface TileLayout {
  columns: number;
  rows: number;
  tiles: Tile[];
}

const sheetsFor = (extentMm: number, sheetMm: number, overlapMm: number): number =>
  extentMm <= sheetMm ? 1 : 1 + Math.ceil((extentMm - sheetMm) / (sheetMm - overlapMm));

/** Cuts a drawing of the given size into sheets that overlap, left to right and top to bottom. */
export function tileLayout(
  widthMm: number,
  heightMm: number,
  sheetWidthMm = TILE_WIDTH_MM,
  sheetHeightMm = TILE_HEIGHT_MM,
  overlapMm = TILE_OVERLAP_MM,
): TileLayout {
  const columns = sheetsFor(widthMm, sheetWidthMm, overlapMm);
  const rows = sheetsFor(heightMm, sheetHeightMm, overlapMm);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      tiles.push({ column, row, x: column * (sheetWidthMm - overlapMm), y: row * (sheetHeightMm - overlapMm) });
    }
  }
  return { columns, rows, tiles };
}
