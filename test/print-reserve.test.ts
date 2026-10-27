import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_OPTIONS, drawingMaxHeightMm } from '../src/project/printOptions';
import { titleBlockHeightMm } from '../src/ui/printSheet';

describe('room kept on the page', () => {
  it('takes what is reserved from the height of a drawing', () => {
    expect(drawingMaxHeightMm(DEFAULT_PRINT_OPTIONS, 20)).toBe(drawingMaxHeightMm(DEFAULT_PRINT_OPTIONS) - 20);
  });
});

describe('the height of the title block', () => {
  it('is nothing when nothing is stated', () => {
    expect(titleBlockHeightMm(undefined)).toBe(0);
    expect(titleBlockHeightMm({})).toBe(0);
  });

  it('is a row for the fields, and a line for each line of the notes', () => {
    const fields = titleBlockHeightMm({ revision: 'B' });
    expect(fields).toBeGreaterThan(0);
    expect(titleBlockHeightMm({ notes: 'one' })).toBeLessThan(fields + 1);
    expect(titleBlockHeightMm({ revision: 'B', notes: 'a\nb\nc' })).toBeGreaterThan(titleBlockHeightMm({ revision: 'B', notes: 'a' }));
  });

  it('does not grow without a limit', () => {
    const huge = titleBlockHeightMm({ revision: 'B', notes: Array.from({ length: 200 }, () => 'line').join('\n') });
    expect(huge).toBeLessThan(120);
  });
});
