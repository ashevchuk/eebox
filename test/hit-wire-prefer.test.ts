import { describe, expect, it } from 'vitest';
import { hitWire } from '../src/schematic/geometry';
import type { Schematic, Wire } from '../src/schematic/model';

const wire = (id: string): Wire => ({ id, a: { node: 'a', terminal: 'top:1' }, b: { node: 'b', terminal: 'top:1' } });
const schematic: Schematic = { nodes: [], wires: [wire('w1'), wire('w2'), wire('w3')] };
/** w1 and w2 run along the same line; w3 is elsewhere. */
const routes = new Map([
  ['w1', [{ x: 0, y: 0 }, { x: 100, y: 0 }]],
  ['w2', [{ x: 0, y: 0 }, { x: 100, y: 0 }]],
  ['w3', [{ x: 0, y: 50 }, { x: 100, y: 50 }]],
]);
const onBoth = { x: 50, y: 1 };

describe('hitWire where wires run on top of each other', () => {
  it('takes the one drawn last when nothing is preferred', () => {
    expect(hitWire(schematic, routes, onBoth, 6)?.id).toBe('w2');
  });

  it('takes the preferred one when it is among those under the point, as a press on the grip of a selected wire must', () => {
    expect(hitWire(schematic, routes, onBoth, 6, ['w1'])?.id).toBe('w1');
  });

  it('takes any of several preferred ones, the one drawn last of them', () => {
    expect(hitWire(schematic, routes, onBoth, 6, ['w1', 'w2'])?.id).toBe('w2');
  });

  it('ignores a preferred wire that is not under the point', () => {
    expect(hitWire(schematic, routes, onBoth, 6, ['w3'])?.id).toBe('w2');
    expect(hitWire(schematic, routes, { x: 50, y: 49 }, 6, ['w1'])?.id).toBe('w3');
  });

  it('finds nothing away from every wire, whatever is preferred', () => {
    expect(hitWire(schematic, routes, { x: 50, y: 200 }, 6, ['w1'])).toBeUndefined();
  });
});
