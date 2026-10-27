import { describe, expect, it } from 'vitest';
import type { ArtShape } from '../src/library/art';
import { SvgContext } from '../src/view/svgContext';
import { drawArt } from '../src/view/art';

const face = { x: 100, y: 200, width: 35, height: 90 };
const draw = (art: ArtShape[], baseUnits = 2, widthUnits = 2): string => {
  const svg = new SvgContext(500, 500, (text) => text.length * 5);
  drawArt(svg as unknown as CanvasRenderingContext2D, art, face, baseUnits, widthUnits);
  return svg.toSvg();
};

describe('the art of a module drawn into an SVG', () => {
  it('clips to the face and draws at its corner', () => {
    const svg = draw([{ kind: 'rect', x: 2, y: 3, width: 4, height: 5, fill: '#112233' }]);
    expect(svg).toContain('<clipPath');
    expect(svg).toMatch(/<path d="M2 3h4v5h-4Z" fill="#112233"[^>]*transform="matrix\(1 0 0 1 100 200\)"/);
  });

  it('draws a line, an ellipse and a closed polyline with their colours', () => {
    const svg = draw([
      { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 10, stroke: '#ff0000', strokeWidth: 2 },
      { kind: 'ellipse', cx: 10, cy: 10, rx: 4, ry: 2, stroke: '#00ff00' },
      { kind: 'polyline', points: [[0, 0], [5, 0], [5, 5]], closed: true, fill: '#0000ff' },
    ]);
    expect(svg).toMatch(/d="M0 0L10 10"[^>]*stroke="#ff0000"[^>]*stroke-width="2"/);
    expect(svg).toMatch(/A4 2 0 1 1 [^"]*Z"[^>]*stroke="#00ff00"/);
    expect(svg).toMatch(/d="M0 0L5 0L5 5Z"[^>]*fill="#0000ff"/);
  });

  it('writes a text with its size, alignment and weight, and escapes it', () => {
    const svg = draw([{ kind: 'text', x: 5, y: 40, text: 'A<B&"C"', size: 4, fill: '#000000', align: 'centre', bold: true }]);
    expect(svg).toContain('font-size="4"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('>A&lt;B&amp;&quot;C&quot;</text>');
    expect(svg).not.toContain('A<B');
  });

  it('draws a tile once for each period that fits and follows the width of the copy', () => {
    const tile: ArtShape = { kind: 'rect', x: 1, y: 1, width: 3, height: 3, fill: '#000000', anchor: 'tile', period: 1 };
    expect(draw([tile], 1, 3).match(/<path d="M[^"]*h3v3/g)).toHaveLength(3);
    expect(draw([tile], 1, 5).match(/<path d="M[^"]*h3v3/g)).toHaveLength(5);
  });

  it('stretches a shape with the copy', () => {
    const svg = draw([{ kind: 'rect', x: 2, y: 3, width: 4, height: 5, fill: '#112233', anchor: 'stretch' }], 1, 3);
    expect(svg).toContain('d="M6 3h12v5h-12Z"');
  });
});
