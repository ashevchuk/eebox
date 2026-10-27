import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../src/project/autosave';
import { EXPORT_TEXT_KEY, SCREEN_TEXT_KEY, loadTextVisibility, saveTextVisibility } from '../src/project/textVisibilityStorage';
import { ALL_TEXT, NO_TEXT, TEXT_KINDS, TEXT_NAMES, parseTextVisibility } from '../src/view/textVisibility';

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('text visibility', () => {
  it('names every kind of text', () => {
    for (const kind of TEXT_KINDS) expect(TEXT_NAMES[kind].length).toBeGreaterThan(0);
    expect(new Set(TEXT_KINDS).size).toBe(TEXT_KINDS.length);
  });

  it('shows everything by default and nothing for NO_TEXT', () => {
    expect(TEXT_KINDS.every((kind) => ALL_TEXT[kind])).toBe(true);
    expect(TEXT_KINDS.some((kind) => NO_TEXT[kind])).toBe(false);
    expect(parseTextVisibility(null)).toEqual(ALL_TEXT);
  });

  it('reads what was stored, shows a kind that is missing or not a boolean, and survives garbage', () => {
    const stored = parseTextVisibility(JSON.stringify({ wireLabels: false, currents: 'no', unknown: false }));
    expect(stored.wireLabels).toBe(false);
    expect(stored.currents).toBe(true);
    expect(stored.title).toBe(true);
    expect(parseTextVisibility('not json')).toEqual(ALL_TEXT);
    expect(parseTextVisibility('7')).toEqual(ALL_TEXT);
    expect(parseTextVisibility('null')).toEqual(ALL_TEXT);
  });

  it('keeps the screen and the export choice apart', () => {
    const store = memory();
    saveTextVisibility(store, EXPORT_TEXT_KEY, NO_TEXT);
    expect(loadTextVisibility(store, EXPORT_TEXT_KEY)).toEqual(NO_TEXT);
    expect(loadTextVisibility(store, SCREEN_TEXT_KEY)).toEqual(ALL_TEXT);
  });
});
