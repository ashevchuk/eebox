import { describe, expect, it } from 'vitest';
import schemaText from '../libraries/library.schema.json?raw';
import { MAX_ART_PATH_SEGMENTS, flattenPath, formatPath, parsePath, placeArt, type ArtShape } from '../src/library/art';
import { ART_SPECS, validateArt, type ValidationError } from '../src/library/validate';
import { boundsOf, dragHandle, hits, shapeFields, translate } from '../src/ui/artEditor';
import { drawArt } from '../src/view/art';
import { SvgContext } from '../src/view/svgContext';

const triangle: ArtShape = { kind: 'path', d: 'M 0 0 L 10 0 L 5 8 Z', fill: '#112233' };
const curve: ArtShape = { kind: 'path', d: 'M 0 0 C 0 10 10 10 10 0', stroke: '#000000' };

const messages = (art: unknown) => {
  const errors: ValidationError[] = [];
  validateArt(art, 'art', errors);
  return errors.map((e) => `${e.path}: ${e.message}`);
};

describe('path data', () => {
  it('is read in the one form a library holds', () => {
    expect(parsePath('M 1 2 L 3.5 -4 C 1 2 3 4 5 6 Z')).toEqual([
      { op: 'M', x: 1, y: 2 },
      { op: 'L', x: 3.5, y: -4 },
      { op: 'C', x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
      { op: 'Z' },
    ]);
  });

  it('is refused in any other form', () => {
    for (const bad of ['', 'L 1 2', 'M 1', 'M 1 2 3', 'M 1  2', 'M1 2', 'm 1 2', 'M 1 2 Q 3 4 5 6', 'M 1e3 2', 'M 1 2 Z L 3 4', 'M 5000 0', 'M 1 2 L x y', ' M 1 2']) {
      expect([bad, parsePath(bad)]).toEqual([bad, undefined]);
    }
  });

  it('is refused when it has more commands than the limit', () => {
    const many = `M 0 0${' L 1 1'.repeat(MAX_ART_PATH_SEGMENTS)}`;
    expect(parsePath(many)).toBeUndefined();
    expect(parsePath(`M 0 0${' L 1 1'.repeat(MAX_ART_PATH_SEGMENTS - 1)}`)).toHaveLength(MAX_ART_PATH_SEGMENTS);
  });

  it('is written back the way it is read, with the numbers rounded', () => {
    expect(formatPath(parsePath('M 1 2 L 3 4 Z')!)).toBe('M 1 2 L 3 4 Z');
    expect(formatPath([{ op: 'M', x: 1.23456, y: 2 }])).toBe('M 1.235 2');
  });

  it('is cut into pieces of straight steps, a closed piece ending where it began', () => {
    const pieces = flattenPath(parsePath('M 0 0 L 4 0 Z M 10 10 C 10 20 20 20 20 10')!);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toEqual([[0, 0], [4, 0], [0, 0]]);
    expect(pieces[1]).toHaveLength(9);
    expect(pieces[1]![8]).toEqual([20, 10]);
  });
});

describe('a path on the face of a module', () => {
  it('is accepted with a fill or a stroke and refused with neither or with bad data', () => {
    expect(messages([triangle, curve])).toEqual([]);
    expect(messages([{ kind: 'path', d: 'M 0 0 L 1 1' }])).toEqual(['art[0]: needs a stroke or a fill, or nothing is drawn']);
    expect(messages([{ ...triangle, d: 'M 0 0 L' }])[0]).toMatch(/art\[0\]\.d: must be path data as "M x y L x y C/);
    expect(messages([{ ...triangle, closed: true }])).toEqual(['art[0].closed: unknown field']);
  });

  it('follows the anchor like any other shape, with every x of it, control points too', () => {
    const stretched = placeArt([{ ...curve, anchor: 'stretch' }], 1, 3)[0] as { d: string };
    expect(stretched.d).toBe('M 0 0 C 0 10 30 10 30 0');
    const right = placeArt([{ ...curve, anchor: 'right' }], 1, 3)[0] as { d: string };
    expect(right.d).toBe('M 35 0 C 35 10 45 10 45 0');
    const tiles = placeArt([{ ...triangle, anchor: 'tile', period: 1 }], 1, 2);
    expect(tiles.map((t) => (t as { d: string }).d)).toEqual(['M 0 0 L 10 0 L 5 8 Z', 'M 17.5 0 L 27.5 0 L 22.5 8 Z']);
  });

  it('is drawn with its curves into an SVG', () => {
    const svg = new SvgContext(200, 200, (text) => text.length * 5);
    drawArt(svg as unknown as CanvasRenderingContext2D, [curve, triangle], { x: 10, y: 20, width: 35, height: 90 }, 2, 2);
    const out = svg.toSvg();
    expect(out).toContain('d="M0 0C0 10 10 10 10 0"');
    expect(out).toContain('d="M0 0L10 0L5 8Z"');
  });
});

describe('a path in the editor', () => {
  it('has a box that follows its curve and not its control points', () => {
    const box = boundsOf(curve);
    expect(box.x1).toBe(0);
    expect(box.x2).toBe(10);
    expect(box.y2).toBeCloseTo(7.5, 1);
  });

  it('is moved, and scaled by the handles of its box', () => {
    expect(translate(triangle, 5, 2)).toMatchObject({ d: 'M 5 2 L 15 2 L 10 10 Z' });
    expect(dragHandle(triangle, 'se', { x: 20, y: 16 })).toMatchObject({ d: 'M 0 0 L 20 0 L 10 16 Z' });
    expect(dragHandle(triangle, 'w', { x: -10, y: 0 })).toMatchObject({ d: 'M -10 0 L 10 0 L 0 8 Z' });
  });

  it('is under a point on its fill or near its line', () => {
    expect(hits(triangle, { x: 5, y: 3 }, 0.5)).toBe(true);
    expect(hits(triangle, { x: 1, y: 7 }, 0.5)).toBe(false);
    expect(hits(curve, { x: 5, y: 7.4 }, 0.5)).toBe(true);
    expect(hits(curve, { x: 5, y: 2 }, 0.5)).toBe(false);
  });

  it('shows how long it is and has the fields of a drawn shape, but no data to edit', () => {
    const keys = shapeFields(triangle).map((f) => f.key);
    expect(keys).toEqual(['kind', 'segments', 'fill', 'stroke', 'strokeWidth', 'anchor']);
    expect(shapeFields(triangle).find((f) => f.key === 'segments')?.value).toBe('4 commands, taken from an SVG');
  });
});

describe('library schema for a path', () => {
  const schema = JSON.parse(schemaText) as Record<string, any>;
  const path = schema.definitions.artShape.oneOf[5];

  it('has the same fields as the validator and is the last of the shapes', () => {
    expect(Object.keys(path.properties).sort()).toEqual(Object.keys(ART_SPECS.path).sort());
    expect(path.required.sort()).toEqual(['d', 'kind']);
    expect(path.additionalProperties).toBe(false);
  });

  it('has a pattern that accepts what the parser accepts and refuses what it refuses', () => {
    const pattern = new RegExp(path.properties.d.pattern);
    expect(pattern.test('M 1 2 L 3.5 -4 C 1 2 3 4 5 6 Z')).toBe(true);
    expect(pattern.test('M 0 0 Z M 1 1 L 2 2')).toBe(true);
    for (const bad of ['L 1 2', 'M 1', 'M 1 2 Q 1 2 3 4', 'M 1  2', 'm 1 2']) expect(pattern.test(bad)).toBe(false);
  });
});
