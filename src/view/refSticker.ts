import { placeArt, type ArtShape } from '../library/art';
import type { ModuleDef } from '../library/types';
import { terminalsOf } from '../electrical/terminals';

/** The sticker with a designation on the face of a module, in mm. */
export const REF_HEIGHT_MM = 6;
/**
 * Where a sticker stands: right under the rating, where the name of the module would begin, which
 * then begins lower. The bundled faces draw nothing there; their symbols sit near the bottom.
 */
export const REF_CENTRE_Y_MM = 31;
/** How much lower the name begins when a sticker is drawn. */
export const NAME_SHIFT_FOR_REF_MM = 7;
/** Where else a sticker may stand on a face that is drawn on under the rating: above the bottom terminals. */
export const REF_CENTRE_ABOVE_BOTTOM_MM = 15;
/** The rows of terminal dots, as `pinPoint` draws them, and how far a dot reaches. */
const TOP_PIN_Y_MM = 7;
const BOTTOM_PIN_ABOVE_BOTTOM_MM = 6;
const PIN_REACH_MM = 3;
/** A shape covering most of the face is its background, which a sticker may cover. */
const BACKGROUND_SHARE = 0.6;
const CLEARANCE_MM = 0.5;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A box around a shape, never smaller than what it covers; the points of a path include its control points. */
function boxOf(shape: ArtShape): Box {
  const around = (xs: number[], ys: number[]): Box => ({ x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });
  switch (shape.kind) {
    case 'line':
      return around([shape.x1, shape.x2], [shape.y1, shape.y2]);
    case 'rect':
      return { x1: shape.x, y1: shape.y, x2: shape.x + shape.width, y2: shape.y + shape.height };
    case 'ellipse':
      return { x1: shape.cx - shape.rx, y1: shape.cy - shape.ry, x2: shape.cx + shape.rx, y2: shape.cy + shape.ry };
    case 'polyline':
      return around(shape.points.map((p) => p[0]), shape.points.map((p) => p[1]));
    case 'text': {
      // A turned text may lie any way about its point; a square as wide as the text holds it.
      const reach = Math.max(shape.size, shape.text.length * shape.size * 0.6);
      return { x1: shape.x - reach, y1: shape.y - reach, x2: shape.x + reach, y2: shape.y + reach };
    }
    case 'path': {
      const numbers = (shape.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const xs = numbers.filter((_, i) => i % 2 === 0);
      const ys = numbers.filter((_, i) => i % 2 === 1);
      return xs.length === 0 ? { x1: 0, y1: 0, x2: 0, y2: 0 } : around(xs, ys);
    }
  }
}

const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** Where on the face the middle of the designation sticker stands, in mm from its top-left corner. */
export interface StickerSpot {
  x: number;
  y: number;
  /** No free place was found, so the sticker covers some of the face drawing. */
  covers: boolean;
}

/**
 * Where the designation sticker goes on a face: under the rating in the middle, else at its left or
 * right; else above the bottom terminals; else in the row of the bottom terminals when the module has
 * none. The first place that covers no part of the face drawing and no terminal wins. When no place is
 * free the first is kept, as a real sticker would cover the face there.
 */
export function refStickerSpot(def: ModuleDef, widthUnits: number, faceWidthMm: number, faceHeightMm: number, stickerWidthMm: number): StickerSpot {
  const terminals = terminalsOf(def, widthUnits);
  const hasTop = terminals.some((t) => t.side === 'top');
  const hasBottom = terminals.some((t) => t.side === 'bottom');
  const taken: Box[] = [];
  const band = (centre: number, reach: number): Box => ({ x1: 0, y1: centre - reach, x2: faceWidthMm, y2: centre + reach });
  if (hasTop) taken.push(band(TOP_PIN_Y_MM, PIN_REACH_MM));
  if (hasBottom) taken.push(band(faceHeightMm - BOTTOM_PIN_ABOVE_BOTTOM_MM, PIN_REACH_MM));
  const faceArea = faceWidthMm * faceHeightMm;
  for (const shape of placeArt(def.art ?? [], def.widthUnits, widthUnits)) {
    const box = boxOf(shape);
    if ((box.x2 - box.x1) * (box.y2 - box.y1) < faceArea * BACKGROUND_SHARE) taken.push(box);
  }
  const heights = [REF_CENTRE_Y_MM, faceHeightMm - REF_CENTRE_ABOVE_BOTTOM_MM, ...(hasBottom ? [] : [faceHeightMm - BOTTOM_PIN_ABOVE_BOTTOM_MM])];
  const halfWidth = stickerWidthMm / 2 + CLEARANCE_MM;
  const across = [faceWidthMm / 2, halfWidth + CLEARANCE_MM, faceWidthMm - halfWidth - CLEARANCE_MM];
  const half = REF_HEIGHT_MM / 2 + CLEARANCE_MM;
  const fits = ({ x, y }: { x: number; y: number }) =>
    y - half >= 0 && y + half <= faceHeightMm && x - halfWidth >= 0 && x + halfWidth <= faceWidthMm && !taken.some((box) => overlaps(box, { x1: x - halfWidth, y1: y - half, x2: x + halfWidth, y2: y + half }));
  const free = heights.flatMap((y) => across.map((x) => ({ x, y }))).find(fits);
  return free ? { ...free, covers: false } : { x: faceWidthMm / 2, y: Math.min(REF_CENTRE_Y_MM, faceHeightMm - REF_HEIGHT_MM / 2), covers: true };
}
