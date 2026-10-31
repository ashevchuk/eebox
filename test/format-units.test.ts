import { describe, expect, it } from 'vitest';
import { formatUnits } from '../src/layout/units';

describe('formatUnits', () => {
  it('keeps at most two decimals', () => {
    expect(formatUnits(5.52232142857143)).toBe('5.52');
    expect(formatUnits(3.999)).toBe('4');
  });

  it('writes whole units and short fractions plainly', () => {
    expect(formatUnits(4)).toBe('4');
    expect(formatUnits(2.5)).toBe('2.5');
    expect(formatUnits(0.25)).toBe('0.25');
  });
});
