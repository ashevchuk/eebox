import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../src/schematic/geometry';
import { WIRE_GAP_MM } from '../src/schematic/laneSnap';
import { pathFromLanes } from '../src/schematic/manualRoute';
import { findOverlaps, spreadOverlaps } from '../src/schematic/overlaps';
import type { Point } from '../src/view/Camera';

const end = (x: number, y: number, side: 'top' | 'bottom'): Endpoint => ({ point: { x, y }, side });

/** Three wires from neighbouring terminals to neighbouring terminals, all with the same lane, so they lie on top of each other. */
function stacked(count = 3) {
  const ends = new Map<string, { a: Endpoint; b: Endpoint }>();
  const paths = new Map<string, Point[]>();
  for (let i = 0; i < count; i++) {
    const a = end(100 + 26 * i, 100, 'bottom');
    const b = end(300 + 26 * i, 300, 'top');
    ends.set(`w${i + 1}`, { a, b });
    paths.set(`w${i + 1}`, pathFromLanes(a, b, [200]));
  }
  return { ends, paths };
}

describe('findOverlaps', () => {
  it('finds wires that run on the same line over a stretch', () => {
    const { paths } = stacked(3);
    const found = findOverlaps(paths);
    expect(found).toHaveLength(3);
    expect(found.every((o) => !o.vertical && o.first.at === 200 && o.second.at === 200)).toBe(true);
  });

  it('is quiet for wires on different lines, for wires that only cross, and for the pieces at a shared terminal', () => {
    const a = end(100, 100, 'bottom');
    const b = end(300, 300, 'top');
    const apart = new Map([['w1', pathFromLanes(a, b, [200])], ['w2', pathFromLanes(end(126, 100, 'bottom'), end(326, 300, 'top'), [230])]]);
    expect(findOverlaps(apart)).toEqual([]);
    const cross = new Map([['w1', pathFromLanes(a, b, [200])], ['w2', pathFromLanes(end(200, 100, 'bottom'), end(200, 300, 'top'), [160])]]);
    expect(findOverlaps(cross)).toEqual([]);
    const sharedTerminal = new Map([['w1', pathFromLanes(a, b, [200])], ['w2', pathFromLanes(a, end(400, 300, 'top'), [240])]]);
    expect(findOverlaps(sharedTerminal)).toEqual([]);
  });

  it('ignores a stretch that is only a hair long', () => {
    const w1 = pathFromLanes(end(100, 100, 'bottom'), end(130, 300, 'top'), [200]);
    const w2 = pathFromLanes(end(128, 100, 'bottom'), end(300, 300, 'top'), [200]);
    expect(findOverlaps(new Map([['w1', w1], ['w2', w2]]))).toEqual([]);
  });
});

describe('wires that run too close', () => {
  const a = end(100, 100, 'bottom');
  const b = end(300, 300, 'top');
  const pair = (gap: number) => new Map([['w1', pathFromLanes(a, b, [200])], ['w2', pathFromLanes(end(126, 100, 'bottom'), end(326, 300, 'top'), [200 + gap])]]);

  it('counts wires side by side closer than a gap as overlapping, and wires a gap apart as fine', () => {
    expect(findOverlaps(pair(6))).toHaveLength(1);
    expect(findOverlaps(pair(WIRE_GAP_MM))).toEqual([]);
  });

  it('puts them a gap apart, keeping their order, so no new crossing appears', () => {
    const paths = pair(6);
    const ends = new Map([['w1', { a, b }], ['w2', { a: end(126, 100, 'bottom'), b: end(326, 300, 'top') }]]);
    const { routes, remaining } = spreadOverlaps(paths, ends);
    expect(remaining).toBe(0);
    const lane = (wire: string, fallback: number) => routes.get(wire)?.[0] ?? fallback;
    expect(lane('w2', 206) - lane('w1', 200)).toBeGreaterThanOrEqual(WIRE_GAP_MM - 1e-9);
    expect(lane('w2', 206)).toBeGreaterThan(lane('w1', 200));
  });
});

describe('spreadOverlaps', () => {
  it('moves stacked wires apart so that none lies on another', () => {
    const { paths, ends } = stacked(3);
    const result = spreadOverlaps(paths, ends);
    expect(result.remaining).toBe(0);
    const spread = new Map(paths);
    for (const [wire, lanes] of result.routes) {
      const e = ends.get(wire)!;
      spread.set(wire, pathFromLanes(e.a, e.b, lanes));
    }
    expect(findOverlaps(spread)).toEqual([]);
  });

  it('leaves a gap between the lanes, and moves as few wires as it must', () => {
    const { paths, ends } = stacked(3);
    const result = spreadOverlaps(paths, ends);
    expect(result.routes.size).toBe(2);
    const lanes = [200, ...[...result.routes.values()].map((l) => l[0]!)].sort((a, b) => a - b);
    expect(lanes[1]! - lanes[0]!).toBeGreaterThanOrEqual(WIRE_GAP_MM - 1e-9);
    expect(lanes[2]! - lanes[1]!).toBeGreaterThanOrEqual(WIRE_GAP_MM - 1e-9);
  });

  it('does nothing for wires that are already apart', () => {
    const a = end(100, 100, 'bottom');
    const b = end(300, 300, 'top');
    const paths = new Map([['w1', pathFromLanes(a, b, [200])]]);
    expect(spreadOverlaps(paths, new Map([['w1', { a, b }]]))).toEqual({ routes: new Map(), remaining: 0 });
  });

  it('keeps every route valid: vertical stubs out of the terminals, nothing slanted', () => {
    const { paths, ends } = stacked(5);
    const result = spreadOverlaps(paths, ends);
    for (const [wire, lanes] of result.routes) {
      const e = ends.get(wire)!;
      const path = pathFromLanes(e.a, e.b, lanes);
      path.slice(1).forEach((p, i) => expect(Math.abs(p.x - path[i]!.x) < 1e-9 || Math.abs(p.y - path[i]!.y) < 1e-9).toBe(true));
      expect(path[0]!.x).toBe(path[1]!.x);
      expect(path[path.length - 1]!.x).toBe(path[path.length - 2]!.x);
    }
    expect(result.remaining).toBe(0);
  });
});
