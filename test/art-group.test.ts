import { describe, expect, it } from 'vitest';
import { placeArtFrom, type ArtShape } from '../src/library/art';
import type { Library } from '../src/library/types';
import {
  alignShapes,
  boundsOf,
  copiedShapeCount,
  copyShapes,
  distributeShapes,
  duplicateShapes,
  flipShape,
  flipShapes,
  groupCentre,
  pasteShapes,
  removeShapes,
  replaceShapes,
  rotateShapeBy,
  shapesInBox,
  turnShape,
  turnShapes,
} from '../src/ui/artEditor';

const rect = (x: number, y: number, width = 10, height = 4): ArtShape => ({ kind: 'rect', x, y, width, height, fill: '#112233' });
const library = (art: ArtShape[]): Library => ({ schemaVersion: 1, id: 'lib', name: 'Lib', modules: [{ id: 'm', kind: 'other', name: 'M', widthUnits: 3, poles: 1, ...(art.length > 0 ? { art } : {}) }], enclosures: [] });
const artOf = (draft: Library) => draft.modules[0]!.art ?? [];
const boxes = (shapes: ArtShape[]) => shapes.map((s) => boundsOf(s));

describe('a group of shapes', () => {
  it('has the middle of the box that covers all of them', () => {
    expect(groupCentre([rect(0, 0), rect(30, 20)])).toEqual({ x: 20, y: 12 });
  });

  it('is turned together about that middle, the rectangles moving as well as swapping their sides', () => {
    const turned = turnShapes([rect(0, 0), rect(30, 20)], 1);
    expect(turned[0]).toMatchObject({ x: 28, y: -8, width: 4, height: 10 });
    expect(turned[1]).toMatchObject({ x: 8, y: 22, width: 4, height: 10 });
  });

  it('comes back after four quarter turns together', () => {
    const group = [rect(0, 0), { kind: 'ellipse', cx: 30, cy: 20, rx: 5, ry: 2, fill: '#000000' } as ArtShape, { kind: 'line', x1: 0, y1: 40, x2: 8, y2: 44, stroke: '#000000' } as ArtShape];
    let turned = group;
    for (let i = 0; i < 4; i++) turned = turnShapes(turned, 1);
    expect(JSON.stringify(turned)).toBe(JSON.stringify(group));
  });

  it('is reflected together, the places of the rectangles mirrored', () => {
    const flipped = flipShapes([rect(0, 0), rect(30, 20)], 'horizontal');
    expect(flipped[0]).toMatchObject({ x: 30, y: 0 });
    expect(flipped[1]).toMatchObject({ x: 0, y: 20 });
  });

  it('keeps the letters of a text when it is moved with a group, and turns it with the group', () => {
    const text: ArtShape = { kind: 'text', x: 40, y: 10, text: 'AB', size: 4, fill: '#000000' };
    const [, flipped] = flipShapes([rect(0, 0), text], 'horizontal');
    expect(flipped).toMatchObject({ kind: 'text', y: 10 });
    expect((flipped as { x: number }).x).toBeCloseTo(4.64, 6);
    expect(flipped).not.toHaveProperty('rotation');
    const [, turned] = turnShapes([rect(0, 0), text], 1);
    expect(turned).toMatchObject({ kind: 'text', rotation: 90 });
    expect(flipShape(text, 'horizontal')).toBeUndefined();
  });
});

describe('turning by any angle', () => {
  it('turns the points of a line, a polyline and a path, and nothing for a whole number of turns', () => {
    const line: ArtShape = { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: '#000000' };
    expect(rotateShapeBy(line, 90)).toMatchObject({ x1: 5, y1: -5, x2: 5, y2: 5 });
    expect(rotateShapeBy(line, 360)).toBe(line);
    expect(rotateShapeBy(line, 0)).toBe(line);
  });

  it('turns a rectangle or an ellipse as the path of its outline, with everything else it had', () => {
    const turned = rotateShapeBy({ ...rect(10, 10, 20, 10), stroke: '#000000', strokeWidth: 2, anchor: 'stretch' }, 30);
    expect(turned).toMatchObject({ kind: 'path', fill: '#112233', stroke: '#000000', strokeWidth: 2, anchor: 'stretch' });
    expect(turned).not.toHaveProperty('width');
    const ellipse = rotateShapeBy({ kind: 'ellipse', cx: 20, cy: 20, rx: 8, ry: 4, fill: '#000000' }, 45);
    expect(ellipse.kind).toBe('path');
    const box = boundsOf(ellipse);
    expect((box.x1 + box.x2) / 2).toBeCloseTo(20, 1);
  });

  it('turns a text by adding to its rotation, within -180 and 180 degrees', () => {
    const text: ArtShape = { kind: 'text', x: 5, y: 5, text: 'AB', size: 4, fill: '#000000', rotation: 100 };
    expect(rotateShapeBy(text, 100)).toMatchObject({ rotation: -160, x: 5, y: 5 });
    expect(rotateShapeBy(text, -100)).not.toHaveProperty('rotation');
  });

  it('turns about a point that is given, moving the text with it', () => {
    const text: ArtShape = { kind: 'text', x: 10, y: 0, text: 'AB', size: 4, fill: '#000000' };
    const turned = rotateShapeBy(text, 90, { x: 0, y: 0 }) as { x: number; y: number; rotation: number };
    expect([Math.round(turned.x), Math.round(turned.y), turned.rotation]).toEqual([0, 10, 90]);
  });
});

describe('aligning shapes', () => {
  const group = [rect(0, 0, 10, 4), rect(20, 10, 6, 8), rect(40, 30, 4, 2)];

  it('lines them up on the edges or the middle of the box that covers them', () => {
    expect(boxes(alignShapes(group, 'left')).map((b) => b.x1)).toEqual([0, 0, 0]);
    expect(boxes(alignShapes(group, 'right')).map((b) => b.x2)).toEqual([44, 44, 44]);
    expect(boxes(alignShapes(group, 'centre')).map((b) => (b.x1 + b.x2) / 2)).toEqual([22, 22, 22]);
    expect(boxes(alignShapes(group, 'top')).map((b) => b.y1)).toEqual([0, 0, 0]);
    expect(boxes(alignShapes(group, 'bottom')).map((b) => b.y2)).toEqual([32, 32, 32]);
    expect(boxes(alignShapes(group, 'middle')).map((b) => (b.y1 + b.y2) / 2)).toEqual([16, 16, 16]);
  });

  it('puts a single shape in the middle of the face, or against its edge, when given the face', () => {
    const face = { x1: 0, y1: 0, x2: 52.5, y2: 90 };
    expect(boxes(alignShapes([rect(3, 3, 10, 10)], 'centre', face))[0]).toMatchObject({ x1: 21.25, x2: 31.25 });
    expect(boxes(alignShapes([rect(3, 3, 10, 10)], 'bottom', face))[0]).toMatchObject({ y2: 90 });
  });

  it('leaves the shapes that are already in place as they are', () => {
    const [first] = alignShapes(group, 'left');
    expect(first).toBe(group[0]);
  });
});

describe('distributing shapes', () => {
  it('spaces three or more so the gaps between them are equal, the outer two staying', () => {
    const spread = distributeShapes([rect(0, 0, 10), rect(12, 0, 10), rect(70, 0, 10)], 'horizontal');
    expect(boxes(spread).map((b) => [b.x1, b.x2])).toEqual([[0, 10], [35, 45], [70, 80]]);
  });

  it('works in the other direction and in any order of the list', () => {
    const spread = distributeShapes([rect(0, 60, 4, 10), rect(0, 0, 4, 10), rect(0, 20, 4, 10)], 'vertical');
    expect(boxes(spread).map((b) => b.y1)).toEqual([60, 0, 30]);
  });

  it('does nothing for fewer than three', () => {
    const two = [rect(0, 0), rect(50, 0)];
    expect(distributeShapes(two, 'horizontal')).toEqual(two);
  });
});

describe('picking shapes with a rectangle', () => {
  it('finds those whose boxes touch it, once each, and the shape of a tile counts as the shape it comes from', () => {
    const art: ArtShape[] = [rect(0, 0, 4, 4), rect(30, 30, 4, 4), { kind: 'rect', x: 1, y: 60, width: 3, height: 3, fill: '#000000', anchor: 'tile', period: 1 }];
    const placed = placeArtFrom(art, 3, 3);
    expect(shapesInBox(placed, { x1: -1, y1: -1, x2: 10, y2: 10 })).toEqual([0]);
    expect(shapesInBox(placed, { x1: -1, y1: 55, x2: 60, y2: 70 })).toEqual([2]);
    expect(shapesInBox(placed, { x1: -5, y1: -5, x2: 100, y2: 100 })).toEqual([0, 1, 2]);
    expect(shapesInBox(placed, { x1: 80, y1: 80, x2: 90, y2: 90 })).toEqual([]);
  });
});

describe('several shapes in a draft', () => {
  it('are replaced together, or not at all when one of them would not be accepted', () => {
    const draft = library([rect(0, 0), rect(20, 0), rect(40, 0)]);
    const replaced = replaceShapes(draft, 'm', new Map([[0, rect(1, 1)], [2, rect(41, 1)]]));
    expect(replaced.ok && artOf(replaced.draft).map((s) => (s as { x: number }).x)).toEqual([1, 20, 41]);
    const refused = replaceShapes(draft, 'm', new Map([[0, rect(1, 1)], [1, { ...rect(1, 1), fill: 'red' }]]));
    expect(refused.ok).toBe(false);
    expect(replaceShapes(draft, 'm', new Map([[9, rect(1, 1)]])).ok).toBe(false);
  });

  it('are removed together', () => {
    const removed = removeShapes(library([rect(0, 0), rect(20, 0), rect(40, 0)]), 'm', [0, 2]);
    expect(removed.ok && artOf(removed.draft).map((s) => (s as { x: number }).x)).toEqual([20]);
    expect(removeShapes(library([rect(0, 0)]), 'm', []).ok).toBe(false);
  });

  it('are copied a little aside, on top, and the first copy is selected', () => {
    const copied = duplicateShapes(library([rect(0, 0), rect(20, 0)]), 'm', [1, 0]);
    expect(copied.ok && artOf(copied.draft).map((s) => (s as { x: number }).x)).toEqual([0, 20, 2, 22]);
    expect(copied.ok && copied.index).toBe(2);
  });
});

describe('the clipboard of shapes', () => {
  it('keeps what was copied for another module, and puts it a little further each time', () => {
    expect(pasteShapes(library([]), 'm')).toEqual({ ok: false, message: 'Nothing is copied.' });
    const shape = rect(5, 5);
    expect(copyShapes([shape, rect(20, 5)])).toBe(2);
    expect(copiedShapeCount()).toBe(2);
    const first = pasteShapes(library([]), 'm');
    expect(first.ok && artOf(first.draft).map((s) => (s as { x: number }).x)).toEqual([7, 22]);
    const second = pasteShapes(first.ok ? first.draft : library([]), 'm');
    expect(second.ok && artOf(second.draft).map((s) => (s as { x: number }).x)).toEqual([7, 22, 9, 24]);
  });

  it('is not changed by what is done to the shapes after they were copied', () => {
    const shape = rect(5, 5);
    copyShapes([shape]);
    (shape as { x: number }).x = 99;
    const pasted = pasteShapes(library([]), 'm');
    expect(pasted.ok && (artOf(pasted.draft)[0] as { x: number }).x).toBe(7);
  });
});

describe('turning one shape about a point of its own', () => {
  it('is what it was before when no point is given', () => {
    expect(turnShape(rect(10, 20, 30, 10), 1)).toMatchObject({ x: 20, y: 10, width: 10, height: 30 });
  });
});
