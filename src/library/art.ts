import { MAX_RAIL_LENGTH_UNITS } from '../layout/limits';
import { MODULE_UNIT_MM } from './types';

export const ART_ANCHORS = ['left', 'right', 'centre', 'stretch', 'tile'] as const;
export type ArtAnchor = (typeof ART_ANCHORS)[number];
export const ART_KINDS = ['line', 'rect', 'ellipse', 'polyline', 'text'] as const;
export type ArtKind = (typeof ART_KINDS)[number];
export const TEXT_ALIGNS = ['left', 'centre', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Drawings come from files and links, so every count and size is bounded: a tile is drawn once per period. */
export const MAX_ART_SHAPES = 32;
export const MAX_ART_POINTS = 64;
export const MAX_ART_TILES = 48;
export const MAX_ART_COORDINATE_MM = 1000;
export const MAX_ART_STROKE_MM = 20;
export const MAX_ART_TEXT_LENGTH = 40;
export const MIN_ART_TEXT_SIZE_MM = 1;
export const MAX_ART_TEXT_SIZE_MM = 60;
export const MIN_ART_PERIOD_UNITS = 0.25;
export const DEFAULT_STROKE_WIDTH_MM = 0.5;

interface Common {
  /** What happens to the shape when a placed copy is wider or narrower than the module's own width; `left` when absent. */
  anchor?: ArtAnchor;
  /** Units between the repeats of a `tile` shape; only for `tile`. */
  period?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
}

export interface ArtLine extends Common {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface ArtRect extends Common {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ArtEllipse extends Common {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
export interface ArtPolyline extends Common {
  kind: 'polyline';
  /** `[x, y]` pairs in mm from the top left corner of the face. */
  points: Array<[number, number]>;
  closed?: boolean;
}
export interface ArtText extends Common {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  /** Height of the letters in mm. */
  size: number;
  align?: TextAlign;
  bold?: boolean;
}
export type ArtShape = ArtLine | ArtRect | ArtEllipse | ArtPolyline | ArtText;

/** A shape at the width of one placed copy: without anchor and period, coordinates in mm from the corner of the face. */
export type PlacedShape = ArtShape;

interface Resized {
  move: (x: number) => number;
  scale: number;
}

function strip<T extends ArtShape>(shape: T): T {
  const { anchor: _anchor, period: _period, ...rest } = shape;
  return rest as T;
}

function place(shape: ArtShape, { move, scale }: Resized): PlacedShape {
  const base = strip(shape);
  switch (base.kind) {
    case 'line':
      return { ...base, x1: move(base.x1), x2: move(base.x2) };
    case 'rect':
      return { ...base, x: move(base.x), width: base.width * scale };
    case 'ellipse':
      return { ...base, cx: move(base.cx), rx: base.rx * scale };
    case 'polyline':
      return { ...base, points: base.points.map(([x, y]): [number, number] => [move(x), y]) };
    case 'text':
      return { ...base, x: move(base.x) };
  }
}

/**
 * The shapes of a drawing as they stand on a copy of `widthUnits`, drawn for a module made for
 * `baseUnits`. `left` shapes stay, `right` ones follow the right edge, `centre` ones the middle,
 * `stretch` ones are scaled across the width, and `tile` ones are repeated every `period` units for
 * as many whole periods as fit.
 */
export function placeArt(art: readonly ArtShape[], baseUnits: number, widthUnits: number): PlacedShape[] {
  const base = baseUnits * MODULE_UNIT_MM;
  const width = widthUnits * MODULE_UNIT_MM;
  const grown = width - base;
  const placed: PlacedShape[] = [];
  for (const shape of art) {
    switch (shape.anchor ?? 'left') {
      case 'left':
        placed.push(place(shape, { move: (x) => x, scale: 1 }));
        break;
      case 'right':
        placed.push(place(shape, { move: (x) => x + grown, scale: 1 }));
        break;
      case 'centre':
        placed.push(place(shape, { move: (x) => x + grown / 2, scale: 1 }));
        break;
      case 'stretch': {
        const scale = width / base;
        placed.push(place(shape, { move: (x) => x * scale, scale }));
        break;
      }
      case 'tile': {
        const step = (shape.period ?? 1) * MODULE_UNIT_MM;
        const count = Math.min(MAX_ART_TILES, Math.floor(width / step + 1e-9));
        for (let k = 0; k < count; k++) placed.push(place(shape, { move: (x) => x + k * step, scale: 1 }));
        break;
      }
    }
  }
  return placed;
}
