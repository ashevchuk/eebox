import { formatPath, mapPathPoints, parsePath, type PlacedShape } from '../library/art';
import { FONT_FAMILY } from '../view/font';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgElement(tag: string, attributes: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** The shape as SVG, in pixels at `scale` pixels to the millimetre. */
export function shapeElement(shape: PlacedShape, scale: number): SVGElement {
  const paint = {
    fill: shape.fill ?? 'none',
    stroke: shape.kind === 'text' ? 'none' : (shape.stroke ?? 'none'),
    'stroke-width': (shape.strokeWidth ?? 0.5) * scale,
    'stroke-linejoin': 'round',
  };
  switch (shape.kind) {
    case 'line':
      return svgElement('line', { x1: shape.x1 * scale, y1: shape.y1 * scale, x2: shape.x2 * scale, y2: shape.y2 * scale, ...paint, fill: 'none' });
    case 'rect':
      return svgElement('rect', { x: shape.x * scale, y: shape.y * scale, width: shape.width * scale, height: shape.height * scale, ...paint });
    case 'ellipse':
      return svgElement('ellipse', { cx: shape.cx * scale, cy: shape.cy * scale, rx: shape.rx * scale, ry: shape.ry * scale, ...paint });
    case 'polyline':
      return svgElement(shape.closed ? 'polygon' : 'polyline', { points: shape.points.map(([x, y]) => `${x * scale},${y * scale}`).join(' '), ...paint });
    case 'path': {
      const commands = parsePath(shape.d) ?? [];
      return svgElement('path', { d: formatPath(mapPathPoints(commands, (x, y) => [x * scale, y * scale])), ...paint });
    }
    case 'text':
      return svgElement(
        'text',
        {
          x: shape.x * scale,
          y: shape.y * scale,
          'font-size': shape.size * scale,
          'font-family': FONT_FAMILY,
          'font-weight': shape.bold ? 'bold' : 'normal',
          'text-anchor': { left: 'start', centre: 'middle', right: 'end' }[shape.align ?? 'left'],
          'dominant-baseline': 'central',
          fill: shape.fill ?? '#000000',
          ...(shape.rotation ? { transform: `rotate(${shape.rotation} ${shape.x * scale} ${shape.y * scale})` } : {}),
        },
        shape.text,
      );
  }
}

