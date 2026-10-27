import { describe, expect, it } from 'vitest';
import { MAX_ART_SHAPES, formatPath, parsePath, type ArtShape } from '../src/library/art';
import { importSvg, parsePaint, parsePathData, parseTransform, type SvgImportOptions } from '../src/library/svgImport';
import { validateArt, type ValidationError } from '../src/library/validate';

const options: SvgImportOptions = { widthMm: 10, leftMm: 2, topMm: 20, anchor: 'left', room: MAX_ART_SHAPES };
const svg = (body: string, attributes = 'viewBox="0 0 10 10"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;

function shapes(text: string, change: Partial<SvgImportOptions> = {}): ArtShape[] {
  const result = importSvg(text, { ...options, ...change });
  if (!result.ok) throw new Error(result.message);
  return result.shapes;
}
const notes = (text: string): string[] => {
  const result = importSvg(text, options);
  return result.ok ? result.notes : [result.message];
};
const refusal = (text: string, change: Partial<SvgImportOptions> = {}) => {
  const result = importSvg(text, { ...options, ...change });
  if (result.ok) throw new Error('expected a refusal');
  return result.message;
};

describe('transforms', () => {
  it('are read, in the order they are written', () => {
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(parseTransform('translate(3 4)')).toEqual([1, 0, 0, 1, 3, 4]);
    expect(parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(parseTransform('translate(10,0) scale(2,3)')).toEqual([2, 0, 0, 3, 10, 0]);
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('turn a rotation about a point', () => {
    const m = parseTransform('rotate(90 5 5)')!;
    const at = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]].map((v) => Math.round(v * 1e6) / 1e6);
    expect(at(10, 5)).toEqual([5, 10]);
    expect(at(5, 5)).toEqual([5, 5]);
  });

  it('are refused when a function is not known or the text has something else in it', () => {
    expect(parseTransform('perspective(2)')).toBeUndefined();
    expect(parseTransform('translate(1)  junk')).toBeUndefined();
    expect(parseTransform('scale()')).toBeUndefined();
    expect(parseTransform('matrix(1 2 3)')).toBeUndefined();
  });
});

describe('paints', () => {
  it('are colours, none, or nothing for what cannot be drawn', () => {
    expect(parsePaint('#F00')).toBe('#ff0000');
    expect(parsePaint('#A0b1C2')).toBe('#a0b1c2');
    expect(parsePaint('red')).toBe('#ff0000');
    expect(parsePaint('rgb(255, 128, 0)')).toBe('#ff8000');
    expect(parsePaint('rgb(100%, 0%, 0%)')).toBe('#ff0000');
    expect(parsePaint('none')).toBe('none');
    expect(parsePaint('currentColor')).toBe('#000000');
    expect(parsePaint('url(#g)')).toBeUndefined();
    expect(parsePaint('hsl(0, 100%, 50%)')).toBeUndefined();
  });
});

describe('path data', () => {
  const read = (d: string) => formatPath(parsePathData(d)!);

  it('is made absolute, with lines, horizontals and verticals', () => {
    expect(read('M10 10 h5 v5 H0 V0 z')).toBe('M 10 10 L 15 10 L 15 15 L 0 15 L 0 0 Z');
    expect(read('m1 1 l2 2 l-1 0')).toBe('M 1 1 L 3 3 L 2 3');
  });

  it('takes more pairs after a move as lines', () => {
    expect(read('M0 0 10 0 10 10')).toBe('M 0 0 L 10 0 L 10 10');
    expect(read('m0 0 10 0 0 10')).toBe('M 0 0 L 10 0 L 10 10');
  });

  it('reads numbers that run together as SVG writes them', () => {
    expect(read('M.5.5L1-1')).toBe('M 0.5 0.5 L 1 -1');
    expect(read('M1e1,2E0')).toBe('M 10 2');
  });

  it('turns curves into cubic ones, a quadratic and a smooth one among them', () => {
    expect(read('M0 0 C1 1 2 2 3 3')).toBe('M 0 0 C 1 1 2 2 3 3');
    expect(read('M0 0 Q3 0 3 3')).toBe('M 0 0 C 2 0 3 1 3 3');
    expect(read('M0 0 C0 1 1 2 2 2 S4 2 4 0')).toBe('M 0 0 C 0 1 1 2 2 2 C 3 2 4 2 4 0');
    expect(read('M0 0 Q3 0 3 3 T6 6')).toMatch(/^M 0 0 C 2 0 3 1 3 3 C /);
  });

  it('turns an arc into curves that end where it ends and stay on the circle', () => {
    const commands = parsePathData('M10 0 A10 10 0 0 1 0 10')!;
    expect(commands).toHaveLength(2);
    const last = commands[1]! as { x: number; y: number };
    expect([last.x, last.y]).toEqual([0, 10]);
    const half = parsePathData('M0 0 A5 5 0 1 1 10 0')!;
    expect(half).toHaveLength(3);
    const mid = half[1] as { x: number; y: number };
    expect(Math.hypot(mid.x - 5, mid.y - 0)).toBeCloseTo(5, 3);
  });

  it('reads arc flags that are written without separators', () => {
    expect(parsePathData('M0 0a5 5 0 1010 0')).toBeDefined();
  });

  it('turns a degenerate arc into a line', () => {
    expect(read('M0 0 A0 5 0 0 1 4 4')).toBe('M 0 0 L 4 4');
    expect(read('M3 3 A5 5 0 0 1 3 3')).toBe('M 3 3 L 3 3');
  });

  it('goes on from the start of a piece after it is closed, with a move that says so', () => {
    expect(read('M5 5 L10 5 Z L8 8')).toBe('M 5 5 L 10 5 Z M 5 5 L 8 8');
  });

  it('is refused when it is not path data', () => {
    for (const bad of ['', 'L 1 2', 'M 1', 'M 0 0 X', 'M 0 0 L 1', 'M0 0 A1 1 0 2 0 1 1', 'M0 0 1', 'M0 0 Z 1 1']) {
      expect([bad, parsePathData(bad)]).toEqual([bad, undefined]);
    }
  });

  it('gives what the library reads back', () => {
    for (const d of ['M0 0 L10 0 L5 8Z', 'M0 0 Q5 9 10 0 T20 0', 'M2 2 A4 3 30 0 1 9 7 Z']) {
      const text = formatPath(parsePathData(d)!);
      expect(parsePath(text)).toBeDefined();
    }
  });
});

describe('the shapes of an SVG', () => {
  it('puts the drawing where it is wanted, scaled to the width it is given', () => {
    const [rect] = shapes(svg('<rect x="2" y="1" width="4" height="3" fill="#112233"/>'), { widthMm: 20, leftMm: 5, topMm: 30 });
    expect(rect).toEqual({ kind: 'rect', x: 9, y: 32, width: 8, height: 6, fill: '#112233' });
  });

  it('takes the proportions from the width and height when there is no view box', () => {
    const result = importSvg(svg('<circle cx="5" cy="5" r="5"/>', 'width="100" height="50"'), { ...options, widthMm: 20 });
    expect(result.ok && result.heightMm).toBe(10);
  });

  it('draws a circle and an ellipse as ellipses, and a line with its stroke', () => {
    const drawn = shapes(svg('<circle cx="5" cy="5" r="2" fill="red"/><ellipse cx="5" cy="5" rx="4" ry="1" stroke="blue" fill="none"/><line x1="0" y1="0" x2="10" y2="10" stroke="#000" stroke-width="0.5"/>'));
    expect(drawn[0]).toEqual({ kind: 'ellipse', cx: 7, cy: 25, rx: 2, ry: 2, fill: '#ff0000' });
    expect(drawn[1]).toEqual({ kind: 'ellipse', cx: 7, cy: 25, rx: 4, ry: 1, stroke: '#0000ff', strokeWidth: 1 });
    expect(drawn[2]).toEqual({ kind: 'line', x1: 2, y1: 20, x2: 12, y2: 30, stroke: '#000000', strokeWidth: 0.5 });
  });

  it('draws a polygon as a closed polyline, an open polyline with a fill as a path, and one without as a polyline', () => {
    const drawn = shapes(svg('<polygon points="0,0 10,0 5,8" fill="green"/><polyline points="0 0 5 5 10 0" fill="red"/><polyline points="0 0 5 5 10 0" fill="none" stroke="black"/>'));
    expect(drawn[0]).toMatchObject({ kind: 'polyline', closed: true, fill: '#008000', points: [[2, 20], [12, 20], [7, 28]] });
    expect(drawn[1]).toMatchObject({ kind: 'path', d: 'M 2 20 L 7 25 L 12 20', fill: '#ff0000' });
    expect(drawn[2]).toMatchObject({ kind: 'polyline', stroke: '#000000' });
    expect(drawn[2]).not.toHaveProperty('closed');
  });

  it('draws a path as a path, curves and all', () => {
    const [path] = shapes(svg('<path d="M0 0 C0 10 10 10 10 0 Z" fill="#fff" stroke="#000"/>'));
    expect(path).toMatchObject({ kind: 'path', d: 'M 2 20 C 2 30 12 30 12 20 Z', fill: '#ffffff', stroke: '#000000' });
  });

  it('gives a rounded rectangle as a path, and a rectangle that is turned as a path too', () => {
    const [rounded] = shapes(svg('<rect width="10" height="10" rx="2" fill="red"/>'));
    expect(rounded).toMatchObject({ kind: 'path' });
    expect((parsePath((rounded as { d: string }).d) ?? []).filter((c) => c.op === 'C')).toHaveLength(4);
    const [turned] = shapes(svg('<rect width="4" height="2" fill="red" transform="rotate(30)"/>'));
    expect(turned).toMatchObject({ kind: 'path' });
    const [flat] = shapes(svg('<rect width="4" height="2" fill="red" transform="translate(1 1) scale(2)"/>'));
    expect(flat).toMatchObject({ kind: 'rect', x: 3, y: 21, width: 8, height: 4 });
    const [mirrored] = shapes(svg('<rect x="1" width="4" height="2" fill="red" transform="scale(-1 1)"/>'));
    expect(mirrored).toMatchObject({ kind: 'rect', x: -3, width: 4 });
  });

  it('draws an ellipse that is turned as a path', () => {
    const [turned] = shapes(svg('<ellipse cx="5" cy="5" rx="4" ry="1" fill="red" transform="rotate(45 5 5)"/>'));
    expect(turned).toMatchObject({ kind: 'path' });
  });

  it('draws a text with its size, its anchor and its weight, and cuts a long one short', () => {
    const [text] = shapes(svg('<text x="5" y="8" font-size="2" text-anchor="middle" font-weight="bold" fill="#123456">Hello <tspan>world</tspan></text>'));
    expect(text).toMatchObject({ kind: 'text', text: 'Hello world', size: 2, align: 'centre', bold: true, fill: '#123456', x: 7 });
    expect((text as { y: number }).y).toBeCloseTo(27.3, 5);
    const long = importSvg(svg(`<text x="0" y="5">${'x'.repeat(60)}</text>`), options);
    expect(long.ok && (long.shapes[0] as { text: string }).text).toHaveLength(40);
    expect(long.ok && long.notes).toContain('A text longer than 40 characters was cut short.');
  });

  it('takes colours and widths down from groups, and from a style attribute over an attribute', () => {
    const drawn = shapes(svg('<g fill="red" stroke="blue" stroke-width="2"><rect width="2" height="2"/><rect width="2" height="2" style="fill:#00ff00; stroke-width:4"/><rect width="2" height="2" fill="none"/></g>'));
    expect(drawn[0]).toMatchObject({ fill: '#ff0000', stroke: '#0000ff', strokeWidth: 2 });
    expect(drawn[1]).toMatchObject({ fill: '#00ff00', strokeWidth: 4 });
    expect(drawn[2]).toMatchObject({ stroke: '#0000ff' });
    expect(drawn[2]).not.toHaveProperty('fill');
  });

  it('applies the transform of a group to what it holds', () => {
    const [rect] = shapes(svg('<g transform="translate(3 0)"><rect width="2" height="2"/></g>'));
    expect(rect).toMatchObject({ x: 5, y: 20 });
  });

  it('draws black where nothing is said, as SVG does, and nothing where there is neither a fill nor a line', () => {
    expect(shapes(svg('<rect width="2" height="2"/>'))[0]).toMatchObject({ fill: '#000000' });
    expect(refusal(svg('<rect width="2" height="2" fill="none"/>'))).toBe('Nothing in the SVG can be drawn on a face.');
    expect(refusal(svg('<line x1="0" y1="0" x2="5" y2="5"/>'))).toBe('Nothing in the SVG can be drawn on a face.');
  });

  it('leaves out what is not shown or has no size', () => {
    expect(refusal(svg('<g display="none"><rect width="2" height="2"/></g><rect width="0" height="2"/><circle r="0"/>'))).toBe('Nothing in the SVG can be drawn on a face.');
  });

  it('takes the anchor and the period for every shape', () => {
    const drawn = shapes(svg('<rect width="2" height="2"/><circle cx="5" cy="5" r="1"/>'), { anchor: 'stretch' });
    expect(drawn.map((s) => s.anchor)).toEqual(['stretch', 'stretch']);
    const tiles = shapes(svg('<rect width="2" height="2"/>'), { anchor: 'tile', period: 2 });
    expect(tiles[0]).toMatchObject({ anchor: 'tile', period: 2 });
    expect(shapes(svg('<rect width="2" height="2"/>'))[0]).not.toHaveProperty('anchor');
  });

  it('gives only shapes the library accepts', () => {
    const drawn = shapes(svg('<rect width="2" height="2"/><circle cx="5" cy="5" r="1"/><line x1="0" y1="0" x2="5" y2="5" stroke="red"/><polygon points="0,0 4,0 2,3"/><path d="M0 0 A3 3 0 1 1 6 0 Z" fill="red"/><text x="1" y="5">T</text>'));
    const errors: ValidationError[] = [];
    validateArt(drawn, 'art', errors);
    expect(errors).toEqual([]);
  });
});

describe('what an SVG may hold and a face may not', () => {
  it('is said, once, and not drawn: images, links to other shapes, scripts and styles', () => {
    const list = notes(svg('<rect width="2" height="2"/><image href="data:image/png;base64,AAAA"/><use href="#x"/><use href="#y"/><script>alert(1)</script><style>rect{fill:red}</style><foreignObject><p/></foreignObject>'));
    expect(list).toEqual(['<image> is not drawn.', '<use> is not drawn.', '<script> is not drawn.', '<style> is not drawn.', '<foreignObject> is not drawn.']);
  });

  it('is left out quietly when it is a title, a description or definitions', () => {
    expect(notes(svg('<title>x</title><desc>y</desc><defs><linearGradient id="g"/></defs><rect width="2" height="2"/>'))).toEqual([]);
  });

  it('is said when a gradient or a colour that is not known would have been used', () => {
    expect(notes(svg('<defs><linearGradient id="g"/></defs><rect width="2" height="2" fill="url(#g)"/>'))).toEqual(['A gradient or pattern cannot be drawn on a face and is shown in grey.']);
    expect(notes(svg('<rect width="2" height="2" fill="hsl(1,2%,3%)"/>'))[0]).toMatch(/colour \(hsl/);
  });

  it('is said when opacity, dashes, clipping or filters would have been used', () => {
    expect(notes(svg('<rect width="2" height="2" opacity="0.5"/>'))).toEqual(['Opacity, dashes, clipping and filters (opacity) are not drawn.']);
  });

  it('is said when a transform or a path could not be read, and when a text is skewed, which a face cannot draw', () => {
    expect(notes(svg('<rect width="2" height="2" transform="wobble(2)"/><rect width="2" height="2"/>'))).toEqual(['The transform of a <rect> was not understood, so it was left out.']);
    expect(notes(svg('<path d="M 0" fill="red"/><rect width="2" height="2"/>'))).toEqual(['A path whose data could not be read was left out.']);
    expect(notes(svg('<text x="1" y="5" transform="skewX(20)">a</text>'))).toEqual(['A skewed or stretched text is drawn straight.']);
    expect(notes(svg('<text x="1" y="5" transform="rotate(20)">a</text>'))).toEqual([]);
  });

  it('is said when it is not known at all', () => {
    expect(notes(svg('<rect width="2" height="2"/><blink/>'))).toEqual(['<blink> is not known and was left out.']);
  });
});

describe('an SVG that cannot be imported', () => {
  it('is refused when it is not an SVG, or cannot be read', () => {
    expect(refusal('<html/>')).toBe('This is not an SVG: the first element is not <svg>.');
    expect(refusal('not xml')).toMatch(/not an SVG that can be read/);
    expect(refusal('<!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"/>')).toMatch(/document type or entities/);
  });

  it('is refused when it does not say how big it is, or the width asked for is not one', () => {
    expect(refusal('<svg><rect width="1" height="1"/></svg>')).toMatch(/needs a viewBox/);
    expect(refusal(svg('<rect width="1" height="1"/>', 'viewBox="0 0 0 5"'))).toMatch(/needs a viewBox/);
    expect(refusal(svg('<rect width="1" height="1"/>'), { widthMm: 0 })).toBe('Give the drawing a width on the face.');
  });

  it('is refused when it has more shapes than the face has room for', () => {
    const many = svg('<rect width="1" height="1"/>'.repeat(5));
    expect(refusal(many, { room: 3 })).toBe('The drawing has 5 shapes and the face has room for 3. Join or remove shapes in the SVG first.');
  });

  it('is refused when a shape would be outside what a library may hold', () => {
    expect(refusal(svg('<rect x="0" y="0" width="1" height="1"/><rect x="999999" width="1" height="1"/>'))).toMatch(/does not fit on a face: shape\[1\]/);
  });

  it('leaves out a path with too many commands, and says so', () => {
    const d = `M0 0${' L1 1'.repeat(500)}`;
    const result = importSvg(svg(`<path d="${d}" stroke="red" fill="none"/><rect width="1" height="1"/>`), options);
    expect(result.ok && result.notes).toEqual(['A path with more than 400 commands was left out; simplify it first.']);
  });
});
