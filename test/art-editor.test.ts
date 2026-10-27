import { describe, expect, it } from 'vitest';
import { MAX_ART_SHAPES, placeArtFrom, type ArtShape } from '../src/library/art';
import type { Library } from '../src/library/types';
import { validateArt, type ValidationError } from '../src/library/validate';
import {
  addShape,
  addVertex,
  applyShapeEdit,
  boundsOf,
  createShape,
  dragHandle,
  duplicateShape,
  handlesOf,
  hits,
  moveLayer,
  polylineThrough,
  removeShape,
  removeVertex,
  replaceShape,
  shapeAt,
  shapeFields,
  snapMm,
  translate,
} from '../src/ui/artEditor';

const rect: ArtShape = { kind: 'rect', x: 10, y: 20, width: 30, height: 40, fill: '#112233' };
const outline: ArtShape = { kind: 'rect', x: 10, y: 20, width: 30, height: 40, stroke: '#112233' };
const ellipse: ArtShape = { kind: 'ellipse', cx: 20, cy: 30, rx: 10, ry: 5, fill: '#112233' };
const line: ArtShape = { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#000000', strokeWidth: 1 };
const polyline: ArtShape = { kind: 'polyline', points: [[0, 0], [10, 0], [10, 10]], stroke: '#000000' };
const text: ArtShape = { kind: 'text', x: 20, y: 30, text: 'ABCD', size: 5, fill: '#000000', align: 'centre' };

const library = (art: ArtShape[] = []): Library => ({
  schemaVersion: 1,
  id: 'lib',
  name: 'Lib',
  modules: [{ id: 'm', kind: 'other', name: 'M', widthUnits: 2, poles: 1, ...(art.length > 0 ? { art } : {}) }],
  enclosures: [],
});
const artOf = (draft: Library) => draft.modules[0]!.art;

describe('the geometry of a shape', () => {
  it('has a box, which for a text is estimated from its letters and its alignment', () => {
    expect(boundsOf(rect)).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
    expect(boundsOf(ellipse)).toEqual({ x1: 10, y1: 25, x2: 30, y2: 35 });
    expect(boundsOf(line)).toEqual({ x1: 0, y1: 0, x2: 10, y2: 0 });
    expect(boundsOf(polyline)).toEqual({ x1: 0, y1: 0, x2: 10, y2: 10 });
    const left = boundsOf({ ...text, align: undefined });
    const centred = boundsOf(text);
    expect(centred.x2 - centred.x1).toBeCloseTo(4 * 5 * 0.58);
    expect(left.x1).toBe(20);
    expect((centred.x1 + centred.x2) / 2).toBeCloseTo(20);
  });

  it('snaps to the grid of half a millimetre', () => {
    expect([snapMm(1.24), snapMm(1.26), snapMm(-0.3)]).toEqual([1, 1.5, -0.5]);
  });

  it('moves, and stays within what a library may hold', () => {
    expect(translate(rect, 5, -5)).toMatchObject({ x: 15, y: 15 });
    expect(translate(polyline, 1, 2)).toMatchObject({ points: [[1, 2], [11, 2], [11, 12]] });
    const far = translate(rect, 5000, 0) as typeof rect & { x: number; width: number };
    expect(far.x + far.width).toBe(1000);
  });
});

describe('the handles of a shape', () => {
  it('are eight for a rectangle or an ellipse, two for a line, one for each vertex, and none for a text', () => {
    expect(handlesOf(rect).map((h) => h.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    expect(handlesOf(ellipse)).toHaveLength(8);
    expect(handlesOf(line).map((h) => h.id)).toEqual(['a', 'b']);
    expect(handlesOf(polyline).map((h) => h.id)).toEqual(['v0', 'v1', 'v2']);
    expect(handlesOf(text)).toEqual([]);
  });

  it('take a corner of a rectangle while the opposite one stays', () => {
    expect(dragHandle(rect, 'se', { x: 50, y: 70 })).toMatchObject({ x: 10, y: 20, width: 40, height: 50 });
    expect(dragHandle(rect, 'nw', { x: 0, y: 10 })).toMatchObject({ x: 0, y: 10, width: 40, height: 50 });
    expect(dragHandle(rect, 'e', { x: 60, y: 999 })).toMatchObject({ x: 10, width: 50, y: 20, height: 40 });
  });

  it('never let a shape go smaller than the least extent or turn inside out', () => {
    expect(dragHandle(rect, 'se', { x: 0, y: 0 })).toMatchObject({ x: 10, y: 20, width: 0.5, height: 0.5 });
    expect(dragHandle(ellipse, 'e', { x: 0, y: 30 })).toMatchObject({ cx: 10.25, rx: 0.25 });
  });

  it('take an ellipse by its box, a line by its end and a polyline by a vertex', () => {
    expect(dragHandle(ellipse, 'e', { x: 40, y: 30 })).toMatchObject({ cx: 25, cy: 30, rx: 15, ry: 5 });
    expect(dragHandle(line, 'b', { x: 4, y: 3 })).toMatchObject({ x1: 0, y1: 0, x2: 4, y2: 3 });
    expect(dragHandle(polyline, 'v1', { x: 7, y: 7 })).toMatchObject({ points: [[0, 0], [7, 7], [10, 10]] });
  });

  it('are kept within the coordinates a library may hold', () => {
    expect(dragHandle(line, 'b', { x: 5000, y: -5000 })).toMatchObject({ x2: 1000, y2: -1000 });
  });
});

describe('what is under a point', () => {
  it('is a filled shape anywhere inside it and an outline only near its line', () => {
    expect(hits(rect, { x: 20, y: 30 }, 0.5)).toBe(true);
    expect(hits(outline, { x: 20, y: 30 }, 0.5)).toBe(false);
    expect(hits(outline, { x: 10.2, y: 30 }, 0.5)).toBe(true);
    expect(hits(ellipse, { x: 20, y: 30 }, 0.5)).toBe(true);
    expect(hits(ellipse, { x: 35, y: 30 }, 0.5)).toBe(false);
    expect(hits({ ...ellipse, fill: undefined, stroke: '#000000' }, { x: 20, y: 30 }, 0.3)).toBe(false);
    expect(hits({ ...ellipse, fill: undefined, stroke: '#000000' }, { x: 30, y: 30 }, 0.5)).toBe(true);
  });

  it('is a line within its reach, a polyline near any piece, and a text inside its box', () => {
    expect(hits(line, { x: 5, y: 0.8 }, 0.5)).toBe(true);
    expect(hits(line, { x: 5, y: 3 }, 0.5)).toBe(false);
    expect(hits(polyline, { x: 10, y: 5 }, 0.5)).toBe(true);
    expect(hits(polyline, { x: 2, y: 8 }, 0.5)).toBe(false);
    expect(hits({ ...polyline, closed: true, fill: '#000000' }, { x: 8, y: 2 }, 0.5)).toBe(true);
    expect(hits(text, { x: 20, y: 30 }, 0.5)).toBe(true);
    expect(hits(text, { x: 40, y: 30 }, 0.5)).toBe(false);
  });

  it('is the topmost shape, and a copy of a tile counts as the shape it comes from', () => {
    const art: ArtShape[] = [rect, { ...rect, x: 12, fill: '#445566' }];
    expect(shapeAt(placeArtFrom(art, 2, 2), { x: 20, y: 30 }, 0.5)).toBe(1);
    expect(shapeAt(placeArtFrom(art, 2, 2), { x: 200, y: 30 }, 0.5)).toBeUndefined();
    const tile: ArtShape[] = [{ kind: 'rect', x: 2, y: 2, width: 5, height: 5, fill: '#000000', anchor: 'tile', period: 1 }];
    expect(shapeAt(placeArtFrom(tile, 3, 3), { x: 17.5 + 4, y: 4 }, 0.5)).toBe(0);
  });
});

describe('drawing a shape with a tool', () => {
  it('makes a rectangle or an ellipse from any two corners, and nothing from a click', () => {
    expect(createShape('rect', { x: 20, y: 30 }, { x: 10, y: 10 })).toMatchObject({ kind: 'rect', x: 10, y: 10, width: 10, height: 20 });
    expect(createShape('ellipse', { x: 0, y: 0 }, { x: 10, y: 20 })).toMatchObject({ kind: 'ellipse', cx: 5, cy: 10, rx: 5, ry: 10 });
    expect(createShape('rect', { x: 5, y: 5 }, { x: 5, y: 5 })).toBeUndefined();
    expect(createShape('ellipse', { x: 5, y: 5 }, { x: 5.2, y: 9 })).toBeUndefined();
  });

  it('makes a line from its ends, even a straight one, and a text where it is clicked', () => {
    expect(createShape('line', { x: 0, y: 0 }, { x: 10, y: 0 })).toMatchObject({ kind: 'line', x2: 10, y2: 0 });
    expect(createShape('line', { x: 3, y: 3 }, { x: 3, y: 3 })).toBeUndefined();
    expect(createShape('text', { x: 8, y: 40 }, { x: 8, y: 40 })).toMatchObject({ kind: 'text', x: 8, y: 40, text: 'Text', align: 'centre' });
  });

  it('makes a polyline from the points clicked, once there are two', () => {
    expect(polylineThrough([[0, 0]])).toBeUndefined();
    expect(polylineThrough([[0, 0], [5, 5]])).toMatchObject({ kind: 'polyline', points: [[0, 0], [5, 5]] });
  });

  it('makes only shapes the library accepts', () => {
    const errors: ValidationError[] = [];
    const shapes = [createShape('rect', { x: 0, y: 0 }, { x: 5, y: 5 }), createShape('ellipse', { x: 0, y: 0 }, { x: 5, y: 5 }), createShape('line', { x: 0, y: 0 }, { x: 5, y: 5 }), createShape('text', { x: 1, y: 1 }, { x: 1, y: 1 }), polylineThrough([[0, 0], [1, 1]])];
    validateArt(shapes, 'art', errors);
    expect(errors).toEqual([]);
  });
});

describe('the drawing in a draft', () => {
  it('has a shape added on top, and none removes the field', () => {
    const added = addShape(library(), 'm', rect);
    expect(added.ok && artOf(added.draft)).toEqual([rect]);
    const removed = added.ok && removeShape(added.draft, 'm', 0);
    expect(removed && removed.ok && 'art' in removed.draft.modules[0]!).toBe(false);
  });

  it('refuses a shape the library would refuse, and more than the limit', () => {
    const bad = addShape(library(), 'm', { ...rect, fill: 'red' });
    expect(!bad.ok && bad.message).toMatch(/fill: must be a colour/);
    const full = library(Array.from({ length: MAX_ART_SHAPES }, () => rect));
    const over = addShape(full, 'm', rect);
    expect(!over.ok && over.message).toBe(`A face has at most ${MAX_ART_SHAPES} shapes.`);
  });

  it('replaces a shape and refuses a shape that is not there', () => {
    const draft = library([rect, ellipse]);
    const replaced = replaceShape(draft, 'm', 1, line);
    expect(replaced.ok && artOf(replaced.draft)).toEqual([rect, line]);
    expect(replaceShape(draft, 'm', 5, line).ok).toBe(false);
    expect(removeShape(draft, 'm', 5).ok).toBe(false);
  });

  it('duplicates a shape a little aside, right above it', () => {
    const result = duplicateShape(library([rect, ellipse]), 'm', 0);
    expect(result.ok && artOf(result.draft)).toEqual([rect, { ...rect, x: 12, y: 22 }, ellipse]);
    expect(result.ok && result.index).toBe(1);
  });

  it('moves a shape through the layers, and says when it is already at the end', () => {
    const draft = library([rect, ellipse, line]);
    const front = moveLayer(draft, 'm', 0, 'front');
    expect(front.ok && artOf(front.draft)).toEqual([ellipse, line, rect]);
    expect(front.ok && front.index).toBe(2);
    const back = moveLayer(draft, 'm', 2, 'back');
    expect(back.ok && artOf(back.draft)).toEqual([line, rect, ellipse]);
    const forward = moveLayer(draft, 'm', 0, 'forward');
    expect(forward.ok && artOf(forward.draft)).toEqual([ellipse, rect, line]);
    expect(moveLayer(draft, 'm', 2, 'forward')).toEqual({ ok: false, message: 'It is already there.' });
    expect(moveLayer(draft, 'm', 0, 'backward').ok).toBe(false);
  });

  it('adds and takes away a vertex of a polyline, down to two', () => {
    const more = addVertex(polyline);
    expect(more && more.kind === 'polyline' && more.points).toHaveLength(4);
    const fewer = removeVertex(polyline, 1);
    expect(fewer && fewer.kind === 'polyline' && fewer.points).toEqual([[0, 0], [10, 10]]);
    expect(removeVertex(fewer!, 0)).toBeUndefined();
    expect(addVertex(rect)).toBeUndefined();
  });
});

describe('the fields of a shape', () => {
  const keys = (shape: ArtShape) => shapeFields(shape).map((f) => f.key);

  it('are those of its kind', () => {
    expect(keys(rect)).toEqual(['kind', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'strokeWidth', 'anchor']);
    expect(keys(text)).toEqual(['kind', 'x', 'y', 'text', 'size', 'align', 'bold', 'fill', 'anchor']);
    expect(keys(polyline)).toEqual(['kind', 'points', 'closed', 'fill', 'stroke', 'strokeWidth', 'anchor']);
    expect(keys({ ...rect, anchor: 'tile', period: 2 })).toContain('period');
    expect(keys(rect)).not.toContain('period');
  });

  it('show the values and the anchors', () => {
    const anchor = shapeFields(rect).find((f) => f.key === 'anchor');
    expect(anchor).toMatchObject({ kind: 'select', value: 'left', options: ['left', 'right', 'centre', 'stretch', 'tile'] });
    expect(shapeFields(text).find((f) => f.key === 'align')).toMatchObject({ value: 'centre' });
    expect(shapeFields(rect).find((f) => f.key === 'stroke')).toMatchObject({ value: '' });
  });
});

describe('editing a shape by a typed value', () => {
  const ok = (result: ReturnType<typeof applyShapeEdit>) => {
    if (!result.ok) throw new Error(result.message);
    return result.shape;
  };

  it('reads numbers, and refuses what is not one or is out of range', () => {
    expect(ok(applyShapeEdit(rect, 'width', '12.5'))).toMatchObject({ width: 12.5 });
    expect(applyShapeEdit(rect, 'width', 'wide')).toEqual({ ok: false, message: 'Enter a number.' });
    expect(applyShapeEdit(rect, 'width', '')).toEqual({ ok: false, message: 'Enter a number.' });
    const refused = applyShapeEdit(rect, 'width', '0');
    expect(!refused.ok && refused.message).toMatch(/width: must be above 0/);
  });

  it('sets a colour, clears it with nothing, and will not take away the last thing that is drawn', () => {
    expect(ok(applyShapeEdit(rect, 'stroke', '#abcdef'))).toMatchObject({ stroke: '#abcdef', fill: '#112233' });
    expect('fill' in ok(applyShapeEdit({ ...rect, stroke: '#000000' }, 'fill', ''))).toBe(false);
    const refused = applyShapeEdit(rect, 'fill', '');
    expect(!refused.ok && refused.message).toMatch(/needs a stroke or a fill/);
    const bad = applyShapeEdit(rect, 'fill', 'red');
    expect(!bad.ok && bad.message).toMatch(/fill: must be a colour/);
  });

  it('gives a tile its period and takes it away again with the anchor', () => {
    const tiled = ok(applyShapeEdit(rect, 'anchor', 'tile'));
    expect(tiled).toMatchObject({ anchor: 'tile', period: 1 });
    expect(ok(applyShapeEdit(tiled, 'period', '2'))).toMatchObject({ period: 2 });
    const back = ok(applyShapeEdit(tiled, 'anchor', 'left'));
    expect('anchor' in back || 'period' in back).toBe(false);
    expect(ok(applyShapeEdit(tiled, 'anchor', 'stretch'))).not.toHaveProperty('period');
  });

  it('edits a text: its words, its letters, its alignment and its weight', () => {
    expect(ok(applyShapeEdit(text, 'text', 'RCD 30 mA'))).toMatchObject({ text: 'RCD 30 mA' });
    const tooLong = applyShapeEdit(text, 'text', 'x'.repeat(41));
    expect(!tooLong.ok && tooLong.message).toMatch(/text: must be 1 to 40 characters/);
    expect(ok(applyShapeEdit(text, 'size', '8'))).toMatchObject({ size: 8 });
    expect(ok(applyShapeEdit(text, 'align', 'right'))).toMatchObject({ align: 'right' });
    expect('align' in ok(applyShapeEdit(text, 'align', 'left'))).toBe(false);
    expect(ok(applyShapeEdit(text, 'bold', 'yes'))).toMatchObject({ bold: true });
    expect('bold' in ok(applyShapeEdit({ ...text, bold: true }, 'bold', 'no'))).toBe(false);
    const empty = applyShapeEdit(text, 'text', '');
    expect(empty.ok).toBe(false);
  });

  it('edits the points of a polyline and whether it is closed', () => {
    expect(ok(applyShapeEdit(polyline, 'points', '0,0 5,5 9,1.5'))).toMatchObject({ points: [[0, 0], [5, 5], [9, 1.5]] });
    expect(applyShapeEdit(polyline, 'points', '0,0 5')).toEqual({ ok: false, message: 'Enter x,y pairs separated by spaces, such as 0,0 10,0 10,5.' });
    expect(ok(applyShapeEdit(polyline, 'closed', 'yes'))).toMatchObject({ closed: true });
    const fillOpen = applyShapeEdit(polyline, 'fill', '#000000');
    expect(!fillOpen.ok && fillOpen.message).toMatch(/needs "closed": true/);
  });

  it('refuses a property that is not there', () => {
    expect(applyShapeEdit(rect, 'kind', 'line')).toEqual({ ok: false, message: 'That property cannot be edited.' });
  });
});
