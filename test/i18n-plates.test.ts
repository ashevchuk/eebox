import { describe, expect, it } from 'vitest';
import { Catalogue } from '../src/i18n/catalogue';
import { UKRAINIAN } from '../src/i18n/uk';

const t = (text: string): string => new Catalogue(UKRAINIAN).translate(text);
const HAS_ENGLISH = /[A-Za-z]{4,}/;

describe('the Ukrainian text of the plate and the terminal features', () => {
  it('turns the contents line with ducts into Ukrainian as a whole', () => {
    expect(t('16 modules, 0 combs, 3 ducts, 0 on the shelf')).toBe('\u043c\u043e\u0434\u0443\u043b\u0456\u0432: 16, \u0433\u0440\u0435\u0431\u0456\u043d\u043e\u043a: 0, \u043a\u0430\u043d\u0430\u043b\u0456\u0432: 3, \u043d\u0430 \u043f\u043e\u043b\u0438\u0446\u0456: 0');
  });

  it('says what differs from the libraries and what has gone, without English', () => {
    expect(HAS_ENGLISH.test(t('5 no longer in any library'))).toBe(false);
    expect(HAS_ENGLISH.test(t('2 differ from the libraries'))).toBe(false);
  });

  it('turns the tab of the terminal schedule and its note into Ukrainian, in the right form of the noun', () => {
    expect(t('Terminals (12)')).toBe('\u041a\u043b\u0435\u043c\u0438 (12)');
    expect(t('1 terminal. A terminal that is not wired on a side shows nothing there.')).toMatch(/^1 \u043a\u043b\u0435\u043c\u0430\./);
    expect(t('2 terminals. A terminal that is not wired on a side shows nothing there.')).toMatch(/^2 \u043a\u043b\u0435\u043c\u0438\./);
    expect(t('12 terminals. A terminal that is not wired on a side shows nothing there.')).toMatch(/^12 \u043a\u043b\u0435\u043c\./);
    expect(HAS_ENGLISH.test(t('12 terminals. A terminal that is not wired on a side shows nothing there.'))).toBe(false);
  });
});
