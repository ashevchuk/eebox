import {
  MAX_ART_PATH_SEGMENTS,
  MAX_ART_POINTS,
  MAX_ART_STROKE_MM,
  MAX_ART_TEXT_LENGTH,
  MAX_ART_TEXT_SIZE_MM,
  MIN_ART_TEXT_SIZE_MM,
  formatPath,
  mapPathPoints,
  type ArtAnchor,
  type ArtShape,
  type PathCommand,
} from './art';
import { validateArt, type ValidationError } from './validate';
import { parseXml, type XmlElement } from './xml';

/** Where on the face the drawing goes and how it follows the width of the module. */
export interface SvgImportOptions {
  /** The width the drawing is given on the face; its height follows from its proportions. */
  widthMm: number;
  leftMm: number;
  topMm: number;
  anchor: ArtAnchor;
  /** How many more shapes the face has room for. */
  room: number;
  /** For `tile`. */
  period?: number;
}

export type SvgImport = { ok: true; shapes: ArtShape[]; notes: string[]; heightMm: number } | { ok: false; message: string };

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** How much the matrix scales lengths, taken as the square root of its area factor. */
const lengthScale = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const keepsAxes = (m: Matrix): boolean => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const numbersIn = (text: string): number[] => (text.match(NUMBER) ?? []).map(Number);

/** The matrix a `transform` attribute stands for, or nothing when it holds a function that is not known. */
export function parseTransform(text: string | undefined): Matrix | undefined {
  if (text === undefined || text.trim() === '') return IDENTITY;
  let result: Matrix = IDENTITY;
  const call = /([A-Za-z]+)\s*\(([^)]*)\)/g;
  let consumed = 0;
  for (let match = call.exec(text); match; match = call.exec(text)) {
    if (text.slice(consumed, match.index).replace(/[\s,]/g, '') !== '') return undefined;
    consumed = call.lastIndex;
    const n = numbersIn(match[2]!);
    const rad = (deg: number) => (deg * Math.PI) / 180;
    let m: Matrix | undefined;
    switch (match[1]) {
      case 'matrix':
        m = n.length === 6 ? (n as Matrix) : undefined;
        break;
      case 'translate':
        m = n.length === 1 || n.length === 2 ? [1, 0, 0, 1, n[0]!, n[1] ?? 0] : undefined;
        break;
      case 'scale':
        m = n.length === 1 || n.length === 2 ? [n[0]!, 0, 0, n[1] ?? n[0]!, 0, 0] : undefined;
        break;
      case 'rotate': {
        if (n.length !== 1 && n.length !== 3) return undefined;
        const a = rad(n[0]!);
        const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
        const rotation: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        m = multiply(multiply([1, 0, 0, 1, cx, cy], rotation), [1, 0, 0, 1, -cx, -cy]);
        break;
      }
      case 'skewX':
        m = n.length === 1 ? [1, 0, Math.tan(rad(n[0]!)), 1, 0, 0] : undefined;
        break;
      case 'skewY':
        m = n.length === 1 ? [1, Math.tan(rad(n[0]!)), 0, 1, 0, 0] : undefined;
        break;
    }
    if (!m || m.some((v) => !Number.isFinite(v))) return undefined;
    result = multiply(result, m);
  }
  return text.slice(consumed).replace(/[\s,]/g, '') === '' ? result : undefined;
}

/* Colours */

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
  magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000',
  green: '#008000', purple: '#800080', teal: '#008080', navy: '#000080', orange: '#ffa500', brown: '#a52a2a', pink: '#ffc0cb',
};
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** `#rrggbb`, `none`, or nothing for a paint that cannot be drawn, such as a gradient. */
export function parsePaint(value: string): string | 'none' | undefined {
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return 'none';
  if (v === 'currentcolor') return '#000000';
  if (NAMED[v]) return NAMED[v];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*,\s*([\d.]+)(%?)\s*\)$/.exec(v);
  if (rgb) {
    const channel = (n: string, percent: string) => (percent ? (Number(n) * 255) / 100 : Number(n));
    return `#${hex2(channel(rgb[1]!, rgb[2]!))}${hex2(channel(rgb[3]!, rgb[4]!))}${hex2(channel(rgb[5]!, rgb[6]!))}`;
  }
  return undefined;
}

/* Styles */

interface Style {
  fill: string | 'none';
  stroke: string | 'none';
  strokeWidth: number;
  fontSize: number;
  bold: boolean;
  textAnchor: 'start' | 'middle' | 'end';
}

const DEFAULT_STYLE: Style = { fill: '#000000', stroke: 'none', strokeWidth: 1, fontSize: 16, bold: false, textAnchor: 'start' };
const PROPERTIES = ['fill', 'stroke', 'stroke-width', 'font-size', 'font-weight', 'text-anchor'] as const;

function declarations(element: XmlElement): Record<string, string> {
  const found: Record<string, string> = {};
  for (const property of PROPERTIES) if (element.attributes[property] !== undefined) found[property] = element.attributes[property]!;
  for (const part of (element.attributes.style ?? '').split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) found[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).trim();
  }
  return found;
}

/** Lengths may carry a unit; only the number is kept, since the whole drawing is scaled to a width of its own. */
const lengthOf = (text: string | undefined): number | undefined => {
  const value = text === undefined ? undefined : Number((/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text) ?? [])[1]);
  return value !== undefined && Number.isFinite(value) ? value : undefined;
};

/* Paths */

function arcToCubics(x0: number, y0: number, rxIn: number, ryIn: number, rotation: number, large: boolean, sweep: boolean, x: number, y: number): PathCommand[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if ((x0 === x && y0 === y) || rx === 0 || ry === 0) return [{ op: 'L', x, y }];
  const phi = (rotation * Math.PI) / 180;
  const [cosPhi, sinPhi] = [Math.cos(phi), Math.sin(phi)];
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1 = cosPhi * dx + sinPhi * dy;
  const y1 = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const factor = sign * Math.sqrt(Math.max(0, numerator / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (factor * rx * y1) / ry;
  const cy1 = (-factor * ry * x1) / rx;
  const cx = cosPhi * cx1 - sinPhi * cy1 + (x0 + x) / 2;
  const cy = sinPhi * cx1 + cosPhi * cy1 + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let extent = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && extent > 0) extent -= 2 * Math.PI;
  if (sweep && extent < 0) extent += 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(extent) / (Math.PI / 2) - 1e-9));
  const step = extent / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (a: number): [number, number] => [cx + rx * Math.cos(a) * cosPhi - ry * Math.sin(a) * sinPhi, cy + rx * Math.cos(a) * sinPhi + ry * Math.sin(a) * cosPhi];
  const derivative = (a: number): [number, number] => [-rx * Math.sin(a) * cosPhi - ry * Math.cos(a) * sinPhi, -rx * Math.sin(a) * sinPhi + ry * Math.cos(a) * cosPhi];
  const commands: PathCommand[] = [];
  for (let i = 0; i < pieces; i++) {
    const a0 = start + i * step;
    const a1 = a0 + step;
    const [px0, py0] = point(a0);
    const [px1, py1] = i === pieces - 1 ? [x, y] : point(a1);
    const [d0x, d0y] = derivative(a0);
    const [d1x, d1y] = derivative(a1);
    commands.push({ op: 'C', x1: px0 + k * d0x, y1: py0 + k * d0y, x2: px1 - k * d1x, y2: py1 - k * d1y, x: px1, y: py1 });
  }
  return commands;
}

const ARGUMENTS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** SVG path data as absolute moves, lines and cubic curves, or nothing when it is not path data. */
export function parsePathData(d: string): PathCommand[] | undefined {
  const out: PathCommand[] = [];
  let pos = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubic: [number, number] | undefined;
  let lastQuad: [number, number] | undefined;
  const skip = () => {
    while (pos < d.length && /[\s,]/.test(d[pos]!)) pos++;
  };
  const number = (): number | undefined => {
    skip();
    const re = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
    re.lastIndex = pos;
    const match = re.exec(d);
    if (!match) return undefined;
    pos = re.lastIndex;
    return Number(match[0]);
  };
  const flag = (): boolean | undefined => {
    skip();
    const c = d[pos];
    if (c !== '0' && c !== '1') return undefined;
    pos++;
    return c === '1';
  };
  let command = '';
  let first = true;
  for (;;) {
    skip();
    if (pos >= d.length) break;
    const c = d[pos]!;
    if (/[A-Za-z]/.test(c)) {
      if (ARGUMENTS[c.toLowerCase()] === undefined) return undefined;
      command = c;
      pos++;
    } else if (command === '' || command === 'z' || command === 'Z') {
      return undefined;
    } else if (command === 'M') {
      command = 'L';
    } else if (command === 'm') {
      command = 'l';
    }
    if (first && command.toLowerCase() !== 'm') return undefined;
    first = false;
    const relative = command === command.toLowerCase();
    const lower = command.toLowerCase();
    const take = (count: number): number[] | undefined => {
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        const v = number();
        if (v === undefined) return undefined;
        values.push(v);
      }
      return values;
    };
    const ox = relative ? cx : 0;
    const oy = relative ? cy : 0;
    if (lower === 'z') {
      out.push({ op: 'Z' });
      cx = sx;
      cy = sy;
      lastCubic = lastQuad = undefined;
    } else if (lower === 'm' || lower === 'l') {
      const v = take(2);
      if (!v) return undefined;
      cx = v[0]! + ox;
      cy = v[1]! + oy;
      if (lower === 'm') {
        sx = cx;
        sy = cy;
      }
      out.push({ op: lower === 'm' ? 'M' : 'L', x: cx, y: cy });
      lastCubic = lastQuad = undefined;
    } else if (lower === 'h' || lower === 'v') {
      const v = take(1);
      if (!v) return undefined;
      if (lower === 'h') cx = v[0]! + (relative ? cx : 0);
      else cy = v[0]! + (relative ? cy : 0);
      out.push({ op: 'L', x: cx, y: cy });
      lastCubic = lastQuad = undefined;
    } else if (lower === 'c' || lower === 's') {
      const v = take(lower === 'c' ? 6 : 4);
      if (!v) return undefined;
      const [x1, y1] = lower === 'c' ? [v[0]! + ox, v[1]! + oy] : lastCubic ? [2 * cx - lastCubic[0], 2 * cy - lastCubic[1]] : [cx, cy];
      const k = lower === 'c' ? 2 : 0;
      const x2 = v[k]! + ox;
      const y2 = v[k + 1]! + oy;
      const x = v[k + 2]! + ox;
      const y = v[k + 3]! + oy;
      out.push({ op: 'C', x1, y1, x2, y2, x, y });
      lastCubic = [x2, y2];
      lastQuad = undefined;
      cx = x;
      cy = y;
    } else if (lower === 'q' || lower === 't') {
      const v = take(lower === 'q' ? 4 : 2);
      if (!v) return undefined;
      const [qx, qy] = lower === 'q' ? [v[0]! + ox, v[1]! + oy] : lastQuad ? [2 * cx - lastQuad[0], 2 * cy - lastQuad[1]] : [cx, cy];
      const x = v[lower === 'q' ? 2 : 0]! + ox;
      const y = v[lower === 'q' ? 3 : 1]! + oy;
      out.push({ op: 'C', x1: cx + (2 / 3) * (qx - cx), y1: cy + (2 / 3) * (qy - cy), x2: x + (2 / 3) * (qx - x), y2: y + (2 / 3) * (qy - y), x, y });
      lastQuad = [qx, qy];
      lastCubic = undefined;
      cx = x;
      cy = y;
    } else {
      const head = take(3);
      const large = head && flag();
      const sweep = head && large !== undefined ? flag() : undefined;
      const tail = head && sweep !== undefined ? take(2) : undefined;
      if (!head || large === undefined || sweep === undefined || !tail) return undefined;
      const x = tail[0]! + ox;
      const y = tail[1]! + oy;
      out.push(...arcToCubics(cx, cy, head[0]!, head[1]!, head[2]!, large, sweep, x, y));
      cx = x;
      cy = y;
      lastCubic = lastQuad = undefined;
    }
    if (out.length > MAX_ART_PATH_SEGMENTS * 4) return undefined;
  }
  if (out.length === 0) return undefined;
  // After a closing, a drawing command goes on from where the piece began; a stored path says it with a move.
  const stored: PathCommand[] = [];
  let begin = { x: 0, y: 0 };
  for (const c of out) {
    if (c.op === 'M') begin = { x: c.x, y: c.y };
    if (stored[stored.length - 1]?.op === 'Z' && c.op !== 'M') stored.push({ op: 'M', x: begin.x, y: begin.y });
    stored.push(c);
  }
  return stored;
}

/* The import */

const SKIPPED_SILENTLY = new Set(['title', 'desc', 'metadata', 'namedview', 'defs']);
const NOT_DRAWN = new Set(['image', 'use', 'style', 'script', 'foreignObject', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'filter', 'switch', 'a']);
const ROUND_CORNER = 0.5522847498;

interface Context {
  matrix: Matrix;
  style: Style;
}

/**
 * Turns the drawing of an SVG file into shapes of a face. What a face cannot hold is left out and said
 * in the notes, so nothing disappears without a word; nothing in the file is run or fetched.
 */
export function importSvg(text: string, options: SvgImportOptions): SvgImport {
  const parsed = parseXml(text);
  if (!parsed.ok) return parsed;
  const { root } = parsed;
  if (root.name !== 'svg') return { ok: false, message: 'This is not an SVG: the first element is not <svg>.' };

  const viewBox = numbersIn(root.attributes.viewBox ?? '');
  const width = lengthOf(root.attributes.width);
  const height = lengthOf(root.attributes.height);
  const box = viewBox.length === 4 ? viewBox : width !== undefined && height !== undefined ? [0, 0, width, height] : undefined;
  if (!box || !(box[2]! > 0) || !(box[3]! > 0)) return { ok: false, message: 'The SVG needs a viewBox, or a width and a height, to know how big the drawing is.' };
  if (!(options.widthMm > 0)) return { ok: false, message: 'Give the drawing a width on the face.' };

  const scale = options.widthMm / box[2]!;
  const base: Matrix = [scale, 0, 0, scale, options.leftMm - box[0]! * scale, options.topMm - box[1]! * scale];
  const notes = new Set<string>();
  const shapes: ArtShape[] = [];

  const mm = (value: number) => Math.round(value * 1000) / 1000;
  const finish = <T extends ArtShape>(shape: T): ArtShape => {
    const withAnchor: ArtShape = options.anchor === 'left' ? shape : options.anchor === 'tile' ? { ...shape, anchor: 'tile', period: options.period ?? 1 } : { ...shape, anchor: options.anchor };
    return withAnchor;
  };
  const paints = (style: Style, k: number): { fill?: string; stroke?: string; strokeWidth?: number } => ({
    ...(style.fill !== 'none' ? { fill: style.fill } : {}),
    ...(style.stroke !== 'none' ? { stroke: style.stroke, strokeWidth: mm(Math.min(MAX_ART_STROKE_MM, Math.max(0.05, style.strokeWidth * k))) } : {}),
  });
  const drawn = (style: Style) => style.fill !== 'none' || style.stroke !== 'none';

  const styleOf = (element: XmlElement, parent: Style): Style => {
    const style = { ...parent };
    const found = declarations(element);
    const paint = (property: 'fill' | 'stroke') => {
      const value = found[property];
      if (value === undefined) return;
      const result = parsePaint(value);
      if (result === undefined) {
        notes.add(`A ${/^url\(/i.test(value) ? 'gradient or pattern' : `colour (${value})`} cannot be drawn on a face and is shown in grey.`);
        style[property] = '#808080';
      } else {
        style[property] = result;
      }
    };
    paint('fill');
    paint('stroke');
    const strokeWidth = lengthOf(found['stroke-width']);
    if (strokeWidth !== undefined) style.strokeWidth = strokeWidth;
    const fontSize = lengthOf(found['font-size']);
    if (fontSize !== undefined) style.fontSize = fontSize;
    if (found['font-weight'] !== undefined) style.bold = /^(bold|bolder|[6-9]00)$/.test(found['font-weight']);
    const anchor = found['text-anchor'];
    if (anchor === 'start' || anchor === 'middle' || anchor === 'end') style.textAnchor = anchor;
    for (const ignored of ['opacity', 'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'clip-path', 'mask', 'filter']) {
      if (element.attributes[ignored] !== undefined || /(^|;)\s*opacity\s*:/.test(element.attributes.style ?? '')) notes.add(`Opacity, dashes, clipping and filters (${ignored}) are not drawn.`);
    }
    return style;
  };

  const numberAttribute = (element: XmlElement, name: string, fallback = 0) => lengthOf(element.attributes[name]) ?? fallback;

  function pathShape(commands: PathCommand[], ctx: Context): void {
    const mapped = mapPathPoints(commands, (x, y) => apply(ctx.matrix, x, y));
    if (mapped.length > MAX_ART_PATH_SEGMENTS) return void notes.add(`A path with more than ${MAX_ART_PATH_SEGMENTS} commands was left out; simplify it first.`);
    shapes.push(finish({ kind: 'path', d: formatPath(mapped), ...paints(ctx.style, lengthScale(ctx.matrix)) }));
  }

  const rectPath = (x: number, y: number, w: number, h: number, rx: number, ry: number): PathCommand[] => {
    if (rx <= 0 || ry <= 0) return [{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }];
    const kx = rx * ROUND_CORNER;
    const ky = ry * ROUND_CORNER;
    return [
      { op: 'M', x: x + rx, y },
      { op: 'L', x: x + w - rx, y },
      { op: 'C', x1: x + w - rx + kx, y1: y, x2: x + w, y2: y + ry - ky, x: x + w, y: y + ry },
      { op: 'L', x: x + w, y: y + h - ry },
      { op: 'C', x1: x + w, y1: y + h - ry + ky, x2: x + w - rx + kx, y2: y + h, x: x + w - rx, y: y + h },
      { op: 'L', x: x + rx, y: y + h },
      { op: 'C', x1: x + rx - kx, y1: y + h, x2: x, y2: y + h - ry + ky, x, y: y + h - ry },
      { op: 'L', x, y: y + ry },
      { op: 'C', x1: x, y1: y + ry - ky, x2: x + rx - kx, y2: y, x: x + rx, y },
      { op: 'Z' },
    ];
  };

  const ellipsePath = (cx: number, cy: number, rx: number, ry: number): PathCommand[] => {
    const kx = rx * ROUND_CORNER;
    const ky = ry * ROUND_CORNER;
    return [
      { op: 'M', x: cx + rx, y: cy },
      { op: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
      { op: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
      { op: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
      { op: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
      { op: 'Z' },
    ];
  };

  function draw(element: XmlElement, parent: Context): void {
    if (SKIPPED_SILENTLY.has(element.name)) return;
    if (NOT_DRAWN.has(element.name)) return void notes.add(`<${element.name}> is not drawn.`);
    if (element.attributes.display === 'none' || /display\s*:\s*none/.test(element.attributes.style ?? '')) return;
    const transform = parseTransform(element.attributes.transform);
    if (!transform) return void notes.add(`The transform of a <${element.name}> was not understood, so it was left out.`);
    const ctx: Context = { matrix: multiply(parent.matrix, transform), style: styleOf(element, parent.style) };
    const { matrix, style } = ctx;
    const k = lengthScale(matrix);
    switch (element.name) {
      case 'g':
      case 'svg':
        for (const child of element.children) if (typeof child !== 'string') draw(child, ctx);
        return;
      case 'rect': {
        const [x, y, w, h] = [numberAttribute(element, 'x'), numberAttribute(element, 'y'), numberAttribute(element, 'width'), numberAttribute(element, 'height')];
        if (!(w > 0) || !(h > 0) || !drawn(style)) return;
        let rx = numberAttribute(element, 'rx', -1);
        let ry = numberAttribute(element, 'ry', -1);
        if (rx < 0 && ry >= 0) rx = ry;
        if (ry < 0 && rx >= 0) ry = rx;
        rx = Math.min(Math.max(rx, 0), w / 2);
        ry = Math.min(Math.max(ry, 0), h / 2);
        if (keepsAxes(matrix) && rx === 0) {
          const [x1, y1] = apply(matrix, x, y);
          const [x2, y2] = apply(matrix, x + w, y + h);
          shapes.push(finish({ kind: 'rect', x: mm(Math.min(x1, x2)), y: mm(Math.min(y1, y2)), width: mm(Math.abs(x2 - x1)), height: mm(Math.abs(y2 - y1)), ...paints(style, k) }));
          return;
        }
        return pathShape(rectPath(x, y, w, h, rx, ry), ctx);
      }
      case 'circle':
      case 'ellipse': {
        const r = numberAttribute(element, 'r');
        const rx = element.name === 'circle' ? r : numberAttribute(element, 'rx');
        const ry = element.name === 'circle' ? r : numberAttribute(element, 'ry');
        if (!(rx > 0) || !(ry > 0) || !drawn(style)) return;
        const [cx, cy] = [numberAttribute(element, 'cx'), numberAttribute(element, 'cy')];
        if (keepsAxes(matrix)) {
          const [x, y] = apply(matrix, cx, cy);
          shapes.push(finish({ kind: 'ellipse', cx: mm(x), cy: mm(y), rx: mm(rx * Math.abs(matrix[0])), ry: mm(ry * Math.abs(matrix[3])), ...paints(style, k) }));
          return;
        }
        return pathShape(ellipsePath(cx, cy, rx, ry), ctx);
      }
      case 'line': {
        if (style.stroke === 'none') return;
        const [x1, y1] = apply(matrix, numberAttribute(element, 'x1'), numberAttribute(element, 'y1'));
        const [x2, y2] = apply(matrix, numberAttribute(element, 'x2'), numberAttribute(element, 'y2'));
        shapes.push(finish({ kind: 'line', x1: mm(x1), y1: mm(y1), x2: mm(x2), y2: mm(y2), stroke: style.stroke, strokeWidth: mm(Math.min(MAX_ART_STROKE_MM, Math.max(0.05, style.strokeWidth * k))) }));
        return;
      }
      case 'polyline':
      case 'polygon': {
        const values = numbersIn(element.attributes.points ?? '');
        const points: Array<[number, number]> = [];
        for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i]!, values[i + 1]!]);
        if (points.length < 2 || !drawn(style)) return;
        const closed = element.name === 'polygon';
        if (points.length > MAX_ART_POINTS || (!closed && style.fill !== 'none')) {
          const commands: PathCommand[] = points.map(([x, y], i): PathCommand => ({ op: i === 0 ? 'M' : 'L', x, y }));
          return pathShape(closed ? [...commands, { op: 'Z' }] : commands, ctx);
        }
        shapes.push(finish({ kind: 'polyline', points: points.map(([x, y]) => apply(matrix, x, y).map(mm) as [number, number]), ...(closed ? { closed: true } : {}), ...paints(style, k) }));
        return;
      }
      case 'path': {
        if (!drawn(style)) return;
        const commands = parsePathData(element.attributes.d ?? '');
        if (!commands) return void notes.add('A path whose data could not be read was left out.');
        return pathShape(commands, ctx);
      }
      case 'text': {
        const collect = (node: XmlElement | string): string => (typeof node === 'string' ? node : node.name === 'tspan' ? node.children.map(collect).join('') : '');
        const words = element.children.map(collect).join('').replace(/\s+/g, ' ').trim();
        if (words === '' || style.fill === 'none') return;
        const [x, y] = apply(matrix, numberAttribute(element, 'x'), numberAttribute(element, 'y'));
        const size = Math.min(MAX_ART_TEXT_SIZE_MM, Math.max(MIN_ART_TEXT_SIZE_MM, style.fontSize * k));
        if (Math.abs(matrix[1]) > 1e-9 || Math.abs(matrix[2]) > 1e-9) notes.add('A rotated text is drawn level.');
        if (words.length > MAX_ART_TEXT_LENGTH) notes.add(`A text longer than ${MAX_ART_TEXT_LENGTH} characters was cut short.`);
        shapes.push(
          finish({
            kind: 'text',
            x: mm(x),
            y: mm(y - size * 0.35),
            text: words.slice(0, MAX_ART_TEXT_LENGTH),
            size: mm(size),
            fill: style.fill,
            ...(style.textAnchor === 'middle' ? { align: 'centre' as const } : style.textAnchor === 'end' ? { align: 'right' as const } : {}),
            ...(style.bold ? { bold: true } : {}),
          }),
        );
        return;
      }
      default:
        notes.add(`<${element.name}> is not known and was left out.`);
    }
  }

  draw(root, { matrix: base, style: DEFAULT_STYLE });

  if (shapes.length === 0) return { ok: false, message: 'Nothing in the SVG can be drawn on a face.' };
  if (shapes.length > options.room) {
    return { ok: false, message: `The drawing has ${shapes.length} shapes and the face has room for ${options.room}. Join or remove shapes in the SVG first.` };
  }
  const errors: ValidationError[] = [];
  validateArt(shapes, 'shape', errors);
  if (errors.length > 0) return { ok: false, message: `The drawing does not fit on a face: ${errors[0]!.path}: ${errors[0]!.message}` };
  return { ok: true, shapes, notes: [...notes], heightMm: mm((box[3]! * options.widthMm) / box[2]!) };
}
