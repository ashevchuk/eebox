import { describe, expect, it } from 'vitest';
import { ellipsize, wrapText } from '../src/view/textFit';

/** One unit per character, so widths are easy to reason about. */
const measure = (text: string) => text.length;

describe('ellipsize', () => {
  it('leaves text that fits alone and cuts the rest with an ellipsis that still fits', () => {
    expect(ellipsize(measure, 'abc', 5)).toBe('abc');
    expect(ellipsize(measure, 'abcdefgh', 5)).toBe('abcd…');
    expect(measure(ellipsize(measure, 'abcdefgh', 5))).toBeLessThanOrEqual(5);
  });

  it('does not leave a space before the ellipsis', () => {
    expect(ellipsize(measure, 'ab cdefgh', 4)).toBe('ab…');
  });
});

describe('wrapText', () => {
  it('keeps one line when the text fits', () => {
    expect(wrapText(measure, 'Contactor 3P', 20, 3)).toEqual(['Contactor 3P']);
  });

  it('breaks at spaces and keeps every line within the width', () => {
    const lines = wrapText(measure, 'Contactor 3P 40A, 230V coil', 12, 3);
    expect(lines).toEqual(['Contactor 3P', '40A, 230V', 'coil']);
    expect(lines.every((l) => measure(l) <= 12)).toBe(true);
  });

  it('ends the last allowed line with an ellipsis instead of dropping the rest silently', () => {
    const lines = wrapText(measure, 'Automatic transfer controller 3P+N', 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
    expect(lines.every((l) => measure(l) <= 12)).toBe(true);
  });

  it('cuts a single word that is wider than a line', () => {
    expect(wrapText(measure, 'Supercalifragilistic', 8, 3)).toEqual(['Superca…']);
  });

  it('gives nothing for empty text', () => {
    expect(wrapText(measure, '   ', 10, 2)).toEqual([]);
  });
});
