import { describe, expect, it } from 'vitest';
import { describeMeasurement, edgeLines, measurement, snapToEdges } from '../src/view/ruler';
import { moduleRect } from '../src/view/geometry';
import { combAt, panelOf, place, resolve, widthOf } from './fixtures';

describe('measurement', () => {
  it('gives the length in mm and in module units, and its two parts', () => {
    const m = measurement({ a: { x: 0, y: 0 }, b: { x: 30, y: 40 } });
    expect(m).toMatchObject({ dxMm: 30, dyMm: 40, lengthMm: 50 });
    expect(m.lengthUnits).toBeCloseTo(50 / 17.5, 6);
  });

  it('does not depend on the direction it was drawn in', () => {
    expect(measurement({ a: { x: 30, y: 40 }, b: { x: 0, y: 0 } }).lengthMm).toBe(50);
  });
});

describe('describeMeasurement', () => {
  it('names the length first and the two parts when both are there', () => {
    expect(describeMeasurement(measurement({ a: { x: 0, y: 0 }, b: { x: 35, y: 0 } }))).toEqual(['35.0 mm (2 units)']);
    expect(describeMeasurement(measurement({ a: { x: 0, y: 0 }, b: { x: 30, y: 40 } }))).toEqual([
      '50.0 mm (2.86 units)',
      'Δx 30.0 mm, Δy 40.0 mm',
    ]);
  });

  it('says one unit in the singular', () => {
    expect(describeMeasurement(measurement({ a: { x: 0, y: 0 }, b: { x: 17.5, y: 0 } }))[0]).toBe('17.5 mm (1 unit)');
  });
});

describe('snapToEdges', () => {
  const panel = { ...panelOf([place('p1', 'mcb1', 0, 2), place('p2', 'mcb1', 0, 5)]), combs: [combAt('c1', 'comb1', 0, 2)] };
  const edges = edgeLines(panel, widthOf, () => ({ widthUnits: 6, side: 'top' }));
  const first = moduleRect(panel, 0, 2, 1);

  it('lists the edges of modules, combs, rails and the frame', () => {
    expect(edges.xs).toContain(first.x);
    expect(edges.xs).toContain(first.x + first.width);
    expect(edges.ys).toContain(first.y);
    expect(edges.xs).toContain(0);
  });

  it('pulls a point onto an edge that is close, on each axis on its own', () => {
    const snapped = snapToEdges({ x: first.x + 1.5, y: first.y + 40 }, edges, 3);
    expect(snapped.x).toBe(first.x);
    expect(snapped.y).toBeCloseTo(first.y + 40, 6);
  });

  it('leaves a point alone when no edge is within reach', () => {
    const point = { x: first.x + first.width / 2, y: first.y + 40 };
    expect(snapToEdges(point, edges, 1)).toEqual(point);
  });

  it('measures the gap between two modules exactly once both ends have snapped', () => {
    const second = moduleRect(panel, 0, 5, 1);
    const a = snapToEdges({ x: first.x + first.width + 1, y: first.y + 20 }, edges, 3);
    const b = snapToEdges({ x: second.x - 1, y: first.y + 20 }, edges, 3);
    expect(measurement({ a, b }).lengthMm).toBeCloseTo(second.x - (first.x + first.width), 6);
  });
});
