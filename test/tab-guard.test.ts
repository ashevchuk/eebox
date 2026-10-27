import { describe, expect, it } from 'vitest';
import { AUTOSAVE_KEY } from '../src/project/autosave';
import { TabGuard } from '../src/project/tabGuard';

describe('the guard against a second tab', () => {
  it('has no conflict until another tab writes the autosave', () => {
    const guard = new TabGuard();
    expect(guard.conflict).toBe(false);
    expect(guard.seen(AUTOSAVE_KEY, '{"a":1}')).toBe(true);
    expect(guard.conflict).toBe(true);
  });

  it('does not take what this tab wrote for the work of another', () => {
    const guard = new TabGuard();
    guard.wrote('{"mine":1}');
    expect(guard.seen(AUTOSAVE_KEY, '{"mine":1}')).toBe(false);
    expect(guard.conflict).toBe(false);
  });

  it('starts a conflict once, however many writes follow', () => {
    const guard = new TabGuard();
    expect(guard.seen(AUTOSAVE_KEY, 'a')).toBe(true);
    expect(guard.seen(AUTOSAVE_KEY, 'b')).toBe(false);
    expect(guard.conflict).toBe(true);
  });

  it('ends the conflict when the person has chosen, and sees the next write as a new one', () => {
    const guard = new TabGuard();
    guard.seen(AUTOSAVE_KEY, 'a');
    guard.resolve();
    expect(guard.conflict).toBe(false);
    expect(guard.seen(AUTOSAVE_KEY, 'b')).toBe(true);
  });

  it('ignores other keys, and a store that was cleared', () => {
    const guard = new TabGuard();
    expect(guard.seen('eebox:colour-scheme', 'x')).toBe(false);
    expect(guard.seen(AUTOSAVE_KEY, null)).toBe(false);
    expect(guard.seen(null, null)).toBe(false);
    expect(guard.conflict).toBe(false);
  });
});
