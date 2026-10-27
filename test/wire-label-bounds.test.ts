import { describe, expect, it } from 'vitest';
import { boundsWithBoxes, wireLabelBox } from '../src/schematic/geometry';

describe('wire label bounds', () => {
  it('centres the box of a label on its point', () => {
    const box = wireLabelBox('abcd', { x: 100, y: 50 });
    expect((box.minX + box.maxX) / 2).toBe(100);
    expect((box.minY + box.maxY) / 2).toBe(50);
    expect(box.maxY - box.minY).toBe(14);
  });

  it('makes a longer label wider', () => {
    const short = wireLabelBox('ab', { x: 0, y: 0 });
    const long = wireLabelBox('abcdefghij', { x: 0, y: 0 });
    expect(long.maxX - long.minX).toBeGreaterThan(short.maxX - short.minX);
  });

  it('grows bounds to take in a label that sticks out, and leaves them when it does not', () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const out = boundsWithBoxes(bounds, [wireLabelBox('a long label on a wire', { x: 95, y: 3 })]);
    expect(out.maxX).toBeGreaterThan(100);
    expect(out.minY).toBeLessThan(0);
    expect(out.minX).toBe(0);
    expect(boundsWithBoxes(bounds, [wireLabelBox('x', { x: 50, y: 50 })])).toEqual(bounds);
    expect(boundsWithBoxes(bounds, [])).toEqual(bounds);
  });
});
