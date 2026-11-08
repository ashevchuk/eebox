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

  it('turns the length label and the contents line of a row into Ukrainian, whichever of them is one', () => {
    expect(t('Length')).toBe('\u0414\u043e\u0432\u0436\u0438\u043d\u0430');
    expect(t('units, 420 mm')).toBe('\u043c\u043e\u0434\u0443\u043b\u0456\u0432, 420 \u043c\u043c');
    expect(t('units, 22.5 mm')).toBe('\u043c\u043e\u0434\u0443\u043b\u0456\u0432, 22.5 \u043c\u043c');
    const row = (a: number, b: number) => `${a} module${a === 1 ? '' : 's'}, ${b} comb${b === 1 ? '' : 's'}`;
    for (const [a, b] of [[1, 1], [1, 0], [3, 1], [4, 0], [0, 2]] as const) {
      expect(t(row(a, b)), row(a, b)).toBe(`\u043c\u043e\u0434\u0443\u043b\u0456\u0432: ${a}, \u0433\u0440\u0435\u0431\u0456\u043d\u043e\u043a: ${b}`);
    }
  });

  it('turns the summary of the terminals of a bar of one row into Ukrainian, on whichever side they are', () => {
    expect(t('top 12 \u00b7 no bottom')).toBe('\u0432\u0435\u0440\u0445 12 \u00b7 \u0431\u0435\u0437 \u043d\u0438\u0437\u0443');
    expect(t('no top \u00b7 bottom N1 N2')).toBe('\u0431\u0435\u0437 \u0432\u0435\u0440\u0445\u0443 \u00b7 \u043d\u0438\u0437 N1 N2');
  });

  it('turns the side in the end of a wire, and still the sides in a summary of terminals', () => {
    expect(t('Main switch \u00b7 bottom L1')).toBe('Main switch \u00b7 \u043d\u0438\u0437 L1');
    expect(t('Kitchen sockets \u00b7 top N')).toBe('Kitchen sockets \u00b7 \u0432\u0435\u0440\u0445 N');
    expect(t('top 12 \u00b7 bottom 12')).toBe('\u0432\u0435\u0440\u0445 12 \u00b7 \u043d\u0438\u0437 12');
    expect(t('top L1 L2 \u00b7 bottom L1 L2')).toBe('\u0432\u0435\u0440\u0445 L1 L2 \u00b7 \u043d\u0438\u0437 L1 L2');
  });

  it('turns the labels, hints and options of the inspector of a source, a load, a comb and a switch into Ukrainian', () => {
    for (const phrase of ['Source', 'Conductors', 'not stated', 'kA at the panel; empty for unknown', 'mOhm phase to neutral; empty for unknown', 'from 0.1 to 1; empty for 1', 'm from the panel; empty for unknown', 'lighting', 'Current', 'Comb', 'Pins', 'closed', 'rail', 'plate', 'both']) {
      expect(HAS_ENGLISH.test(t(phrase)), phrase).toBe(false);
    }
  });

  it('turns the note about the cable table into Ukrainian as a whole', () => {
    const note = 'Ampacities (copper, PVC, 30 \u00b0C, 1.5 to 35 mm\u00b2) match IEC 60364-5-52:2009 tables B.52.2, B.52.4 and B.52.10; resistivity, reactance, voltage drop limits and trip multiples are not verified. Replace them in File > Cable settings.';
    expect(t(note)).not.toBe(note);
    expect(HAS_ENGLISH.test(t(note).replace(/IEC/g, ''))).toBe(false);
  });

  it('turns the end of a wire into Ukrainian, and the summary of terminals is still read as a whole', () => {
    expect(t('Main switch \u00b7 bottom L1')).toBe('Main switch \u00b7 \u043d\u0438\u0437 L1');
    expect(t('Kitchen \u00b7 top N')).toBe('Kitchen \u00b7 \u0432\u0435\u0440\u0445 N');
    expect(t('top L1 L2 \u00b7 bottom L1 L2')).toBe('\u0432\u0435\u0440\u0445 L1 L2 \u00b7 \u043d\u0438\u0437 L1 L2');
  });

  it('turns the labels and hints of the inspector of a source, a load and a comb into Ukrainian', () => {
    for (const phrase of ['Source', 'Conductors', 'not stated', 'kA at the panel; empty for unknown', 'mOhm phase to neutral; empty for unknown', 'from 0.1 to 1; empty for 1', 'm from the panel; empty for unknown', 'lighting', 'Current', 'Comb', 'Pins', 'closed', 'rail', 'plate', 'both']) {
      expect(HAS_ENGLISH.test(t(phrase)), phrase).toBe(false);
    }
    expect(HAS_ENGLISH.test(t('Ampacities (copper, PVC, 30 \u00b0C, 1.5 to 35 mm\u00b2) match IEC 60364-5-52:2009 tables B.52.2, B.52.4 and B.52.10; resistivity, reactance, voltage drop limits and trip multiples are not verified. Replace them in File > Cable settings.').replace(/IEC|PVC|B\.52\.\d+/g, ''))).toBe(false);
  });

  it('turns what the inspector and the designer say of terminals down the sides into Ukrainian', () => {
    for (const phrase of ['right N1 N2 \u00b7 no left', 'no right \u00b7 left Nb1', 'right 12 \u00b7 left 12', 'N1 (right)', 'N1 (left)', 'Label the right terminals', 'Label the left terminals', 'Terminal layout', 'in a row across the width', 'in a column down the sides', 'units from the top edge, decimals allowed']) {
      expect(HAS_ENGLISH.test(t(phrase).replace(/N\d+|Nb\d+/g, '')), phrase).toBe(false);
    }
  });
});
