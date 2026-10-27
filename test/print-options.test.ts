import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_OPTIONS, anythingToPrint, drawingMaxHeightMm, pageRule, pageSizeMm } from '../src/project/printOptions';

describe('print options', () => {
  it('writes the page rule for the paper and the orientation', () => {
    expect(pageRule({ paper: 'A4', orientation: 'landscape' })).toBe('@page { size: A4 landscape; margin: 10mm; }');
    expect(pageRule({ paper: 'Letter', orientation: 'portrait' })).toBe('@page { size: Letter portrait; margin: 10mm; }');
  });

  it('swaps the sides of the page for landscape', () => {
    expect(pageSizeMm({ paper: 'A3', orientation: 'portrait' })).toEqual({ width: 297, height: 420 });
    expect(pageSizeMm({ paper: 'A3', orientation: 'landscape' })).toEqual({ width: 420, height: 297 });
  });

  it('keeps the drawing height of A4 landscape that the sheet always had', () => {
    expect(drawingMaxHeightMm(DEFAULT_PRINT_OPTIONS)).toBe(150);
  });

  it('allows taller drawings on a portrait page', () => {
    expect(drawingMaxHeightMm({ paper: 'A4', orientation: 'portrait' })).toBeGreaterThan(drawingMaxHeightMm(DEFAULT_PRINT_OPTIONS));
  });

  it('finds that nothing is chosen', () => {
    expect(anythingToPrint(DEFAULT_PRINT_OPTIONS)).toBe(true);
    const none = { ...DEFAULT_PRINT_OPTIONS, parts: { panel: false, schematic: false, parts: false, circuits: false, connections: false, ferrules: false } };
    expect(anythingToPrint(none)).toBe(false);
  });
});
