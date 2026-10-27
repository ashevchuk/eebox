import { describe, expect, it } from 'vitest';
import { centreOf, pinchStep } from '../src/view/pinch';

const pair = (ax: number, ay: number, bx: number, by: number) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('two fingers on the screen', () => {
  it('zoom in when they move apart and out when they move together, by the ratio of the distances', () => {
    expect(pinchStep(pair(0, 0, 100, 0), pair(0, 0, 200, 0))?.factor).toBe(2);
    expect(pinchStep(pair(0, 0, 100, 0), pair(25, 0, 75, 0))?.factor).toBe(0.5);
  });

  it('do not zoom when they only move together, but pan by the move of their centre', () => {
    const step = pinchStep(pair(0, 0, 100, 0), pair(30, 40, 130, 40))!;
    expect(step.factor).toBe(1);
    expect(step.pan).toEqual({ x: 30, y: 40 });
  });

  it('do both at once', () => {
    const step = pinchStep(pair(100, 100, 200, 100), pair(50, 100, 250, 100))!;
    expect(step.factor).toBe(2);
    expect(step.pan).toEqual({ x: 0, y: 0 });
  });

  it('keep the point between the fingers under the fingers: the centre is where the zoom is about', () => {
    expect(centreOf(pair(0, 0, 100, 40))).toEqual({ x: 50, y: 20 });
  });

  it('say nothing when they start almost on top of each other, and never zoom wildly in one step', () => {
    expect(pinchStep(pair(10, 10, 12, 10), pair(0, 0, 500, 0))).toBeNull();
    expect(pinchStep(pair(0, 0, 10, 0), pair(0, 0, 1000, 0))?.factor).toBe(4);
    expect(pinchStep(pair(0, 0, 1000, 0), pair(0, 0, 10, 0))?.factor).toBe(0.25);
  });
});
