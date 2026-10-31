import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import type { Panel, Placement, Sizes } from '../src/layout/placement';
import { DIN_MODULE_HEIGHT_MM } from '../src/library/types';
import { combRect, moduleRect, COMB_OVERHANG } from '../src/view/geometry';

const place = (id: string, slot: number): Placement => ({ id, module: { libraryId: 'l', moduleId: id }, rail: 0, slot });
const sizes = (heights: Record<string, number>): Sizes => ({
  widthOf: () => 3,
  heightOf: (p) => heights[p.module.moduleId] ?? DIN_MODULE_HEIGHT_MM,
});
const withPlacements = (...placements: Placement[]): Panel => ({ ...createPanel([30]), placements });

describe('combRect over taller modules', () => {
  it('lies on the top edge of a standard module as before', () => {
    const panel = withPlacements(place('a', 0));
    const body = moduleRect(panel, 0, 0, 3, DIN_MODULE_HEIGHT_MM);
    expect(combRect(panel, sizes({}), 0, 0, 3, 'top').y).toBe(body.y - COMB_OVERHANG);
  });

  it('follows the top edge of a taller module under it', () => {
    const panel = withPlacements(place('a', 0));
    const body = moduleRect(panel, 0, 0, 3, 250);
    expect(combRect(panel, sizes({ a: 250 }), 0, 0, 3, 'top').y).toBe(body.y - COMB_OVERHANG);
  });

  it('follows the bottom edge of a taller module for a bottom comb', () => {
    const panel = withPlacements(place('a', 0));
    const body = moduleRect(panel, 0, 0, 3, 250);
    const comb = combRect(panel, sizes({ a: 250 }), 0, 0, 3, 'bottom');
    expect(comb.y + comb.height).toBe(body.y + body.height + COMB_OVERHANG);
  });

  it('takes the tallest of several modules it covers and ignores one beside it', () => {
    const panel = withPlacements(place('a', 0), place('b', 3), place('c', 6));
    const covered = combRect(panel, sizes({ a: 120, b: 160, c: 300 }), 0, 0, 6, 'top');
    expect(covered.y).toBe(moduleRect(panel, 0, 0, 3, 160).y - COMB_OVERHANG);
  });
});
