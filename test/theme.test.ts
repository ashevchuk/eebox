import { describe, expect, it } from 'vitest';
import { CONDUCTORS } from '../src/library/types';
import { DARK_THEME, LIGHT_THEME, theme, withTheme, type Theme } from '../src/view/theme';

const channel = (hex: string, from: number) => {
  const v = parseInt(hex.slice(from, from + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
/** WCAG contrast ratio of two #rrggbb colours. */
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const rgbOf = (css: string) => {
  const [r, g, b] = css.match(/\d+/g)!.slice(0, 3).map(Number);
  return `#${[r, g, b].map((n) => n!.toString(16).padStart(2, '0')).join('')}`;
};

describe.each([['dark', DARK_THEME], ['light', LIGHT_THEME]] as [string, Theme][])('%s theme', (_name, t) => {
  it('keeps every conductor colour visible on its background', () => {
    for (const conductor of CONDUCTORS) expect(contrast(t.conductors[conductor], t.background), conductor).toBeGreaterThanOrEqual(3);
  });

  it('keeps labels readable on the frame and on the wire label chip', () => {
    expect(contrast(t.label, t.frameFill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.rowLabel, t.frameFill)).toBeGreaterThanOrEqual(3);
    expect(contrast(t.wireLabelText, rgbOf(t.wireLabelBackground))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('withTheme', () => {
  it('switches the theme for the call and restores it afterwards, also after an error', () => {
    expect(theme()).toBe(DARK_THEME);
    expect(withTheme(LIGHT_THEME, () => theme())).toBe(LIGHT_THEME);
    expect(theme()).toBe(DARK_THEME);
    expect(() => withTheme(LIGHT_THEME, () => { throw new Error('x'); })).toThrow('x');
    expect(theme()).toBe(DARK_THEME);
  });
});
