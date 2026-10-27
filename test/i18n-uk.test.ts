import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import { Catalogue } from '../src/i18n/catalogue';
import { UKRAINIAN } from '../src/i18n/uk';

const placeholders = (text: string): string[] => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!).sort();
const forms = (entry: (typeof UKRAINIAN)[string]): string[] => (typeof entry === 'string' ? [entry] : [...entry]);
const HAS_CYRILLIC = /[\u0400-\u04ff]/;

describe('the Ukrainian dictionary', () => {
  const entries = Object.entries(UKRAINIAN);

  it('is not small', () => {
    expect(entries.length).toBeGreaterThan(400);
  });

  it('has a translation for every phrase, and none of them empty', () => {
    for (const [phrase, entry] of entries) for (const form of forms(entry)) expect(form.trim().length, phrase).toBeGreaterThan(0);
  });

  it('puts the same places in a translation as in its phrase', () => {
    for (const [phrase, entry] of entries) for (const form of forms(entry)) expect(placeholders(form), phrase).toEqual(placeholders(phrase));
  });

  it('has three forms exactly for the phrases that have a number {n}', () => {
    for (const [phrase, entry] of entries) {
      if (typeof entry === 'string') continue;
      expect(entry.length, phrase).toBe(3);
      expect(placeholders(phrase), phrase).toContain('n');
    }
  });

  it('is in Ukrainian: every translation has a Cyrillic letter, but for the few that are the same in both languages', () => {
    // Phrases that are the same in both languages: a pencil or an arrow after a heading that is translated where it stands.
    const same = new Set(['OK', 'Ctrl+C, Ctrl+V', 'Tab, Shift+Tab', '{h} \u270e', '{h} \u25b4', '{h} \u25be', '{h} \u270e \u25b4', '{h} \u270e \u25be']);
    for (const [phrase, entry] of entries) {
      if (same.has(phrase)) continue;
      for (const form of forms(entry)) expect(HAS_CYRILLIC.test(form), `${phrase} => ${form}`).toBe(true);
    }
  });

  it('does not turn a translation back into another phrase: translating twice changes nothing', () => {
    const catalogue = new Catalogue(UKRAINIAN);
    for (const [phrase, entry] of entries) {
      if (typeof entry !== 'string' || placeholders(phrase).length > 0) continue;
      const once = catalogue.translate(phrase);
      expect(catalogue.translate(once), phrase).toBe(once);
    }
  });
});

describe('the text of the page', () => {
  /** Everything the page shows by itself: the text between tags and the hints of its elements. */
  const shown = (): string[] => {
    const body = indexHtml.slice(indexHtml.indexOf('<body'), indexHtml.indexOf('<script'));
    const text = [...body.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]!);
    const hints = [...body.matchAll(/(?:title|placeholder|aria-label)="([^"]+)"/g)].map((m) => m[1]!);
    return [...text, ...hints].map((s) => s.replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()).filter((s) => /[A-Za-z]{2}/.test(s));
  };

  it('is all in the dictionary but the name of the application', () => {
    const missing = [...new Set(shown())].filter((s) => s !== 'eebox' && !(s in UKRAINIAN));
    expect(missing).toEqual([]);
  });
});
