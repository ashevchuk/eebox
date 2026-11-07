import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import type { Panel, Sizes } from '../src/layout/placement';
import { DIN_MODULE_HEIGHT_MM } from '../src/library/types';
import { dimensionsOf } from '../src/view/dimensions';
import { FRAME_PADDING, rowRect } from '../src/view/geometry';

const PITCH_MM = 150;
const TALL_MM = 165;
const sizes = (tall = false): Sizes => ({
  widthOf: () => 4,
  heightOf: () => (tall ? TALL_MM : DIN_MODULE_HEIGHT_MM),
});
const corner = { x: FRAME_PADDING, y: FRAME_PADDING };

function threeRows(): Panel {
  const panel = createPanel([12, 12, 12], PITCH_MM);
  return { ...panel, placements: [{ id: 'p1', module: { libraryId: 'l', moduleId: 'm' }, rail: 1, slot: 0 }] };
}

describe('rowRect', () => {
  it('is as long as its rail and as tall as a standard module when empty', () => {
    const r = rowRect(threeRows(), sizes(), 0);
    expect(r.width).toBe(12 * 17.5);
    expect(r.height).toBe(DIN_MODULE_HEIGHT_MM);
  });

  it('grows around the tallest module on its rail', () => {
    const panel = threeRows();
    const r = rowRect(panel, sizes(true), 1);
    expect(r.height).toBe(TALL_MM);
    expect(r.y + r.height / 2).toBe(FRAME_PADDING + panel.rails[1]!.y);
  });
});

describe('the distances of a selected row', () => {
  it('are the clear space to the rows above and below', () => {
    const panel = threeRows();
    const others = [0, 2].map((i) => rowRect(panel, sizes(), i));
    const found = dimensionsOf(rowRect(panel, sizes(), 1), others, corner);
    const gaps = found.filter((d) => d.from.x === d.to.x).map((d) => d.mm);
    expect(gaps).toEqual([PITCH_MM - DIN_MODULE_HEIGHT_MM, PITCH_MM - DIN_MODULE_HEIGHT_MM]);
  });

  it('shrink where a tall module stands on the row', () => {
    const panel = threeRows();
    const s = sizes(true);
    const others = [0, 2].map((i) => rowRect(panel, s, i));
    const found = dimensionsOf(rowRect(panel, s, 1), others, corner);
    const gaps = found.filter((d) => d.from.x === d.to.x).map((d) => d.mm);
    expect(gaps).toEqual([PITCH_MM - (TALL_MM + DIN_MODULE_HEIGHT_MM) / 2, PITCH_MM - (TALL_MM + DIN_MODULE_HEIGHT_MM) / 2]);
  });
});
