import { describe, expect, it } from 'vitest';
import { loadColourChoice, saveColourChoice } from '../src/project/colourSchemeStorage';
import { CONTRAST_SCHEME, DEFAULT_COLOUR_CHOICE, EU_SCHEME, PUE_SCHEME, coloursOf, type ColourChoice } from '../src/view/colourScheme';

const store = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => void (value = v),
    peek: () => value,
  };
};

describe('colour choice storage', () => {
  it('gives the default when nothing is stored', () => {
    expect(loadColourChoice(store())).toEqual({ choice: DEFAULT_COLOUR_CHOICE });
  });

  it('keeps a built-in choice and the custom colours next to it', () => {
    const choice: ColourChoice = { scheme: 'pue', custom: { ...EU_SCHEME, N: { color: '#00ffaa' } } };
    const s = store();
    expect(saveColourChoice(s, choice)).toBe(true);
    expect(loadColourChoice(s)).toEqual({ choice });
  });

  it('reports and ignores what does not read, and does not throw', () => {
    for (const bad of ['{', JSON.stringify({ scheme: 'neon', custom: EU_SCHEME }), JSON.stringify({ scheme: 'eu', custom: { L: { color: 'red' } } })]) {
      const result = loadColourChoice(store(bad));
      expect(result.choice).toEqual(DEFAULT_COLOUR_CHOICE);
      expect(result.problem).toMatch(/ignored/);
    }
  });

  it('reports a store that refuses to be read or written', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadColourChoice(broken).problem).toMatch(/unreadable/);
    expect(saveColourChoice(broken, DEFAULT_COLOUR_CHOICE)).toBe(false);
  });
});

describe('coloursOf', () => {
  it('gives the colours of the chosen scheme, or the custom ones', () => {
    const custom = { ...EU_SCHEME, L1: { color: '#123456' } };
    expect(coloursOf({ scheme: 'eu', custom })).toBe(EU_SCHEME);
    expect(coloursOf({ scheme: 'pue', custom })).toBe(PUE_SCHEME);
    expect(coloursOf({ scheme: 'contrast', custom })).toBe(CONTRAST_SCHEME);
    expect(coloursOf({ scheme: 'custom', custom })).toBe(custom);
  });
});
