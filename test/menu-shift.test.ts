import { describe, expect, it } from 'vitest';
import { shiftIntoWindow } from '../src/ui/menu';

describe('shiftIntoWindow', () => {
  it('leaves a box that lies inside the window where it is', () => {
    expect(shiftIntoWindow(100, 260, 900)).toBe(0);
  });

  it('moves a box that runs off the right edge back by the part that did, keeping a margin', () => {
    expect(shiftIntoWindow(312, 260, 390, 6)).toBe(-(312 + 260 - (390 - 6)));
  });

  it('moves a box that starts before the left edge in to the margin', () => {
    expect(shiftIntoWindow(-20, 100, 900, 6)).toBe(26);
  });

  it('keeps the left edge when the box is wider than the window', () => {
    expect(shiftIntoWindow(50, 500, 390, 6)).toBe(6 - 50);
  });
});
