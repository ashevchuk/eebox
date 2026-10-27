import { describe, expect, it } from 'vitest';
import { Catalogue, pluralForm } from '../src/i18n/catalogue';
import { loadLanguage, saveLanguage } from '../src/i18n/language';
import type { KeyValueStore } from '../src/project/autosave';

const memory = (): KeyValueStore => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('plural forms', () => {
  it('are one for 1, 21, 101, few for 2-4 and 22-24, and many for the rest, 11-14 included', () => {
    const forms = (...numbers: number[]) => numbers.map(pluralForm);
    expect(forms(1, 21, 101, 1001)).toEqual([0, 0, 0, 0]);
    expect(forms(2, 3, 4, 22, 23, 24, 102)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(forms(0, 5, 9, 10, 11, 12, 13, 14, 15, 20, 25, 111, 112)).toEqual(Array(13).fill(2));
  });
});

describe('the catalogue', () => {
  const catalogue = new Catalogue({
    Close: '\u0417\u0430\u043a\u0440\u0438\u0442\u0438',
    'Saved {name}.': '\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e {name}.',
    '{n} wires added': ['{n} \u0434\u0440\u0456\u0442 \u0434\u043e\u0434\u0430\u043d\u043e', '{n} \u0434\u0440\u043e\u0442\u0438 \u0434\u043e\u0434\u0430\u043d\u043e', '{n} \u0434\u0440\u043e\u0442\u0456\u0432 \u0434\u043e\u0434\u0430\u043d\u043e'],
    '{a} of {b}': '{a} \u0437 {b}',
    '{x}: added "{title}".': '{x}: \u0434\u043e\u0434\u0430\u043d\u043e «{title}».',
    'Wire {id}: {what}': '\u0414\u0440\u0456\u0442 {id}: {what}',
  });

  it('translates a phrase as it stands, and leaves what it does not know as it was', () => {
    expect(catalogue.translate('Close')).toBe('\u0417\u0430\u043a\u0440\u0438\u0442\u0438');
    expect(catalogue.translate('Nothing like it')).toBe('Nothing like it');
    expect(catalogue.translate('')).toBe('');
    expect(catalogue.translate('   ')).toBe('   ');
  });

  it('keeps the space around a phrase', () => {
    expect(catalogue.translate('  Close \n')).toBe('  \u0417\u0430\u043a\u0440\u0438\u0442\u0438 \n');
  });

  it('fills the places of a phrase with what stood there', () => {
    expect(catalogue.translate('Saved kitchen.')).toBe('\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e kitchen.');
    expect(catalogue.translate('3 of 12')).toBe('3 \u0437 12');
    expect(catalogue.translate('a.json: added "House panel".')).toBe('a.json: \u0434\u043e\u0434\u0430\u043d\u043e «House panel».');
  });

  it('picks the form of a number', () => {
    expect(catalogue.translate('1 wires added')).toBe('1 \u0434\u0440\u0456\u0442 \u0434\u043e\u0434\u0430\u043d\u043e');
    expect(catalogue.translate('3 wires added')).toBe('3 \u0434\u0440\u043e\u0442\u0438 \u0434\u043e\u0434\u0430\u043d\u043e');
    expect(catalogue.translate('12 wires added')).toBe('12 \u0434\u0440\u043e\u0442\u0456\u0432 \u0434\u043e\u0434\u0430\u043d\u043e');
  });

  it('translates a text of several lines line by line, and leaves a line that is not a phrase', () => {
    expect(catalogue.translate('Close\nsomething else\nClose')).toBe('\u0417\u0430\u043a\u0440\u0438\u0442\u0438\nsomething else\n\u0417\u0430\u043a\u0440\u0438\u0442\u0438');
  });

  it('does not translate what it has translated: the result is not a phrase', () => {
    const once = catalogue.translate('Close');
    expect(catalogue.translate(once)).toBe(once);
  });

  it('is not caught by the signs of a pattern in the phrase', () => {
    const c = new Catalogue({ 'Cost (EUR): {n}.': '\u0412\u0430\u0440\u0442\u0456\u0441\u0442\u044c (EUR): {n}.' });
    expect(c.translate('Cost (EUR): 5.')).toBe('\u0412\u0430\u0440\u0442\u0456\u0441\u0442\u044c (EUR): 5.');
    expect(c.translate('Cost XEUR): 5.')).toBe('Cost XEUR): 5.');
  });

  it('tries the phrase that fixes more letters first', () => {
    const c = new Catalogue({ '{x}': 'any', 'Wire {id}: broken': 'specific' });
    expect(c.translate('Wire w1: broken')).toBe('specific');
  });
});

describe('the language of a visitor', () => {
  it('is the one that was chosen, else the first the browser asks for that we have, else English', () => {
    expect(loadLanguage(memory(), ['de-DE', 'uk-UA', 'en'])).toBe('uk');
    expect(loadLanguage(memory(), ['en-GB'])).toBe('en');
    expect(loadLanguage(memory(), ['fr'])).toBe('en');
    expect(loadLanguage(null, [])).toBe('en');
    const store = memory();
    saveLanguage(store, 'en');
    expect(loadLanguage(store, ['uk'])).toBe('en');
    saveLanguage(store, 'uk');
    expect(loadLanguage(store, ['en'])).toBe('uk');
  });

  it('ignores a stored value that is not a language, and a store that throws', () => {
    const store = memory();
    store.setItem('eebox:language', 'klingon');
    expect(loadLanguage(store, ['uk'])).toBe('uk');
    const broken: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadLanguage(broken, ['uk'])).toBe('uk');
    expect(() => saveLanguage(broken, 'uk')).not.toThrow();
  });
});

describe('phrases inside a phrase', () => {
  const catalogue = new Catalogue({
    'Backed up {a} and {b}.': '\u0420\u0435\u0437\u0435\u0440\u0432\u043d\u0430 \u043a\u043e\u043f\u0456\u044f: {a} \u0456 {b}.',
    '{n} projects': ['{n} \u043f\u0440\u043e\u0454\u043a\u0442', '{n} \u043f\u0440\u043e\u0454\u043a\u0442\u0438', '{n} \u043f\u0440\u043e\u0454\u043a\u0442\u0456\u0432'],
    '{n} project': ['{n} \u043f\u0440\u043e\u0454\u043a\u0442', '{n} \u043f\u0440\u043e\u0454\u043a\u0442\u0438', '{n} \u043f\u0440\u043e\u0454\u043a\u0442\u0456\u0432'],
    Close: '\u0417\u0430\u043a\u0440\u0438\u0442\u0438',
  });

  it('are translated where they stand, with the form their own number asks for', () => {
    expect(catalogue.translate('Backed up 1 project and 5 projects.')).toBe('\u0420\u0435\u0437\u0435\u0440\u0432\u043d\u0430 \u043a\u043e\u043f\u0456\u044f: 1 \u043f\u0440\u043e\u0454\u043a\u0442 \u0456 5 \u043f\u0440\u043e\u0454\u043a\u0442\u0456\u0432.');
  });

  it('are left alone when they are not phrases, such as the name of a project', () => {
    expect(catalogue.translate('Backed up Flat and 2 projects.')).toBe('\u0420\u0435\u0437\u0435\u0440\u0432\u043d\u0430 \u043a\u043e\u043f\u0456\u044f: Flat \u0456 2 \u043f\u0440\u043e\u0454\u043a\u0442\u0438.');
  });
});

describe('a full stop at the end', () => {
  const catalogue = new Catalogue({ 'Restored {x}': '\u0412\u0456\u0434\u043d\u043e\u0432\u043b\u0435\u043d\u043e {x}', 'Done.': '\u0413\u043e\u0442\u043e\u0432\u043e.' });

  it('is carried over when the phrase has none, and not doubled when it has', () => {
    expect(catalogue.translate('Restored backup.json.')).toBe('\u0412\u0456\u0434\u043d\u043e\u0432\u043b\u0435\u043d\u043e backup.json.');
    expect(catalogue.translate('Done.')).toBe('\u0413\u043e\u0442\u043e\u0432\u043e.');
  });
});
