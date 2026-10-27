import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/project/canonical';

describe('canonical JSON', () => {
  it('does not depend on the order of the keys, at any depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 }));
  });

  it('tells values that differ apart, and keeps the order of a list', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('is plain JSON for plain values', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('a')).toBe('"a"');
    expect(canonicalJson({})).toBe('{}');
  });
});
