import { describe, expect, it } from 'vitest';
import { CONDUCTORS } from '../src/library/types';
import {
  BUILT_IN_SCHEMES,
  EU_SCHEME,
  colourSchemeToText,
  contrastRatio,
  parseColourScheme,
  styleOf,
  type ColourScheme,
  type Ground,
} from '../src/view/colourScheme';

const GROUNDS: Ground[] = ['dark', 'light'];
const GROUND_COLOUR = { dark: '#0b0c10', light: '#ffffff' } as const;

describe.each(BUILT_IN_SCHEMES.map((s) => [s.name, s] as const))('%s', (_name, scheme) => {
  it('has a colour for every conductor, as #rrggbb', () => {
    for (const conductor of CONDUCTORS) expect(scheme.colours[conductor].color, conductor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps every conductor visible on both grounds, by itself or with an outline that is', () => {
    for (const ground of GROUNDS) {
      for (const conductor of CONDUCTORS) {
        const style = styleOf(scheme.colours, conductor, ground);
        const parts = [style.color, ...(style.stripe ? [style.stripe] : [])];
        const alone = parts.every((c) => contrastRatio(c, GROUND_COLOUR[ground]) >= 3);
        const outlined = style.outline !== undefined && contrastRatio(style.outline, GROUND_COLOUR[ground]) >= 3;
        expect(alone || outlined, `${conductor} on ${ground}`).toBe(true);
      }
    }
  });

  it('tells the three phases and the neutral apart', () => {
    const colours = ['L1', 'L2', 'L3', 'N'].map((c) => scheme.colours[c as 'L1'].color);
    expect(new Set(colours).size).toBe(4);
  });
});

describe('styleOf', () => {
  it('outlines black on a dark ground and not on paper, and gives the earth conductor its stripe', () => {
    expect(styleOf(EU_SCHEME, 'L2', 'dark').outline).toBeDefined();
    expect(styleOf(EU_SCHEME, 'L2', 'light').outline).toBeUndefined();
    expect(styleOf(EU_SCHEME, 'PE', 'dark').stripe).toBe('#f2d21b');
  });

  it('outlines a yellow phase on paper', () => {
    const yellow: ColourScheme = { ...EU_SCHEME, L1: { color: '#e3bd0b' } };
    expect(styleOf(yellow, 'L1', 'light').outline).toBeDefined();
    expect(styleOf(yellow, 'L1', 'dark').outline).toBeUndefined();
  });

  it('the stripe of the earth conductor is outlined on paper, where yellow is lost', () => {
    expect(styleOf(EU_SCHEME, 'PE', 'light').outline).toBeDefined();
  });
});

describe('parseColourScheme', () => {
  it('reads back what colourSchemeToText wrote', () => {
    expect(parseColourScheme(colourSchemeToText(EU_SCHEME))).toEqual({ ok: true, scheme: EU_SCHEME });
  });

  const edit = (change: (j: any) => void) => {
    const j = JSON.parse(colourSchemeToText(EU_SCHEME));
    change(j);
    const r = parseColourScheme(JSON.stringify(j));
    return r.ok ? [] : r.errors.map((e) => e.path);
  };

  it('names the field that is wrong', () => {
    expect(edit((j) => (j.colours.L2.color = 'black'))).toEqual(['colours.L2.color']);
    expect(edit((j) => (j.colours.PE.stripe = '#12'))).toEqual(['colours.PE.stripe']);
    expect(edit((j) => delete j.colours.N)).toEqual(['colours.N']);
    expect(edit((j) => (j.colours.Q = { color: '#000000' }))).toEqual(['colours.Q']);
    expect(edit((j) => (j.colours.L1.shade = 1))).toEqual(['colours.L1.shade']);
    expect(edit((j) => (j.format = 'other'))).toEqual(['format']);
    expect(edit((j) => (j.surprise = 1))).toEqual(['surprise']);
  });

  it('reports text that is not JSON and values that are not objects', () => {
    expect(parseColourScheme('{')).toMatchObject({ ok: false });
    expect(parseColourScheme('[]')).toEqual({ ok: false, errors: [{ path: '', message: 'must be an object' }] });
  });

  it('accepts upper-case hex and stores it lower-case', () => {
    const j = JSON.parse(colourSchemeToText(EU_SCHEME));
    j.colours.N.color = '#2F7DE1';
    const r = parseColourScheme(JSON.stringify(j));
    expect(r.ok && r.scheme.N.color).toBe('#2f7de1');
  });
});
