import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../src/schematic/geometry';
import { pathFromLanes } from '../src/schematic/manualRoute';
import { beginDrag, COMPANION_BAND_MM, companionsOf, laneValue, segmentsOf, wiresInRect } from '../src/schematic/wireEditing';

const end = (x: number, y: number, side: 'top' | 'bottom'): Endpoint => ({ point: { x, y }, side });

/** Three wires from neighbouring terminals to neighbouring terminals with lanes of their own. */
function bundle(lanes: number[]) {
  return lanes.map((lane, i) => {
    const a = end(100 + 26 * i, 100, 'bottom');
    const b = end(300 + 26 * i, 400, 'top');
    return { wire: `w${i + 1}`, a, b, path: pathFromLanes(a, b, [lane]), route: [lane] as number[] | undefined };
  });
}

describe('pulling a piece of several wires', () => {
  const [first, ...rest] = bundle([200, 215, 230]);

  it('takes along the piece of each other wire that runs the same way beside it', () => {
    const segment = segmentsOf(first!.path)[1]!;
    const pointer = { x: 200, y: 200 };
    const drag = beginDrag(first!.a, first!.b, first!.path, segment, pointer, first!.route);
    if (drag.kind !== 'lane') throw new Error('expected a lane');
    const companions = companionsOf(drag, segment, pointer, rest);
    expect(companions.map((c) => c.wire)).toEqual(['w2', 'w3']);
    expect(companions.every((c) => c.drag.vertical === false && c.drag.index === 0)).toBe(true);
  });

  it('leaves out wires too far off, running the other way, or not alongside', () => {
    const near = bundle([200, 200 + COMPANION_BAND_MM + 10, 200]);
    const segment = segmentsOf(near[0]!.path)[1]!;
    const drag = beginDrag(near[0]!.a, near[0]!.b, near[0]!.path, segment, { x: 200, y: 200 }, [200]);
    if (drag.kind !== 'lane') throw new Error('expected a lane');
    expect(companionsOf(drag, segment, { x: 200, y: 200 }, near.slice(1)).map((c) => c.wire)).toEqual(['w3']);
    const vertical = beginDrag(first!.a, first!.b, pathFromLanes(first!.a, first!.b, [150, 250, 300]), segmentsOf(pathFromLanes(first!.a, first!.b, [150, 250, 300]))[2]!, { x: 250, y: 220 }, [150, 250, 300]);
    if (vertical.kind !== 'lane') throw new Error('expected a lane');
    expect(vertical.vertical).toBe(true);
    expect(companionsOf(vertical, segmentsOf(pathFromLanes(first!.a, first!.b, [150, 250, 300]))[2]!, { x: 250, y: 220 }, rest)).toEqual([]);
  });

  it('gives the wanted coordinate of the lane, snapped, so the others can follow by the same amount', () => {
    const segment = segmentsOf(first!.path)[1]!;
    const drag = beginDrag(first!.a, first!.b, first!.path, segment, { x: 200, y: 203 }, first!.route);
    if (drag.kind !== 'lane') throw new Error('expected a lane');
    expect(laneValue(drag, { x: 200, y: 243 })).toBe(240);
    expect(laneValue(drag, { x: 200, y: 243 }, (v) => Math.round(v / 50) * 50)).toBe(250);
  });
});

describe('wiresInRect', () => {
  const paths = new Map(bundle([200, 215, 230]).map((b) => [b.wire, b.path]));

  it('finds the wires with a piece inside, or crossing, the rectangle', () => {
    expect(wiresInRect(paths, { x: 120, y: 190, width: 40, height: 60 }).sort()).toEqual(['w1', 'w2', 'w3']);
    expect(wiresInRect(paths, { x: 90, y: 150, width: 20, height: 10 })).toEqual(['w1']);
  });

  it('finds nothing in empty space', () => {
    expect(wiresInRect(paths, { x: 500, y: 500, width: 50, height: 50 })).toEqual([]);
  });
});
