import { describe, expect, it } from 'vitest';
import { sheetsWithContent, tileLayout, TILE_HEIGHT_MM, TILE_WIDTH_MM } from '../src/project/tiles';
import { frameRect, PRINT_MARGIN_MM, printArea, railRect } from '../src/view/geometry';
import { combAt, panelOf, place, resolve, widthOf } from './fixtures';

const noComb = () => undefined;
const measure = (text: string) => text.length * 4;

describe('printArea', () => {
  it('covers the rail and the module with a margin, and far less than the frame', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0)], [], [12]);
    const { bounds } = printArea(panel, widthOf, noComb, measure);
    const rail = railRect(panel, 0);
    const frame = frameRect(panel);
    expect(bounds.minX).toBe(rail.x - PRINT_MARGIN_MM);
    expect(bounds.maxX).toBe(rail.x + rail.width + PRINT_MARGIN_MM);
    expect(bounds.maxY - bounds.minY).toBeLessThan(frame.height / 2);
    expect(bounds.minX).toBeGreaterThan(frame.x);
  });

  it('reaches as far down as a label under a module is long, and no further than the room it has', () => {
    const labelled = (text: string) => panelOf([{ ...place('p1', 'mcb1', 0, 0), label: text }], [], [12]);
    const plain = printArea(panelOf([place('p1', 'mcb1', 0, 0)], [], [12]), widthOf, noComb, measure).bounds;
    const short = printArea(labelled('Kitchen'), widthOf, noComb, measure).bounds;
    const long = printArea(labelled('A very long name indeed, longer than the room under the module'), widthOf, noComb, measure).bounds;
    expect(short.maxY).toBeGreaterThan(plain.maxY);
    expect(long.maxY).toBeGreaterThan(short.maxY);
    expect(long.maxY - plain.maxY).toBeLessThan(200);
  });

  it('makes room for the label of a row on the left', () => {
    const base = panelOf([place('p1', 'mcb1', 0, 0)], [], [12]);
    const without = printArea(base, widthOf, noComb, measure).bounds;
    const withLabel = printArea({ ...base, railLabels: ['Incoming'] }, widthOf, noComb, measure).bounds;
    expect(withLabel.minX).toBeLessThan(without.minX);
  });

  it('includes a comb and falls back to the frame for a panel with no rails', () => {
    const panel = { ...panelOf([place('p1', 'mcb1', 0, 0)], [], [12]), combs: [combAt('c1', 'comb1', 0, 0)] };
    const { rects } = printArea(panel, widthOf, () => ({ widthUnits: 6, side: 'top' }), measure);
    expect(rects.length).toBe(3);
    const empty = panelOf([], [], []);
    const { bounds } = printArea(empty, widthOf, noComb, measure);
    const frame = frameRect(empty);
    expect(bounds).toEqual({ minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.height });
  });
});

describe('sheetsWithContent', () => {
  it('leaves out the sheets that hold nothing', () => {
    const layout = tileLayout(2 * TILE_WIDTH_MM, 2 * TILE_HEIGHT_MM);
    expect(layout.tiles.length).toBeGreaterThan(1);
    const kept = sheetsWithContent(layout, [{ x: 0, y: 0, width: 100, height: 50 }]);
    expect(kept.map((t) => [t.column, t.row])).toEqual([[0, 0]]);
  });

  it('keeps every sheet that a piece touches, also one that reaches into the overlap', () => {
    const layout = tileLayout(2 * TILE_WIDTH_MM, TILE_HEIGHT_MM);
    const across = sheetsWithContent(layout, [{ x: TILE_WIDTH_MM - 5, y: 10, width: 20, height: 20 }]);
    expect(across.map((t) => t.column)).toEqual([0, 1]);
  });

  it('keeps nothing when there is nothing', () => {
    expect(sheetsWithContent(tileLayout(500, 400), [])).toEqual([]);
  });
});
