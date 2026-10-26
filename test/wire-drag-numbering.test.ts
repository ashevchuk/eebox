import { describe, expect, it } from 'vitest';
import { pathFromLanes } from '../src/schematic/manualRoute';
import { beginDrag, segmentsOf } from '../src/schematic/wireEditing';

const a = { point: { x: 100, y: 300 }, side: 'bottom' as const };

describe('beginDrag numbering', () => {
  it('numbers the lanes like the pieces drawn when a stored route is refitted to the terminals', () => {
    const b = { point: { x: 80, y: 150 }, side: 'top' as const };
    const route = [80];
    const path = pathFromLanes(a, b, route);
    expect(segmentsOf(path).length).toBeGreaterThan(3);
    for (const segment of segmentsOf(path)) {
      const drag = beginDrag(a, b, path, segment, { x: 0, y: 0 }, route);
      if (drag.kind === 'lane') {
        expect(Number.isFinite(drag.grab)).toBe(true);
        expect(drag.lanes[drag.index]).toBeDefined();
      }
    }
  });

  it('keeps every grab finite for a path that has more pieces than the default lanes', () => {
    const b = { point: { x: 100, y: 100 }, side: 'top' as const };
    const path = [a.point, { x: 100, y: 330 }, { x: 40, y: 330 }, { x: 40, y: 200 }, { x: 160, y: 200 }, { x: 160, y: 100 }, b.point];
    for (const segment of segmentsOf(path)) {
      const drag = beginDrag(a, b, path, segment, { x: 70, y: 180 }, undefined);
      if (drag.kind === 'lane') {
        expect(Number.isFinite(drag.grab)).toBe(true);
        expect(drag.lanes[drag.index]).toBeDefined();
      }
    }
  });
});
