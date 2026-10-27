import { ART_ANCHORS, MIN_ART_PERIOD_UNITS, type ArtAnchor, type ArtShape } from './art';
import { MODULE_UNIT_MM, type ModuleDef } from './types';

export const FACE_HEIGHT_MM = 90;
/** Where the baseline of a text lies below the middle of its letters, as a share of their height; the importer takes it off again. */
export const BASELINE_BELOW_MIDDLE = 0.35;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/** What the importer reads back: how a shape follows the width of the module, which an SVG has no word for. */
export const ANCHOR_ATTRIBUTE = 'data-anchor';
export const PERIOD_ATTRIBUTE = 'data-period';

export const isAnchor = (value: string | undefined): value is ArtAnchor => value !== undefined && (ART_ANCHORS as readonly string[]).includes(value);
export const isPeriod = (value: number): boolean => Number.isFinite(value) && value >= MIN_ART_PERIOD_UNITS;

function paint(shape: ArtShape): string {
  const stroke = shape.stroke ?? 'none';
  const fill = shape.fill ?? 'none';
  return `fill="${fill}" stroke="${stroke}"${shape.stroke !== undefined ? ` stroke-width="${num(shape.strokeWidth ?? 0.5)}"` : ''}`;
}

function element(shape: ArtShape): string {
  const own = `${shape.anchor && shape.anchor !== 'left' ? ` ${ANCHOR_ATTRIBUTE}="${shape.anchor}"` : ''}${shape.period !== undefined ? ` ${PERIOD_ATTRIBUTE}="${num(shape.period)}"` : ''}`;
  switch (shape.kind) {
    case 'line':
      return `<line x1="${num(shape.x1)}" y1="${num(shape.y1)}" x2="${num(shape.x2)}" y2="${num(shape.y2)}" ${paint(shape)}${own}/>`;
    case 'rect':
      return `<rect x="${num(shape.x)}" y="${num(shape.y)}" width="${num(shape.width)}" height="${num(shape.height)}" ${paint(shape)}${own}/>`;
    case 'ellipse':
      return `<ellipse cx="${num(shape.cx)}" cy="${num(shape.cy)}" rx="${num(shape.rx)}" ry="${num(shape.ry)}" ${paint(shape)}${own}/>`;
    case 'polyline':
      return `<${shape.closed ? 'polygon' : 'polyline'} points="${shape.points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')}" ${paint(shape)}${own}/>`;
    case 'path':
      return `<path d="${shape.d}" ${paint(shape)}${own}/>`;
    case 'text': {
      const anchor = { left: 'start', centre: 'middle', right: 'end' }[shape.align ?? 'left'];
      return `<text x="${num(shape.x)}" y="${num(shape.y + shape.size * BASELINE_BELOW_MIDDLE)}" font-size="${num(shape.size)}" font-family="sans-serif" text-anchor="${anchor}"${shape.bold ? ' font-weight="bold"' : ''} fill="${shape.fill ?? '#000000'}" stroke="none"${own}>${escapeXml(shape.text)}</text>`;
    }
  }
}

/**
 * The art of a module as an SVG in millimetres, at the width the module is made for, so that it can be
 * opened in a drawing program or imported onto another module. How each shape follows the width is
 * written as attributes of its own, which the importer reads and a drawing program leaves alone.
 */
export function artToSvg(def: ModuleDef): string {
  const width = def.widthUnits * MODULE_UNIT_MM;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}mm" height="${FACE_HEIGHT_MM}mm" viewBox="0 0 ${num(width)} ${FACE_HEIGHT_MM}">`,
    `<title>${escapeXml(def.name)}</title>`,
    ...(def.art ?? []).map((shape) => `  ${element(shape)}`),
    '</svg>',
    '',
  ].join('\n');
}
