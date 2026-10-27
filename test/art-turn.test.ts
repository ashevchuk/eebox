import { describe, expect, it } from 'vitest';
import { MAX_ART_SHAPES, type ArtShape } from '../src/library/art';
import { artToSvg } from '../src/library/svgExport';
import { importSvg } from '../src/library/svgImport';
import type { ModuleDef } from '../src/library/types';
import { validateArt, type ValidationError } from '../src/library/validate';
import { applyShapeEdit, boundsOf, flipShape, hits, shapeFields, textBox, turnAbout, turnShape } from '../src/ui/artEditor';
import { drawArt } from '../src/view/art';
import { SvgContext } from '../src/view/svgContext';

const rect: ArtShape = { kind: 'rect', x: 10, y: 20, width: 30, height: 10, fill: '#112233' };
const ellipse: ArtShape = { kind: 'ellipse', cx: 20, cy: 30, rx: 10, ry: 4, fill: '#112233' };
const line: ArtShape = { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#000000' };
const polyline: ArtShape = { kind: 'polyline', points: [[0, 0], [10, 0], [10, 4]], stroke: '#000000' };
const path: ArtShape = { kind: 'path', d: 'M 0 0 L 10 0 L 10 4 Z', fill: '#112233' };
const text: ArtShape = { kind: 'text', x: 20, y: 30, text: 'ABCD', size: 5, fill: '#000000', align: 'centre' };

const problems = (art: unknown) => {
  const errors: ValidationError[] = [];
  validateArt(art, 'art', errors);
  return errors.map((e) => `${e.path}: ${e.message}`);
};

describe('turning a shape', () => {
  it('swaps the sides of a rectangle for a quarter turn about its middle, and keeps it for a half turn', () => {
    expect(turnShape(rect, 1)).toMatchObject({ x: 20, y: 10, width: 10, height: 30 });
    expect(turnShape(rect, 3)).toMatchObject({ x: 20, y: 10, width: 10, height: 30 });
    expect(turnShape(rect, 2)).toBe(rect);
  });

  it('swaps the radii of an ellipse', () => {
    expect(turnShape(ellipse, 1)).toMatchObject({ cx: 20, cy: 30, rx: 4, ry: 10 });
    expect(turnShape(ellipse, 2)).toBe(ellipse);
  });

  it('moves the points of a line, a polyline and a path about the middle of their box', () => {
    expect(turnShape(line, 1)).toMatchObject({ x1: 5, y1: -5, x2: 5, y2: 5 });
    expect(turnShape(line, 2)).toMatchObject({ x1: 10, y1: 0, x2: 0, y2: 0 });
    expect(turnShape(line, 3)).toMatchObject({ x1: 5, y1: 5, x2: 5, y2: -5 });
    expect(turnShape(polyline, 2)).toMatchObject({ points: [[10, 4], [0, 4], [0, 0]] });
    expect(turnShape(path, 2)).toMatchObject({ d: 'M 10 4 L 0 4 L 0 0 Z' });
  });

  it('comes back after four quarter turns', () => {
    for (const shape of [line, polyline, path, rect, ellipse]) {
      let turned: ArtShape = shape;
      for (let i = 0; i < 4; i++) turned = turnShape(turned, 1);
      expect(JSON.stringify(turned)).toBe(JSON.stringify(shape));
    }
  });

  it('turns a text by setting its rotation about its own point, between -180 and 180 degrees', () => {
    expect(turnShape(text, 1)).toMatchObject({ x: 20, y: 30, rotation: 90 });
    expect(turnShape(text, 2)).toMatchObject({ rotation: 180 });
    expect(turnShape(text, 3)).toMatchObject({ rotation: -90 });
    expect(turnShape(turnShape(text, 1), 3)).not.toHaveProperty('rotation');
    expect(turnShape({ ...text, rotation: 90 }, 2)).toMatchObject({ rotation: -90 });
  });
});

describe('flipping a shape', () => {
  it('reflects the points of a line, a polyline and a path about the middle of their box', () => {
    expect(flipShape(line, 'horizontal')).toMatchObject({ x1: 10, x2: 0, y1: 0 });
    expect(flipShape(polyline, 'horizontal')).toMatchObject({ points: [[10, 0], [0, 0], [0, 4]] });
    expect(flipShape(polyline, 'vertical')).toMatchObject({ points: [[0, 4], [10, 4], [10, 0]] });
    expect(flipShape(path, 'horizontal')).toMatchObject({ d: 'M 10 0 L 0 0 L 0 4 Z' });
  });

  it('leaves a rectangle and an ellipse as they are, since they are the same reflected', () => {
    expect(flipShape(rect, 'horizontal')).toBe(rect);
    expect(flipShape(ellipse, 'vertical')).toBe(ellipse);
  });

  it('is undone by flipping again, and refuses a text', () => {
    expect(JSON.stringify(flipShape(flipShape(polyline, 'horizontal')!, 'horizontal'))).toBe(JSON.stringify(polyline));
    expect(flipShape(text, 'horizontal')).toBeUndefined();
  });
});

describe('a text that is turned', () => {
  it('is within what the library accepts up to a full turn either way', () => {
    expect(problems([{ ...text, rotation: 360 }, { ...text, rotation: -360 }, { ...text, rotation: 12.5 }])).toEqual([]);
    expect(problems([{ ...text, rotation: 361 }])[0]).toMatch(/art\[0\]\.rotation: must be a number of degrees from -360 to 360/);
    expect(problems([{ ...text, rotation: 'up' }])[0]).toMatch(/rotation/);
    expect(problems([{ ...rect, rotation: 90 }])).toEqual(['art[0].rotation: unknown field']);
  });

  it('has a box that is turned with it, and is hit where the letters are', () => {
    const level = boundsOf(text);
    const upright = boundsOf({ ...text, rotation: 90 });
    expect(upright.x2 - upright.x1).toBeCloseTo(level.y2 - level.y1);
    expect(upright.y2 - upright.y1).toBeCloseTo(level.x2 - level.x1);
    expect(hits({ ...text, rotation: 90 }, { x: 20, y: 30 + (textBox(text).x2 - 20) - 0.5 }, 0.3)).toBe(true);
    expect(hits({ ...text, rotation: 90 }, { x: 20 + (textBox(text).x2 - 20) - 0.5, y: 30 }, 0.3)).toBe(false);
  });

  it('turns a point about another', () => {
    const [x, y] = turnAbout(10, 0, 0, 0, 90);
    expect([Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]).toEqual([0, 10]);
  });

  it('is set in the fields, and a rotation of nothing is taken away', () => {
    expect(shapeFields(text).find((f) => f.key === 'rotation')).toMatchObject({ kind: 'number', value: 0 });
    const set = applyShapeEdit(text, 'rotation', '-90');
    expect(set.ok && set.shape).toMatchObject({ rotation: -90 });
    const cleared = set.ok && applyShapeEdit(set.shape, 'rotation', '0');
    expect(cleared && cleared.ok && 'rotation' in cleared.shape).toBe(false);
    expect(applyShapeEdit(text, 'rotation', '400').ok).toBe(false);
  });

  it('is drawn turned into an SVG', () => {
    const svg = new SvgContext(300, 300, (t) => t.length * 5);
    drawArt(svg as unknown as CanvasRenderingContext2D, [{ ...text, rotation: -90 }, text], { x: 0, y: 0, width: 35, height: 90 }, 2, 2);
    const out = svg.toSvg();
    expect(out).toMatch(/<text x="0" y="0"[^>]*transform="matrix\(0 -1 1 0 20 30\)"/);
    expect(out).toMatch(/<text x="20" y="30"/);
  });
});

describe('a text that is turned, through an SVG', () => {
  const module = (rotation: number | undefined): ModuleDef => ({ id: 'm', kind: 'other', name: 'M', widthUnits: 2, poles: 1, art: [{ ...text, ...(rotation !== undefined ? { rotation } : {}) }] });
  const back = (def: ModuleDef) => {
    const result = importSvg(artToSvg(def), { widthMm: 35, leftMm: 0, topMm: 0, anchor: 'left', room: MAX_ART_SHAPES });
    if (!result.ok) throw new Error(result.message);
    return result;
  };

  it('writes the turn as a transform about the baseline point', () => {
    expect(artToSvg(module(90))).toMatch(/<text x="18\.25" y="30" [^>]*transform="rotate\(90 18\.25 30\)"/);
    expect(artToSvg(module(undefined))).not.toContain('transform');
  });

  it('comes back as the same text, whatever the angle', () => {
    for (const angle of [undefined, 90, -90, 180, 45, -137.5, 12.25]) {
      const result = back(module(angle));
      expect(result.notes).toEqual([]);
      const shape = result.shapes[0] as { x: number; y: number; rotation?: number; text: string };
      expect([angle, shape.text, shape.x, shape.y, shape.rotation]).toEqual([angle, 'ABCD', 20, 30, angle === 180 ? 180 : angle]);
    }
  });

  it('is read from an SVG that someone else wrote, by the turn of its transform', () => {
    const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><text x="10" y="10" font-size="4" fill="#000" transform="rotate(-90 10 10)">Up</text></svg>', { widthMm: 20, leftMm: 0, topMm: 0, anchor: 'left', room: 32 });
    if (!result.ok) throw new Error(result.message);
    expect(result.shapes[0]).toMatchObject({ kind: 'text', text: 'Up', rotation: -90 });
  });
});
