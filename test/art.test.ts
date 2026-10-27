import { describe, expect, it } from 'vitest';
import { MAX_ART_SHAPES, MAX_ART_TILES, placeArt, type ArtShape } from '../src/library/art';
import { validateArt, validateLibrary, type ValidationError } from '../src/library/validate';
import type { Library, ModuleDef } from '../src/library/types';

const problems = (art: unknown): ValidationError[] => {
  const errors: ValidationError[] = [];
  validateArt(art, 'art', errors);
  return errors;
};
const messages = (art: unknown) => problems(art).map((e) => `${e.path}: ${e.message}`);

const rect: ArtShape = { kind: 'rect', x: 10, y: 20, width: 30, height: 40, fill: '#112233' };

describe('the validation of the art of a module', () => {
  it('accepts a shape of each kind', () => {
    const art: ArtShape[] = [
      rect,
      { kind: 'line', x1: 0, y1: 0, x2: 5, y2: 5, stroke: '#000000', strokeWidth: 1 },
      { kind: 'ellipse', cx: 8, cy: 8, rx: 3, ry: 2, stroke: '#ffffff', anchor: 'centre' },
      { kind: 'polyline', points: [[0, 0], [4, 0], [4, 4]], closed: true, fill: '#abcdef', anchor: 'stretch' },
      { kind: 'text', x: 8, y: 30, text: 'RCD', size: 4, fill: '#000000', align: 'centre', bold: true },
      { kind: 'rect', x: 0, y: 5, width: 5, height: 5, fill: '#000000', anchor: 'tile', period: 1 },
    ];
    expect(problems(art)).toEqual([]);
  });

  it('refuses what is not a list of known shapes', () => {
    expect(messages({})).toEqual(['art: must be an array']);
    expect(messages([{ kind: 'star' }])).toEqual(['art[0].kind: must be one of: line, rect, ellipse, polyline, text']);
    expect(messages([{ x: 1 }])).toEqual(['art[0].kind: must be one of: line, rect, ellipse, polyline, text']);
  });

  it('refuses unknown fields, so a typo does not drop part of a drawing', () => {
    expect(messages([{ ...rect, colour: '#000000' }])).toEqual(['art[0].colour: unknown field']);
  });

  it('checks colours, sizes and coordinates', () => {
    expect(messages([{ ...rect, fill: 'red' }])).toEqual(['art[0].fill: must be a colour like #1f2937']);
    expect(messages([{ ...rect, width: 0 }])[0]).toMatch(/art\[0\]\.width: must be above 0/);
    expect(messages([{ ...rect, x: 5000 }])[0]).toMatch(/art\[0\]\.x: must be a number of mm/);
    expect(messages([{ ...rect, strokeWidth: 100, stroke: '#000000' }])[0]).toMatch(/art\[0\]\.strokeWidth/);
    expect(messages([{ kind: 'text', x: 0, y: 0, text: 'a\nb', size: 4, fill: '#000000' }])[0]).toMatch(/art\[0\]\.text: must be 1 to 40 characters on one line/);
    expect(messages([{ kind: 'text', x: 0, y: 0, text: 'x', size: 500, fill: '#000000' }])[0]).toMatch(/art\[0\]\.size: must be from 1 to 60 mm/);
    expect(messages([{ kind: 'polyline', points: [[0, 0]], stroke: '#000000' }])[0]).toMatch(/art\[0\]\.points: must list 2 to 64 points/);
  });

  it('wants what each kind draws with: a stroke for a line, a fill for a text, one of them for the rest', () => {
    expect(messages([{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }])).toEqual(['art[0].stroke: is required for a line']);
    expect(messages([{ kind: 'text', x: 0, y: 0, text: 'x', size: 4 }])).toEqual(['art[0].fill: is required for a text: the colour of its letters']);
    expect(messages([{ kind: 'rect', x: 0, y: 0, width: 1, height: 1 }])).toEqual(['art[0]: needs a stroke or a fill, or nothing is drawn']);
    expect(messages([{ kind: 'polyline', points: [[0, 0], [1, 1]], fill: '#000000' }])[0]).toMatch(/needs "closed": true/);
  });

  it('wants a period for a tile and nowhere else', () => {
    expect(messages([{ ...rect, anchor: 'tile' }])).toEqual(['art[0].period: is required for the anchor "tile"']);
    expect(messages([{ ...rect, period: 1 }])).toEqual(['art[0].period: is only allowed for the anchor "tile"']);
    expect(messages([{ ...rect, anchor: 'tile', period: 0.01 }])[0]).toMatch(/art\[0\]\.period: must be a number of units from 0.25/);
  });

  it('allows at most so many shapes', () => {
    expect(messages(Array.from({ length: MAX_ART_SHAPES + 1 }, () => rect))).toEqual([`art: at most ${MAX_ART_SHAPES} shapes`]);
  });

  it('is part of the validation of a library, with the path of the module', () => {
    const module: ModuleDef = { id: 'm', kind: 'other', name: 'M', widthUnits: 1, poles: 1, art: [{ ...rect, fill: 'red' }] };
    const library: Library = { schemaVersion: 1, id: 'l', name: 'L', modules: [module], enclosures: [] };
    const result = validateLibrary(library);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((e) => e.path)).toEqual(['modules[0].art[0].fill']);
  });
});

describe('the art on a copy of another width', () => {
  const at = (shape: ArtShape, baseUnits: number, widthUnits: number) => placeArt([shape], baseUnits, widthUnits);

  it('keeps a left shape where it is and drops the anchor', () => {
    expect(at({ ...rect, anchor: 'left' }, 2, 5)).toEqual([{ kind: 'rect', x: 10, y: 20, width: 30, height: 40, fill: '#112233' }]);
    expect(at(rect, 2, 5)[0]).not.toHaveProperty('anchor');
  });

  it('moves a right shape with the right edge and a centre shape by half as much', () => {
    expect(at({ ...rect, anchor: 'right' }, 2, 5)[0]).toMatchObject({ x: 10 + 3 * 17.5, width: 30 });
    expect(at({ ...rect, anchor: 'centre' }, 2, 5)[0]).toMatchObject({ x: 10 + 1.5 * 17.5, width: 30 });
    expect(at({ ...rect, anchor: 'right' }, 2, 1)[0]).toMatchObject({ x: 10 - 17.5 });
  });

  it('scales a stretched shape across the width and leaves what is drawn along y alone', () => {
    expect(at({ ...rect, anchor: 'stretch' }, 2, 4)[0]).toMatchObject({ x: 20, width: 60, y: 20, height: 40 });
    expect(at({ kind: 'ellipse', cx: 10, cy: 5, rx: 4, ry: 3, stroke: '#000000', anchor: 'stretch' }, 1, 3)[0]).toMatchObject({ cx: 30, rx: 12, ry: 3 });
    expect(at({ kind: 'polyline', points: [[2, 0], [4, 8]], stroke: '#000000', anchor: 'stretch' }, 1, 2)[0]).toMatchObject({ points: [[4, 0], [8, 8]] });
    expect(at({ kind: 'text', x: 6, y: 9, text: 'x', size: 4, fill: '#000000', anchor: 'stretch' }, 1, 2)[0]).toMatchObject({ x: 12, size: 4 });
  });

  it('repeats a tile every period for as many whole periods as fit', () => {
    const tile: ArtShape = { kind: 'rect', x: 2, y: 5, width: 4, height: 4, fill: '#000000', anchor: 'tile', period: 1 };
    expect(at(tile, 1, 3).map((s) => (s as { x: number }).x)).toEqual([2, 19.5, 37]);
    expect(at(tile, 1, 5.6)).toHaveLength(5);
    expect(at({ ...tile, period: 2 }, 1, 5).map((s) => (s as { x: number }).x)).toEqual([2, 37]);
    expect(at({ ...tile, period: 4 }, 1, 3)).toEqual([]);
  });

  it('never repeats a tile more often than the limit, however fine the period', () => {
    const tile: ArtShape = { kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: '#000000', anchor: 'tile', period: 0.25 };
    expect(at(tile, 1, 500)).toHaveLength(MAX_ART_TILES);
  });

  it('does not change the module width when it is the one the art was made for', () => {
    const shapes: ArtShape[] = [{ ...rect, anchor: 'stretch' }, { ...rect, anchor: 'right' }, { ...rect, anchor: 'centre' }];
    for (const shape of shapes) expect(at(shape, 3, 3)[0]).toMatchObject({ x: 10, width: 30 });
  });
});
