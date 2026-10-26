import { describe, expect, it } from 'vitest';
import { WIRE_STUB, type Endpoint } from '../src/schematic/geometry';
import { fitLanes, insertJog, lanesFromPath, moveLane, pathFromLanes, simplifyLanes, type Lanes } from '../src/schematic/manualRoute';
import { routeProblem, setWireRoute, emptySchematic } from '../src/schematic/model';
import type { Point } from '../src/view/Camera';

const end = (x: number, y: number, side: 'top' | 'bottom'): Endpoint => ({ point: { x, y }, side });
const A = end(100, 100, 'bottom');
const B = end(300, 300, 'top');

/** Deterministic numbers, so the property tests are repeatable. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const segmentsOf = (path: Point[]) => path.slice(1).map((p, i) => [path[i]!, p] as const);

/** Orthogonal, alternating vertical and horizontal, leaving each terminal the right way, nothing of zero length. */
function expectValidRoute(path: Point[], a: Endpoint, b: Endpoint) {
  const segments = segmentsOf(path);
  expect(segments.length % 2).toBe(1);
  segments.forEach(([p, q], i) => {
    const vertical = Math.abs(p.x - q.x) < 1e-9;
    const horizontal = Math.abs(p.y - q.y) < 1e-9;
    expect(vertical !== horizontal, `segment ${i} is not axis-aligned or has no length`).toBe(true);
    expect(vertical, `segment ${i} should be ${i % 2 === 0 ? 'vertical' : 'horizontal'}`).toBe(i % 2 === 0);
  });
  const [first] = segments;
  const last = segments[segments.length - 1]!;
  expect(Math.sign(first![1].y - first![0].y)).toBe(a.side === 'bottom' ? 1 : -1);
  expect(Math.abs(first![1].y - first![0].y)).toBeGreaterThanOrEqual(WIRE_STUB - 1e-9);
  expect(Math.sign(last[0].y - last[1].y)).toBe(b.side === 'bottom' ? 1 : -1);
  expect(Math.abs(last[1].y - last[0].y)).toBeGreaterThanOrEqual(WIRE_STUB - 1e-9);
}

describe('pathFromLanes', () => {
  it('one lane is a Z between the terminals', () => {
    expect(pathFromLanes(A, B, [200])).toEqual([A.point, { x: 100, y: 200 }, { x: 300, y: 200 }, B.point]);
  });

  it('three lanes add a vertical piece in the middle', () => {
    expect(pathFromLanes(A, B, [150, 200, 250])).toEqual([
      A.point,
      { x: 100, y: 150 },
      { x: 200, y: 150 },
      { x: 200, y: 250 },
      { x: 300, y: 250 },
      B.point,
    ]);
  });

  it('keeps the wire off the node: a lane too close to the terminal is moved out to the stub length', () => {
    const path = pathFromLanes(A, B, [105]);
    expect(path[1]).toEqual({ x: 100, y: 100 + WIRE_STUB });
  });

  it('goes round when the other terminal is above: a single lane becomes three', () => {
    const above = end(300, 20, 'top');
    expect(fitLanes(A, above, [60]).length).toBe(3);
    expectValidRoute(pathFromLanes(A, above, [60]), A, above);
  });

  it('puts the lane of a U between two terminals that both face down below both of them', () => {
    const left = end(100, 100, 'bottom');
    const right = end(300, 140, 'bottom');
    const path = pathFromLanes(left, right, [110]);
    expect(path[1]!.y).toBe(140 + WIRE_STUB);
    expectValidRoute(path, left, right);
  });
});

describe('every route is valid for any lanes whatever they are', () => {
  const ends: Array<[Endpoint, Endpoint]> = [
    [end(100, 100, 'bottom'), end(300, 300, 'top')],
    [end(100, 300, 'bottom'), end(300, 100, 'top')],
    [end(100, 100, 'bottom'), end(300, 140, 'bottom')],
    [end(100, 100, 'top'), end(300, 140, 'top')],
    [end(100, 100, 'top'), end(100, 400, 'bottom')],
    [end(200, 200, 'bottom'), end(200, 200, 'top')],
  ];

  it('is orthogonal, alternating, leaving each terminal the right way, after simplification', () => {
    const next = random(7);
    for (const [a, b] of ends) {
      for (let n = 0; n < 150; n++) {
        const count = [1, 3, 5][Math.floor(next() * 3)]!;
        const lanes = Array.from({ length: count }, () => Math.round(next() * 600 - 100));
        const fitted = simplifyLanes(a, b, fitLanes(a, b, lanes));
        expect(fitted.length % 2).toBe(1);
        expectValidRoute(pathFromLanes(a, b, fitted), a, b);
      }
    }
  });

  it('is unchanged by simplifying twice', () => {
    const next = random(11);
    const [a, b] = ends[0]!;
    for (let n = 0; n < 100; n++) {
      const lanes = Array.from({ length: 5 }, () => Math.round(next() * 400));
      const once = simplifyLanes(a, b, fitLanes(a, b, lanes));
      expect(simplifyLanes(a, b, fitLanes(a, b, once))).toEqual(once);
    }
  });
});

describe('simplifyLanes', () => {
  it('merges two horizontal lanes that meet, and two vertical ones', () => {
    expect(simplifyLanes(A, B, [150, 250, 150])).toEqual([150]);
    expect(simplifyLanes(A, B, [150, 200, 250, 200, 280])).toEqual([150, 200, 280]);
  });

  it('drops a bend that has moved onto the terminal', () => {
    expect(simplifyLanes(A, B, [150, 100, 250])).toEqual([250]);
    expect(simplifyLanes(A, B, [150, 300, 250])).toEqual([150]);
  });

  it('never leaves fewer than one lane', () => {
    expect(simplifyLanes(A, B, [200]).length).toBe(1);
  });
});

describe('lanesFromPath', () => {
  it('reads back the lanes of a path made from them', () => {
    const next = random(3);
    for (let n = 0; n < 100; n++) {
      const count = [1, 3, 5][Math.floor(next() * 3)]!;
      const lanes = simplifyLanes(A, B, fitLanes(A, B, Array.from({ length: count }, () => Math.round(next() * 500 - 50))));
      expect(lanesFromPath(pathFromLanes(A, B, lanes))).toEqual(lanes);
    }
  });

  it('gives nothing for a path that is not vertical first, or not axis-aligned', () => {
    expect(lanesFromPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }])).toBeUndefined();
    expect(lanesFromPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 50, y: 50 }, { x: 60, y: 90 }])).toBeUndefined();
    expect(lanesFromPath([{ x: 0, y: 0 }, { x: 0, y: 50 }])).toBeUndefined();
  });
});

describe('moveLane', () => {
  it('moves a lane and keeps the route valid', () => {
    expect(moveLane(A, B, [200], 0, 240)).toEqual([240]);
  });

  it('merges the bends when a lane is dragged onto its neighbour', () => {
    expect(moveLane(A, B, [150, 200, 250], 0, 250)).toEqual([250]);
  });

  it('does not let a lane be dragged back into the node', () => {
    expect(moveLane(A, B, [200], 0, 40)).toEqual([100 + WIRE_STUB]);
  });
});

describe('insertJog', () => {
  it('turns dragging the piece at the first terminal sideways into a jog there', () => {
    const lanes = insertJog(A, B, [200], true, 160);
    expect(lanes).toEqual([100 + WIRE_STUB, 160, 200]);
    expectValidRoute(pathFromLanes(A, B, lanes), A, B);
  });

  it('does the same at the last terminal', () => {
    const lanes = insertJog(A, B, [200], false, 240);
    expect(lanes).toEqual([200, 240, 300 - WIRE_STUB]);
    expectValidRoute(pathFromLanes(A, B, lanes), A, B);
  });

  it('pushes the next lane out when the stub was too short to hold a jog', () => {
    const lanes = insertJog(A, B, [100 + WIRE_STUB], true, 160);
    expect(lanes[2]).toBeGreaterThanOrEqual(100 + 2 * WIRE_STUB);
    expectValidRoute(pathFromLanes(A, B, lanes), A, B);
  });

  it('makes the jog at the height the wire was taken hold of, as far from the next lane as a stub', () => {
    const lanes = insertJog(A, B, [250], true, 160, 160);
    expect(lanes).toEqual([160, 160, 250]);
    expectValidRoute(pathFromLanes(A, B, lanes), A, B);
    const late = insertJog(A, B, [250], true, 160, 240);
    expect(late[0]).toBe(250 - WIRE_STUB);
    expect(late.length).toBe(3);
  });

  it('does the same at the last terminal, measured from that terminal', () => {
    const lanes = insertJog(A, B, [150], false, 240, 260);
    expect(lanes).toEqual([150, 240, 260]);
    expectValidRoute(pathFromLanes(A, B, lanes), A, B);
  });

  it('is a plain move of the terminal when the jog is dragged back to it', () => {
    expect(insertJog(A, B, [200], true, 100)).toEqual([200]);
  });
});

describe('the stored route', () => {
  it('has to be an odd number of finite coordinates within the limits', () => {
    expect(routeProblem([200])).toBeNull();
    expect(routeProblem([150, 200, 250])).toBeNull();
    for (const bad of [[], [1, 2], 'x', [Number.NaN], [Infinity], [1e9], Array.from({ length: 17 }, () => 1)]) expect(routeProblem(bad)).not.toBeNull();
  });

  it('is set on a wire and cleared again, and refused for a wire that is not there or a bad route', () => {
    const schematic = { ...emptySchematic(), wires: [{ id: 'w1', a: { node: 'n1', terminal: 'bottom:L' }, b: { node: 'n2', terminal: 'top:L' } }] };
    const set = setWireRoute(schematic, 'w1', [200]);
    expect(set.ok && set.schematic.wires[0]?.route).toEqual([200]);
    const cleared = set.ok ? setWireRoute(set.schematic, 'w1', undefined) : set;
    expect(cleared.ok && 'route' in cleared.schematic.wires[0]!).toBe(false);
    expect(setWireRoute(schematic, 'zzz', [200])).toEqual({ ok: false, error: { kind: 'unknown-wire' } });
    expect(setWireRoute(schematic, 'w1', [1, 2])).toEqual({ ok: false, error: { kind: 'invalid-route' } });
  });
});

describe('lanes types', () => {
  it('is a plain list of numbers', () => {
    const lanes: Lanes = [1];
    expect(lanes).toEqual([1]);
  });
});
