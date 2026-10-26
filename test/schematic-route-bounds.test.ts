import { describe, expect, it } from 'vitest';
import { boundsWithRoutes } from '../src/schematic/geometry';

const base = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe('boundsWithRoutes', () => {
  it('keeps the bounds when every route lies inside', () => {
    expect(boundsWithRoutes(base, new Map([['w1', [{ x: 20, y: 20 }, { x: 80, y: 80 }]]]))).toEqual(base);
  });

  it('grows to take in a route that runs outside the nodes', () => {
    const bounds = boundsWithRoutes(base, new Map([['w1', [{ x: -200, y: 50 }, { x: 50, y: 300 }]]]));
    expect(bounds.minX).toBeLessThan(-200);
    expect(bounds.maxY).toBeGreaterThan(300);
    expect(bounds.maxX).toBe(100);
  });
});
