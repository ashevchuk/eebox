import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from '../src/ui/menu';

describe('nextFocusIndex', () => {
  it('moves down and wraps from the last item to the first', () => {
    expect(nextFocusIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(nextFocusIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(nextFocusIndex(2, 3, 'ArrowDown')).toBe(0);
  });

  it('moves up and wraps from the first item, or from no focus, to the last', () => {
    expect(nextFocusIndex(2, 3, 'ArrowUp')).toBe(1);
    expect(nextFocusIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(nextFocusIndex(-1, 3, 'ArrowUp')).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextFocusIndex(1, 4, 'Home')).toBe(0);
    expect(nextFocusIndex(1, 4, 'End')).toBe(3);
  });

  it('has nothing to focus in an empty menu', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const) expect(nextFocusIndex(-1, 0, key)).toBe(-1);
  });
});
