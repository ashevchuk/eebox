import { describe, expect, it } from 'vitest';
import { TILE_HEIGHT_MM, TILE_OVERLAP_MM, TILE_WIDTH_MM, tileLayout } from '../src/project/tiles';

describe('tileLayout', () => {
  it('needs one sheet for a drawing that fits', () => {
    expect(tileLayout(TILE_WIDTH_MM, TILE_HEIGHT_MM)).toEqual({ columns: 1, rows: 1, tiles: [{ column: 0, row: 0, x: 0, y: 0 }] });
  });

  it('adds a sheet as soon as the drawing is a little larger, and overlaps neighbours', () => {
    const layout = tileLayout(TILE_WIDTH_MM + 1, TILE_HEIGHT_MM);
    expect(layout.columns).toBe(2);
    expect(layout.tiles[1]).toMatchObject({ column: 1, x: TILE_WIDTH_MM - TILE_OVERLAP_MM });
  });

  it('covers the whole drawing: the last sheet reaches its far edge', () => {
    for (const [w, h] of [[420, 300], [1200, 900], [277, 189], [3000, 150]] as const) {
      const { tiles } = tileLayout(w, h);
      expect(Math.max(...tiles.map((t) => t.x)) + TILE_WIDTH_MM).toBeGreaterThanOrEqual(w);
      expect(Math.max(...tiles.map((t) => t.y)) + TILE_HEIGHT_MM).toBeGreaterThanOrEqual(h);
    }
  });

  it('does not add a sheet that would hold nothing new', () => {
    const exact = tileLayout(TILE_WIDTH_MM + (TILE_WIDTH_MM - TILE_OVERLAP_MM), TILE_HEIGHT_MM);
    expect(exact.columns).toBe(2);
  });

  it('numbers sheets left to right, then top to bottom', () => {
    const { tiles } = tileLayout(600, 350);
    expect(tiles.map((t) => [t.row, t.column])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
  });
});
