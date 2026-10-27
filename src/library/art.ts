import { MAX_RAIL_LENGTH_UNITS } from '../layout/limits';
import { MODULE_UNIT_MM } from './types';

export const ART_ANCHORS = ['left', 'right', 'centre', 'stretch', 'tile'] as const;
export type ArtAnchor = (typeof ART_ANCHORS)[number];
export const ART_KINDS = ['line', 'rect', 'ellipse', 'polyline', 'text', 'path'] as const;
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
export const MAX_ART_ROTATION_DEGREES = 360;
export const MAX_ART_PATH_SEGMENTS = 400;
export const MAX_ART_PATH_LENGTH = 12000;

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
  /** Degrees clockwise about the point of the text, a quarter turn at 90; the text is level when absent. */
  rotation?: number;
}
export interface ArtPath extends Common {
  kind: 'path';
  /** Absolute `M x y`, `L x y`, `C x1 y1 x2 y2 x y` and `Z`, separated by spaces, in mm from the top left corner of the face. */
  d: string;
}
export type ArtShape = ArtLine | ArtRect | ArtEllipse | ArtPolyline | ArtText | ArtPath;

export type PathCommand =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

const PATH_ARGUMENTS: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };
const PATH_NUMBER = /^-?\d+(\.\d+)?$/;

/** Reads path data in the one form a library may hold, or says nothing when it is in any other form. */
export function parsePath(d: string): PathCommand[] | undefined {
  if (d.length === 0 || d.length > MAX_ART_PATH_LENGTH) return undefined;
  const tokens = d.split(' ');
  const commands: PathCommand[] = [];
  for (let i = 0; i < tokens.length; ) {
    const op = tokens[i]!;
    const count = PATH_ARGUMENTS[op];
    if (count === undefined) return undefined;
    const raw = tokens.slice(i + 1, i + 1 + count);
    if (raw.length !== count || !raw.every((t) => PATH_NUMBER.test(t))) return undefined;
    const n = raw.map(Number);
    if (n.some((v) => Math.abs(v) > MAX_ART_COORDINATE_MM)) return undefined;
    const previous = commands[commands.length - 1];
    if (commands.length === 0 ? op !== 'M' : previous!.op === 'Z' && op !== 'M') return undefined;
    commands.push(op === 'Z' ? { op } : op === 'C' ? { op, x1: n[0]!, y1: n[1]!, x2: n[2]!, y2: n[3]!, x: n[4]!, y: n[5]! } : { op: op as 'M' | 'L', x: n[0]!, y: n[1]! });
    i += 1 + count;
    if (commands.length > MAX_ART_PATH_SEGMENTS) return undefined;
  }
  return commands;
}

const FLATTEN_STEPS = 8;

/** The pieces of a path as lists of points, a curve cut into straight steps; a closed piece ends where it began. */
export function flattenPath(commands: readonly PathCommand[]): Array<Array<[number, number]>> {
  const pieces: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let at: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];
  for (const c of commands) {
    if (c.op === 'M') {
      current = [[c.x, c.y]];
      pieces.push(current);
      at = start = [c.x, c.y];
    } else if (c.op === 'L') {
      current.push([c.x, c.y]);
      at = [c.x, c.y];
    } else if (c.op === 'C') {
      for (let i = 1; i <= FLATTEN_STEPS; i++) {
        const t = i / FLATTEN_STEPS;
        const u = 1 - t;
        current.push([
          u * u * u * at[0] + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * at[1] + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
      at = [c.x, c.y];
    } else {
      current.push(start);
      at = start;
    }
  }
  return pieces;
}

const round = (v: number) => String(Math.round(v * 1000) / 1000);

/** Path data in the form `parsePath` reads. */
export function formatPath(commands: readonly PathCommand[]): string {
  return commands
    .map((c) => (c.op === 'Z' ? 'Z' : c.op === 'C' ? `C ${round(c.x1)} ${round(c.y1)} ${round(c.x2)} ${round(c.y2)} ${round(c.x)} ${round(c.y)}` : `${c.op} ${round(c.x)} ${round(c.y)}`))
    .join(' ');
}

/** The commands with every point taken through a function. */
export function mapPathPoints(commands: readonly PathCommand[], map: (x: number, y: number) => [number, number]): PathCommand[] {
  return commands.map((c): PathCommand => {
    if (c.op === 'Z') return c;
    if (c.op === 'C') {
      const [x1, y1] = map(c.x1, c.y1);
      const [x2, y2] = map(c.x2, c.y2);
      const [x, y] = map(c.x, c.y);
      return { op: 'C', x1, y1, x2, y2, x, y };
    }
    const [x, y] = map(c.x, c.y);
    return { op: c.op, x, y };
  });
}

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
    case 'path': {
      const commands = parsePath(base.d);
      return commands ? { ...base, d: formatPath(mapPathPoints(commands, (x, y) => [move(x), y])) } : base;
    }
  }
}

/** A placed shape with the index of the shape it comes from, since a tile gives several. */
export interface PlacedFrom {
  index: number;
  shape: PlacedShape;
}

/**
 * The shapes of a drawing as they stand on a copy of `widthUnits`, drawn for a module made for
 * `baseUnits`. `left` shapes stay, `right` ones follow the right edge, `centre` ones the middle,
 * `stretch` ones are scaled across the width, and `tile` ones are repeated every `period` units for
 * as many whole periods as fit.
 */
export function placeArtFrom(art: readonly ArtShape[], baseUnits: number, widthUnits: number): PlacedFrom[] {
  const base = baseUnits * MODULE_UNIT_MM;
  const width = widthUnits * MODULE_UNIT_MM;
  const grown = width - base;
  const placed: PlacedFrom[] = [];
  art.forEach((shape, index) => {
    const add = (resized: Resized) => placed.push({ index, shape: place(shape, resized) });
    switch (shape.anchor ?? 'left') {
      case 'left':
        add({ move: (x) => x, scale: 1 });
        break;
      case 'right':
        add({ move: (x) => x + grown, scale: 1 });
        break;
      case 'centre':
        add({ move: (x) => x + grown / 2, scale: 1 });
        break;
      case 'stretch': {
        const scale = width / base;
        add({ move: (x) => x * scale, scale });
        break;
      }
      case 'tile': {
        const step = (shape.period ?? 1) * MODULE_UNIT_MM;
        const count = Math.min(MAX_ART_TILES, Math.floor(width / step + 1e-9));
        for (let k = 0; k < count; k++) add({ move: (x) => x + k * step, scale: 1 });
        break;
      }
    }
  });
  return placed;
}

export const placeArt = (art: readonly ArtShape[], baseUnits: number, widthUnits: number): PlacedShape[] =>
  placeArtFrom(art, baseUnits, widthUnits).map((p) => p.shape);
