import { describe, expect, it } from 'vitest';
import { MAX_ART_SHAPES, type ArtShape } from '../src/library/art';
import type { Library } from '../src/library/types';
import { addShapes } from '../src/ui/artEditor';

const rect: ArtShape = { kind: 'rect', x: 1, y: 1, width: 2, height: 2, fill: '#000000' };
const library = (art: ArtShape[] = []): Library => ({
  schemaVersion: 1,
  id: 'lib',
  name: 'Lib',
  modules: [{ id: 'm', kind: 'other', name: 'M', widthUnits: 2, poles: 1, ...(art.length > 0 ? { art } : {}) }],
  enclosures: [],
});

describe('putting the shapes of an import on a face', () => {
  it('adds them on top in one step and selects the first of them', () => {
    const added = addShapes(library([rect]), 'm', [{ ...rect, x: 5 }, { ...rect, x: 9 }]);
    expect(added.ok && added.draft.modules[0]!.art).toHaveLength(3);
    expect(added.ok && added.index).toBe(1);
  });

  it('refuses more than a face holds, and a shape the library would refuse', () => {
    const full = library(Array.from({ length: MAX_ART_SHAPES - 1 }, () => rect));
    const over = addShapes(full, 'm', [rect, rect]);
    expect(!over.ok && over.message).toBe(`A face has at most ${MAX_ART_SHAPES} shapes.`);
    const bad = addShapes(library(), 'm', [{ ...rect, fill: 'red' }]);
    expect(!bad.ok && bad.message).toMatch(/fill: must be a colour/);
  });
});
