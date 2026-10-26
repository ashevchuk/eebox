import { describe, expect, it } from 'vitest';
import { fileStem } from '../src/project/names';

describe('fileStem', () => {
  it('turns a title into a lower-case, dash-separated name', () => {
    expect(fileStem('Flat 12, Kitchen!', 'panel')).toBe('flat-12-kitchen');
  });

  it('falls back when there is no title or nothing usable in it', () => {
    expect(fileStem(undefined, 'panel')).toBe('panel');
    expect(fileStem('   ', 'panel')).toBe('panel');
    expect(fileStem('***///', 'panel')).toBe('panel');
  });

  it('keeps letters of other scripts instead of dropping them', () => {
    expect(fileStem('\u0429\u0438\u0442 \u2116 5', 'panel')).toBe('\u0449\u0438\u0442-5');
  });

  it('never produces path separators, dots or spaces', () => {
    for (const hostile of ['../../etc/passwd', 'a/b\\c', 'x.y z', 'con:aux']) {
      expect(fileStem(hostile, 'panel')).toMatch(/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u);
    }
  });

  it('limits the length without leaving a trailing dash', () => {
    const stem = fileStem(`${'a'.repeat(39)} bbbbbbbb`, 'panel');
    expect(stem.length).toBeLessThanOrEqual(40);
    expect(stem.endsWith('-')).toBe(false);
  });
});
