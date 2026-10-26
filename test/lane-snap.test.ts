import { describe, expect, it } from 'vitest';
import { GRID_MM, NODE_GAP_MM, WIRE_GAP_MM, laneTargets, snapLane } from '../src/schematic/laneSnap';
import type { Layout } from '../src/schematic/geometry';
import type { Point } from '../src/view/Camera';
import type { SchematicNode } from '../src/schematic/model';
import { beginDrag, dragLanes, hitSegment, segmentsOf, JOG_THRESHOLD_MM } from '../src/schematic/wireEditing';
import { WIRE_STUB, type Endpoint } from '../src/schematic/geometry';
import { pathFromLanes } from '../src/schematic/manualRoute';

const node = { id: 'n1', kind: 'module', label: 'n', x: 0, y: 0 } as SchematicNode;
const layout: Layout = new Map([['n1', { node, rect: { x: 100, y: 200, width: 110, height: 56 }, ports: [] }]]);

describe('laneTargets', () => {
  it('has a lane on each side of a node, at a gap from it', () => {
    const x = laneTargets('x', layout, new Map(), new Set()).filter((t) => t.kind === 'node').map((t) => t.value);
    expect(x).toEqual([100 - NODE_GAP_MM, 210 + NODE_GAP_MM]);
    const y = laneTargets('y', layout, new Map(), new Set()).filter((t) => t.kind === 'node').map((t) => t.value);
    expect(y).toEqual([200 - NODE_GAP_MM, 256 + NODE_GAP_MM]);
  });

  it('puts lanes beside another wire, never on it, and leaves out the wire being dragged', () => {
    const routes = new Map<string, Point[]>([
      ['w1', [{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 150, y: 80 }, { x: 150, y: 160 }]],
      ['w2', [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 90, y: 40 }, { x: 90, y: 160 }]],
    ]);
    const y = laneTargets('y', new Map(), routes, new Set(['w2'])).map((t) => t.value);
    expect(y).toEqual([80 - WIRE_GAP_MM, 80 + WIRE_GAP_MM]);
    expect(y).not.toContain(80);
    const x = laneTargets('x', new Map(), routes, new Set()).map((t) => t.value);
    expect(x).toEqual(expect.arrayContaining([150 - WIRE_GAP_MM, 150 + WIRE_GAP_MM, 90 - WIRE_GAP_MM, 90 + WIRE_GAP_MM]));
  });
});

describe('snapLane', () => {
  const targets = [{ value: 105, kind: 'node' as const }, { value: 70, kind: 'wire' as const }];

  it('settles on a node or wire target within reach, in preference to the grid', () => {
    expect(snapLane(102, targets, 6)).toEqual({ value: 105, target: targets[0] });
    expect(snapLane(73, targets, 6)).toEqual({ value: 70, target: targets[1] });
  });

  it('falls back to the grid, and leaves the value alone when nothing is near', () => {
    expect(snapLane(42, [], 6).value).toBe(40);
    expect(snapLane(42, [], 6).target?.kind).toBe('grid');
    expect(snapLane(45, [], 3)).toEqual({ value: 45 });
    expect(GRID_MM).toBe(10);
  });
});

describe('dragging a piece of a wire', () => {
  const a: Endpoint = { point: { x: 100, y: 100 }, side: 'bottom' };
  const b: Endpoint = { point: { x: 300, y: 300 }, side: 'top' };
  const path = pathFromLanes(a, b, [200]);

  it('finds the piece under the pointer, and nothing far from the wire', () => {
    expect(hitSegment(path, { x: 200, y: 203 }, 6)?.index).toBe(1);
    expect(hitSegment(path, { x: 100, y: 150 }, 6)?.index).toBe(0);
    expect(hitSegment(path, { x: 200, y: 260 }, 6)).toBeUndefined();
    expect(segmentsOf(path).map((s) => s.vertical)).toEqual([true, false, true]);
  });

  it('moves a lane by the pointer without a jump at the start, wire still automatic', () => {
    const drag = beginDrag(a, b, path, segmentsOf(path)[1]!, { x: 200, y: 203 }, undefined);
    expect(drag).toMatchObject({ kind: 'lane', index: 0, vertical: false, grab: 3 });
    expect(dragLanes(a, b, drag, { x: 200, y: 203 })).toEqual([200]);
    expect(dragLanes(a, b, drag, { x: 260, y: 243 })).toEqual([240]);
  });

  it('applies the snap to the lane, not to the pointer', () => {
    const drag = beginDrag(a, b, path, segmentsOf(path)[1]!, { x: 200, y: 203 }, undefined);
    expect(dragLanes(a, b, drag, { x: 200, y: 243 }, (v) => Math.round(v / 50) * 50)).toEqual([250]);
  });

  it('does not let the lane be dragged into the node', () => {
    const drag = beginDrag(a, b, path, segmentsOf(path)[1]!, { x: 200, y: 200 }, undefined);
    expect(dragLanes(a, b, drag, { x: 200, y: 0 })).toEqual([100 + WIRE_STUB]);
  });

  it('turns the piece at a terminal into a jog only after it is pulled sideways far enough', () => {
    const drag = beginDrag(a, b, path, segmentsOf(path)[0]!, { x: 100, y: 150 }, undefined);
    expect(drag.kind).toBe('jog');
    expect(dragLanes(a, b, drag, { x: 100 + JOG_THRESHOLD_MM - 1, y: 150 })).toEqual([200]);
    expect(dragLanes(a, b, drag, { x: 160, y: 150 })).toEqual([150, 160, 200]);
  });

  it('starts from the route the wire has, when it has one', () => {
    const own = [150, 200, 250];
    const manual = pathFromLanes(a, b, own);
    const drag = beginDrag(a, b, manual, segmentsOf(manual)[2]!, { x: 200, y: 200 }, own);
    expect(drag).toMatchObject({ kind: 'lane', index: 1, vertical: true });
    expect(dragLanes(a, b, drag, { x: 230, y: 200 })).toEqual([150, 230, 250]);
  });
});
