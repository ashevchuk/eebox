import { describe, expect, it } from 'vitest';
import { ampacityA, CROSS_SECTIONS_MM2, INSTALL_METHODS, minimumSectionMm2 } from '../src/electrical/cables';

describe('cable table', () => {
  it('has a value for every method, loading and cross-section', () => {
    for (const method of INSTALL_METHODS) {
      for (const loaded of [2, 3] as const) {
        for (const section of CROSS_SECTIONS_MM2) expect(ampacityA(method, loaded, section)).toBeGreaterThan(0);
      }
    }
  });

  it('grows with the cross-section', () => {
    for (const method of INSTALL_METHODS) {
      for (const loaded of [2, 3] as const) {
        const values = CROSS_SECTIONS_MM2.map((s) => ampacityA(method, loaded, s)!);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });

  it('never allows more with three loaded conductors than with two', () => {
    for (const method of INSTALL_METHODS) {
      for (const section of CROSS_SECTIONS_MM2) {
        expect(ampacityA(method, 3, section)!).toBeLessThan(ampacityA(method, 2, section)!);
      }
    }
  });

  it('agrees with the two values of method C, three loaded conductors, that a second source gave', () => {
    expect(ampacityA('C', 3, 1.5)).toBe(17.5);
    expect(ampacityA('C', 3, 2.5)).toBe(24);
  });

  it('knows nothing about a cross-section that is not listed', () => {
    expect(ampacityA('C', 2, 3)).toBeUndefined();
  });
});

describe('minimumSectionMm2', () => {
  it('picks the smallest section that carries the current, edge included', () => {
    expect(minimumSectionMm2('C', 2, 19.5)).toBe(1.5);
    expect(minimumSectionMm2('C', 2, 19.6)).toBe(2.5);
    expect(minimumSectionMm2('C', 3, 17.6)).toBe(2.5);
  });

  it('needs more with a worse laying method', () => {
    expect(minimumSectionMm2('B2', 2, 20)).toBeGreaterThan(minimumSectionMm2('E', 2, 20)!);
  });

  it('gives nothing when even the largest section is too small', () => {
    expect(minimumSectionMm2('C', 2, 500)).toBeUndefined();
  });
});
