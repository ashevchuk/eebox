import {
  ART_ANCHORS,
  flattenPath,
  formatPath,
  mapPathPoints,
  parsePath,
  DEFAULT_STROKE_WIDTH_MM,
  MAX_ART_COORDINATE_MM,
  MAX_ART_POINTS,
  MAX_ART_SHAPES,
  TEXT_ALIGNS,
  type ArtAnchor,
  type ArtShape,
  type PlacedFrom,
} from '../library/art';
import type { Library, ModuleDef } from '../library/types';
import { validateArt, type ValidationError } from '../library/validate';
import type { InspectorField } from './inspector';

export interface Point {
  x: number;
  y: number;
}

export const ART_TOOLS = ['select', 'line', 'rect', 'ellipse', 'polyline', 'text'] as const;
export type ArtTool = (typeof ART_TOOLS)[number];

export const FACE_HEIGHT_MM = 90;
export const GRID_MM = 0.5;
/** Nothing is drawn smaller than this, so a shape can always be picked up again. */
export const MIN_EXTENT_MM = 0.5;
const TEXT_WIDTH_PER_CHARACTER = 0.58;
const NO_COLOUR = '';
const DEFAULT_INK = '#1f2937';
const DEFAULT_BODY = '#d1d5db';
const DEFAULT_TEXT = 'Text';
const DEFAULT_TEXT_SIZE_MM = 4;

export const snapMm = (value: number): number => Math.round(value / GRID_MM) * GRID_MM;
const clampCoordinate = (value: number): number => Math.max(-MAX_ART_COORDINATE_MM, Math.min(MAX_ART_COORDINATE_MM, value));

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The box a shape covers; the width of a text is an estimate, since the font is not measured here. */
export function boundsOf(shape: ArtShape): Box {
  switch (shape.kind) {
    case 'line':
      return { x1: Math.min(shape.x1, shape.x2), y1: Math.min(shape.y1, shape.y2), x2: Math.max(shape.x1, shape.x2), y2: Math.max(shape.y1, shape.y2) };
    case 'rect':
      return { x1: shape.x, y1: shape.y, x2: shape.x + shape.width, y2: shape.y + shape.height };
    case 'ellipse':
      return { x1: shape.cx - shape.rx, y1: shape.cy - shape.ry, x2: shape.cx + shape.rx, y2: shape.cy + shape.ry };
    case 'polyline':
      return {
        x1: Math.min(...shape.points.map((p) => p[0])),
        y1: Math.min(...shape.points.map((p) => p[1])),
        x2: Math.max(...shape.points.map((p) => p[0])),
        y2: Math.max(...shape.points.map((p) => p[1])),
      };
    case 'text': {
      const width = shape.text.length * shape.size * TEXT_WIDTH_PER_CHARACTER;
      const left = shape.align === 'centre' ? shape.x - width / 2 : shape.align === 'right' ? shape.x - width : shape.x;
      return { x1: left, y1: shape.y - shape.size / 2, x2: left + width, y2: shape.y + shape.size / 2 };
    }
    case 'path': {
      const points = flattenPath(parsePath(shape.d) ?? []).flat();
      if (points.length === 0) return { x1: 0, y1: 0, x2: 0, y2: 0 };
      return { x1: Math.min(...points.map((p) => p[0])), y1: Math.min(...points.map((p) => p[1])), x2: Math.max(...points.map((p) => p[0])), y2: Math.max(...points.map((p) => p[1])) };
    }
  }
}

/** The path with every point taken through a function, as a shape; a path that cannot be read is left as it is. */
function mappedPath(shape: Extract<ArtShape, { kind: 'path' }>, map: (x: number, y: number) => [number, number]): ArtShape {
  const commands = parsePath(shape.d);
  return commands ? { ...shape, d: formatPath(mapPathPoints(commands, map)) } : shape;
}

function moved(shape: ArtShape, dx: number, dy: number): ArtShape {
  switch (shape.kind) {
    case 'line':
      return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
    case 'rect':
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case 'ellipse':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case 'polyline':
      return { ...shape, points: shape.points.map(([x, y]): [number, number] => [x + dx, y + dy]) };
    case 'text':
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case 'path':
      return mappedPath(shape, (x, y) => [x + dx, y + dy]);
  }
}

/** The shape moved by a distance; it stays within the coordinates a library may hold. */
export function translate(shape: ArtShape, dx: number, dy: number): ArtShape {
  const box = boundsOf(shape);
  const fixX = Math.max(-MAX_ART_COORDINATE_MM - box.x1, Math.min(MAX_ART_COORDINATE_MM - box.x2, dx));
  const fixY = Math.max(-MAX_ART_COORDINATE_MM - box.y1, Math.min(MAX_ART_COORDINATE_MM - box.y2, dy));
  return moved(shape, fixX, fixY);
}

export interface Handle extends Point {
  id: string;
}

const BOX_HANDLES: Array<[string, (b: Box) => Point]> = [
  ['nw', (b) => ({ x: b.x1, y: b.y1 })],
  ['n', (b) => ({ x: (b.x1 + b.x2) / 2, y: b.y1 })],
  ['ne', (b) => ({ x: b.x2, y: b.y1 })],
  ['e', (b) => ({ x: b.x2, y: (b.y1 + b.y2) / 2 })],
  ['se', (b) => ({ x: b.x2, y: b.y2 })],
  ['s', (b) => ({ x: (b.x1 + b.x2) / 2, y: b.y2 })],
  ['sw', (b) => ({ x: b.x1, y: b.y2 })],
  ['w', (b) => ({ x: b.x1, y: (b.y1 + b.y2) / 2 })],
];

/** The points a shape can be pulled by: its corners and sides, its ends, or its vertices. A text has none, it is moved as a whole. */
export function handlesOf(shape: ArtShape): Handle[] {
  switch (shape.kind) {
    case 'line':
      return [
        { id: 'a', x: shape.x1, y: shape.y1 },
        { id: 'b', x: shape.x2, y: shape.y2 },
      ];
    case 'polyline':
      return shape.points.map(([x, y], i) => ({ id: `v${i}`, x, y }));
    case 'text':
      return [];
    default: {
      const box = boundsOf(shape);
      return BOX_HANDLES.map(([id, at]) => ({ id, ...at(box) }));
    }
  }
}

/** A box with one corner or side taken to a point, the opposite one staying; never smaller than the least extent. */
function pulledBox(box: Box, id: string, to: Point): Box {
  let { x1, y1, x2, y2 } = box;
  if (id.includes('w')) x1 = Math.min(to.x, x2 - MIN_EXTENT_MM);
  if (id.includes('e')) x2 = Math.max(to.x, x1 + MIN_EXTENT_MM);
  if (id.includes('n')) y1 = Math.min(to.y, y2 - MIN_EXTENT_MM);
  if (id.includes('s')) y2 = Math.max(to.y, y1 + MIN_EXTENT_MM);
  return { x1: clampCoordinate(x1), y1: clampCoordinate(y1), x2: clampCoordinate(x2), y2: clampCoordinate(y2) };
}

/** The shape with one of its handles taken to a point. */
export function dragHandle(shape: ArtShape, id: string, to: Point): ArtShape {
  const at = { x: clampCoordinate(to.x), y: clampCoordinate(to.y) };
  switch (shape.kind) {
    case 'line':
      return id === 'a' ? { ...shape, x1: at.x, y1: at.y } : { ...shape, x2: at.x, y2: at.y };
    case 'polyline': {
      const index = Number(id.slice(1));
      return { ...shape, points: shape.points.map((p, i): [number, number] => (i === index ? [at.x, at.y] : p)) };
    }
    case 'rect': {
      const box = pulledBox(boundsOf(shape), id, at);
      return { ...shape, x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 };
    }
    case 'ellipse': {
      const box = pulledBox(boundsOf(shape), id, at);
      return { ...shape, cx: (box.x1 + box.x2) / 2, cy: (box.y1 + box.y2) / 2, rx: (box.x2 - box.x1) / 2, ry: (box.y2 - box.y1) / 2 };
    }
    case 'text':
      return shape;
    case 'path': {
      const from = boundsOf(shape);
      const box = pulledBox(from, id, at);
      const scaleOf = (low: number, high: number, newLow: number, newHigh: number) => (v: number) => (high === low ? v + (newLow - low) : newLow + ((v - low) / (high - low)) * (newHigh - newLow));
      const mapX = scaleOf(from.x1, from.x2, box.x1, box.x2);
      const mapY = scaleOf(from.y1, from.y2, box.y1, box.y2);
      return mappedPath(shape, (x, y) => [clampCoordinate(mapX(x)), clampCoordinate(mapY(y))]);
    }
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const inside = (p: Point, b: Box) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;

function pointInPolygon(p: Point, points: Array<[number, number]>): boolean {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) result = !result;
  }
  return result;
}

/** Whether a point is on a shape: on its fill, or within `tolerance` of its line. */
export function hits(shape: ArtShape, p: Point, tolerance: number): boolean {
  const reach = tolerance + (shape.strokeWidth ?? DEFAULT_STROKE_WIDTH_MM) / 2;
  switch (shape.kind) {
    case 'line':
      return distanceToSegment(p, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= reach;
    case 'rect': {
      const box = boundsOf(shape);
      if (shape.fill !== undefined) return inside(p, { x1: box.x1 - tolerance, y1: box.y1 - tolerance, x2: box.x2 + tolerance, y2: box.y2 + tolerance });
      const near = inside(p, { x1: box.x1 - reach, y1: box.y1 - reach, x2: box.x2 + reach, y2: box.y2 + reach });
      return near && !inside(p, { x1: box.x1 + reach, y1: box.y1 + reach, x2: box.x2 - reach, y2: box.y2 - reach });
    }
    case 'ellipse': {
      const norm = Math.hypot((p.x - shape.cx) / shape.rx, (p.y - shape.cy) / shape.ry);
      const edge = reach / Math.min(shape.rx, shape.ry);
      return shape.fill !== undefined ? norm <= 1 + edge : Math.abs(norm - 1) <= edge;
    }
    case 'polyline': {
      const pts = shape.points.map(([x, y]): Point => ({ x, y }));
      const segments = pts.slice(1).map((b, i) => [pts[i]!, b] as const);
      if (shape.closed) segments.push([pts[pts.length - 1]!, pts[0]!]);
      if (segments.some(([a, b]) => distanceToSegment(p, a, b) <= reach)) return true;
      return shape.closed === true && shape.fill !== undefined && pointInPolygon(p, shape.points);
    }
    case 'text': {
      const box = boundsOf(shape);
      return inside(p, { x1: box.x1 - tolerance, y1: box.y1 - tolerance, x2: box.x2 + tolerance, y2: box.y2 + tolerance });
    }
    case 'path': {
      const pieces = flattenPath(parsePath(shape.d) ?? []);
      const near = pieces.some((piece) => piece.slice(1).some((b, i) => distanceToSegment(p, { x: piece[i]![0], y: piece[i]![1] }, { x: b[0], y: b[1] }) <= reach));
      if (near) return true;
      return shape.fill !== undefined && pieces.filter((piece) => pointInPolygon(p, piece)).length % 2 === 1;
    }
  }
}

/** The topmost shape under a point, as the index of the shape in the drawing; the placed copies are what is on show. */
export function shapeAt(placed: readonly PlacedFrom[], p: Point, tolerance: number): number | undefined {
  for (let i = placed.length - 1; i >= 0; i--) if (hits(placed[i]!.shape, p, tolerance)) return placed[i]!.index;
  return undefined;
}

/** A shape drawn by dragging from one point to another with a tool, or nothing when the drag is too small to make one. */
export function createShape(tool: Exclude<ArtTool, 'select' | 'polyline'>, from: Point, to: Point): ArtShape | undefined {
  const box: Box = { x1: Math.min(from.x, to.x), y1: Math.min(from.y, to.y), x2: Math.max(from.x, to.x), y2: Math.max(from.y, to.y) };
  const wide = box.x2 - box.x1 >= MIN_EXTENT_MM;
  const tall = box.y2 - box.y1 >= MIN_EXTENT_MM;
  switch (tool) {
    case 'line':
      return wide || tall ? { kind: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: DEFAULT_INK, strokeWidth: 0.5 } : undefined;
    case 'rect':
      return wide && tall ? { kind: 'rect', x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1, fill: DEFAULT_BODY, stroke: DEFAULT_INK, strokeWidth: 0.4 } : undefined;
    case 'ellipse':
      return wide && tall
        ? { kind: 'ellipse', cx: (box.x1 + box.x2) / 2, cy: (box.y1 + box.y2) / 2, rx: (box.x2 - box.x1) / 2, ry: (box.y2 - box.y1) / 2, fill: DEFAULT_BODY, stroke: DEFAULT_INK, strokeWidth: 0.4 }
        : undefined;
    case 'text':
      return { kind: 'text', x: from.x, y: from.y, text: DEFAULT_TEXT, size: DEFAULT_TEXT_SIZE_MM, fill: DEFAULT_INK, align: 'centre' };
  }
}

/** An open line through the points a person clicked, or nothing while there are fewer than two. */
export function polylineThrough(points: Array<[number, number]>): ArtShape | undefined {
  return points.length >= 2 && points.length <= MAX_ART_POINTS ? { kind: 'polyline', points, stroke: DEFAULT_INK, strokeWidth: 0.5 } : undefined;
}

/* The drawing in a library draft */

export type ArtResult = { ok: true; draft: Library; index: number } | { ok: false; message: string };

const fail = (message: string): ArtResult => ({ ok: false, message });

function withArt(draft: Library, moduleId: string, art: ArtShape[]): Library {
  return {
    ...draft,
    modules: draft.modules.map((m): ModuleDef => {
      if (m.id !== moduleId) return m;
      const { art: _previous, ...rest } = m;
      return art.length > 0 ? { ...rest, art } : rest;
    }),
  };
}

const artOf = (draft: Library, moduleId: string): ArtShape[] => draft.modules.find((m) => m.id === moduleId)?.art ?? [];

/** The first problem a drawing has, written the way the library validator writes it. */
function firstProblem(art: ArtShape[]): string | undefined {
  const errors: ValidationError[] = [];
  validateArt(art, 'art', errors);
  const [error] = errors;
  return error ? `${error.path}: ${error.message}` : undefined;
}

/** Puts a shape on top of the drawing. */
export function addShape(draft: Library, moduleId: string, shape: ArtShape): ArtResult {
  const art = artOf(draft, moduleId);
  if (art.length >= MAX_ART_SHAPES) return fail(`A face has at most ${MAX_ART_SHAPES} shapes.`);
  const problem = firstProblem([shape]);
  if (problem) return fail(problem);
  return { ok: true, draft: withArt(draft, moduleId, [...art, shape]), index: art.length };
}

/** Puts several shapes on top of the drawing in one step, and selects the first of them. */
export function addShapes(draft: Library, moduleId: string, shapes: ArtShape[]): ArtResult {
  const art = artOf(draft, moduleId);
  if (art.length + shapes.length > MAX_ART_SHAPES) return fail(`A face has at most ${MAX_ART_SHAPES} shapes.`);
  const problem = firstProblem(shapes);
  if (problem) return fail(problem);
  return { ok: true, draft: withArt(draft, moduleId, [...art, ...shapes]), index: art.length };
}

/** Replaces a shape, if the result is one the library accepts. */
export function replaceShape(draft: Library, moduleId: string, index: number, shape: ArtShape): ArtResult {
  const art = artOf(draft, moduleId);
  if (!art[index]) return fail('That shape does not exist.');
  const problem = firstProblem([shape]);
  if (problem) return fail(problem.replace(/^art\[0\]/, 'shape'));
  return { ok: true, draft: withArt(draft, moduleId, art.map((s, i) => (i === index ? shape : s))), index };
}

export function removeShape(draft: Library, moduleId: string, index: number): ArtResult {
  const art = artOf(draft, moduleId);
  if (!art[index]) return fail('That shape does not exist.');
  return { ok: true, draft: withArt(draft, moduleId, art.filter((_, i) => i !== index)), index: Math.min(index, art.length - 2) };
}

export function duplicateShape(draft: Library, moduleId: string, index: number): ArtResult {
  const art = artOf(draft, moduleId);
  const shape = art[index];
  if (!shape) return fail('That shape does not exist.');
  if (art.length >= MAX_ART_SHAPES) return fail(`A face has at most ${MAX_ART_SHAPES} shapes.`);
  const copy = translate(shape, 2, 2);
  return { ok: true, draft: withArt(draft, moduleId, [...art.slice(0, index + 1), copy, ...art.slice(index + 1)]), index: index + 1 };
}

export type Layer = 'forward' | 'backward' | 'front' | 'back';

/** Moves a shape up or down in the drawing; the first is at the bottom. */
export function moveLayer(draft: Library, moduleId: string, index: number, layer: Layer): ArtResult {
  const art = artOf(draft, moduleId);
  if (!art[index]) return fail('That shape does not exist.');
  const target = layer === 'forward' ? index + 1 : layer === 'backward' ? index - 1 : layer === 'front' ? art.length - 1 : 0;
  if (target < 0 || target >= art.length || target === index) return fail('It is already there.');
  const rest = art.filter((_, i) => i !== index);
  return { ok: true, draft: withArt(draft, moduleId, [...rest.slice(0, target), art[index]!, ...rest.slice(target)]), index: target };
}

/** Adds a vertex to a polyline halfway along its last piece, to be pulled where it is wanted. */
export function addVertex(shape: ArtShape): ArtShape | undefined {
  if (shape.kind !== 'polyline' || shape.points.length >= MAX_ART_POINTS) return undefined;
  const [a, b] = [shape.points[shape.points.length - 2]!, shape.points[shape.points.length - 1]!];
  return { ...shape, points: [...shape.points, [clampCoordinate(b[0] + (b[0] - a[0]) / 2), clampCoordinate(b[1] + (b[1] - a[1]) / 2)]] };
}

export function removeVertex(shape: ArtShape, index: number): ArtShape | undefined {
  return shape.kind === 'polyline' && shape.points.length > 2 ? { ...shape, points: shape.points.filter((_, i) => i !== index) } : undefined;
}

/* The fields of a shape */

const mm = (key: string, label: string, value: number, hint?: string): InspectorField => ({
  key, label, kind: 'number', value, min: -MAX_ART_COORDINATE_MM, max: MAX_ART_COORDINATE_MM, ...(hint ? { hint } : {}),
});
const colour = (key: string, label: string, value: string | undefined): InspectorField => ({
  key, label, kind: 'text', value: value ?? NO_COLOUR, placeholder: '#rrggbb', hint: 'empty for none',
});

const GEOMETRY_KEYS: Record<ArtShape['kind'], readonly string[]> = {
  line: ['x1', 'y1', 'x2', 'y2'],
  rect: ['x', 'y', 'width', 'height'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  polyline: [],
  text: ['x', 'y'],
  path: [],
};
const FROM_LEFT = 'mm from the left edge';
const FROM_TOP = 'mm from the top edge';
const GEOMETRY_HINTS: Record<string, string> = { x1: FROM_LEFT, y1: FROM_TOP, x2: FROM_LEFT, y2: FROM_TOP, x: FROM_LEFT, y: FROM_TOP, cx: FROM_LEFT, cy: FROM_TOP, width: 'mm', height: 'mm', rx: 'mm', ry: 'mm' };
const GEOMETRY_LABELS: Record<string, string> = { x1: 'X1', y1: 'Y1', x2: 'X2', y2: 'Y2', x: 'X', y: 'Y', width: 'Width', height: 'Height', cx: 'Centre X', cy: 'Centre Y', rx: 'Radius X', ry: 'Radius Y' };

/** What can be edited of a shape. */
export function shapeFields(shape: ArtShape): InspectorField[] {
  const record = shape as unknown as Record<string, unknown>;
  const fields: InspectorField[] = [{ key: 'kind', label: 'Shape', kind: 'readonly', value: shape.kind }];
  for (const key of GEOMETRY_KEYS[shape.kind]) fields.push(mm(key, GEOMETRY_LABELS[key]!, record[key] as number, GEOMETRY_HINTS[key]));
  if (shape.kind === 'polyline') {
    fields.push({ key: 'points', label: 'Points', kind: 'text', value: shape.points.map(([x, y]) => `${x},${y}`).join(' '), hint: 'x,y pairs in mm, 2 to 64' });
    fields.push({ key: 'closed', label: 'Closed', kind: 'select', value: shape.closed ? 'yes' : 'no', options: ['no', 'yes'] });
  }
  if (shape.kind === 'path') fields.push({ key: 'segments', label: 'Path', kind: 'readonly', value: `${parsePath(shape.d)?.length ?? 0} commands, taken from an SVG` });
  if (shape.kind === 'text') {
    fields.push({ key: 'text', label: 'Text', kind: 'text', value: shape.text, hint: 'one line, up to 40 characters' });
    fields.push({ key: 'size', label: 'Letter height', kind: 'number', value: shape.size, min: 1, max: 60, hint: 'mm' });
    fields.push({ key: 'align', label: 'Aligned', kind: 'select', value: shape.align ?? 'left', options: TEXT_ALIGNS });
    fields.push({ key: 'bold', label: 'Bold', kind: 'select', value: shape.bold ? 'yes' : 'no', options: ['no', 'yes'] });
    fields.push(colour('fill', 'Colour', shape.fill));
  } else {
    fields.push(colour('fill', 'Fill', shape.fill));
    fields.push(colour('stroke', 'Line', shape.stroke));
    fields.push({ key: 'strokeWidth', label: 'Line width', kind: 'number', value: shape.strokeWidth ?? DEFAULT_STROKE_WIDTH_MM, min: 0.05, max: 20, hint: 'mm' });
  }
  fields.push({ key: 'anchor', label: 'On other widths', kind: 'select', value: shape.anchor ?? 'left', options: ART_ANCHORS, hint: ANCHOR_HINTS[shape.anchor ?? 'left'] });
  if (shape.anchor === 'tile') fields.push({ key: 'period', label: 'Repeat every', kind: 'number', value: shape.period ?? 1, min: 0.25, max: 1000, hint: 'units' });
  return fields;
}

const ANCHOR_HINTS: Record<ArtAnchor, string> = {
  left: 'stays where it is',
  right: 'moves with the right edge',
  centre: 'moves by half of the change',
  stretch: 'is scaled across the width',
  tile: 'is repeated every period, for as many whole periods as fit',
};

export type ShapeEdit = { ok: true; shape: ArtShape } | { ok: false; message: string };

const NUMBER_KEYS = new Set(['x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height', 'cx', 'cy', 'rx', 'ry', 'size', 'strokeWidth', 'period']);

function parsePoints(raw: string): Array<[number, number]> | undefined {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const points = tokens.map((t) => t.split(',').map(Number));
  return points.length > 0 && points.every((p) => p.length === 2 && p.every(Number.isFinite)) ? points.map((p): [number, number] => [p[0]!, p[1]!]) : undefined;
}

/** One typed value applied to a shape; the library validator has the last word, so a value it would refuse is refused here. */
export function applyShapeEdit(shape: ArtShape, key: string, raw: string): ShapeEdit {
  const text = raw.trim();
  const record: Record<string, unknown> = { ...shape };
  if (NUMBER_KEYS.has(key)) {
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) return { ok: false, message: 'Enter a number.' };
    record[key] = value;
  } else if (key === 'fill' || key === 'stroke') {
    if (text === NO_COLOUR) delete record[key];
    else record[key] = text;
  } else if (key === 'anchor') {
    if (text === 'left') delete record.anchor;
    else record.anchor = text;
    if (text !== 'tile') delete record.period;
    else record.period ??= 1;
  } else if (key === 'closed' || key === 'bold') {
    if (text === 'yes') record[key] = true;
    else delete record[key];
  } else if (key === 'align') {
    if (text === 'left') delete record.align;
    else record.align = text;
  } else if (key === 'text') {
    record.text = raw;
  } else if (key === 'points') {
    const points = parsePoints(text);
    if (!points) return { ok: false, message: 'Enter x,y pairs separated by spaces, such as 0,0 10,0 10,5.' };
    record.points = points;
  } else {
    return { ok: false, message: 'That property cannot be edited.' };
  }
  const problem = firstProblem([record as unknown as ArtShape]);
  return problem ? { ok: false, message: problem.replace(/^art\[0\]\.?/, '') } : { ok: true, shape: record as unknown as ArtShape };
}
