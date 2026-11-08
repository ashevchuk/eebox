import { describe, expect, it } from 'vitest';
import { Catalogue } from '../src/i18n/catalogue';
import { UKRAINIAN } from '../src/i18n/uk';
import { NET_PROBLEM_TEXT } from '../src/electrical/problems';
import { earthingProblem } from '../src/electrical/earthing';
import { CIRCUIT_HEADER, WIRE_HEADER } from '../src/electrical/schedule';
import { CUT_HEADER } from '../src/electrical/cutList';

const t = (text: string): string => new Catalogue(UKRAINIAN).translate(text);
const ENGLISH_WORD = /\b(the|is|are|its|not|but|and|which|through|joined|below|above|draws|rated|carries|fed|must|run)\b/;

const WITH_ID = [
  'MCB 1P B6 [p1]: the modules it feeds add up to 10 A on one phase, above its rating of 6 A',
  'Load 1-phase [n4]: it is fed without passing an RCD or RCBO',
  'Load 1-phase [n4]: protective earth is not connected',
  'RCD 2P [p3]: its outputs are connected but its input is not fed',
  'RCD 2P [p3]: its lines are connected but its earth terminal is not, so it protects nothing',
  'SPD [p4]: a type 2 surge protector is fed from the output of an RCD; it belongs ahead of the RCD',
  'Load 1-phase [n4]: it draws 12 A but its breaker is rated 10 A',
  'Load 1-phase [n4]: it draws 12 A but its fuse is rated 10 A',
  'Load 1-phase [n4]: a 1.5 mm2 cable carries 17.5 A, below the breaker rating of 20 A',
  'Load 1-phase [n4]: a 1.5 mm2 cable carries 17.5 A, below the load current of 20 A',
  'Load 1-phase [n4]: the voltage drop over 40 m of 1.5 mm2 is 4.1 %, above the limit of 3 %',
  'Load 1-phase [n4]: no listed cross-section carries 200 A',
  'Load 1-phase [n4]: no listed cross-section keeps the voltage drop within 3 %',
  'MCB 1P B6 [p1]: its breaking capacity of 6 kA is below the prospective short-circuit current of 10 kA',
  'Load 1-phase [n4]: a fault at the end of 80 m of 1.5 mm2 gives about 90 A, below the 100 A that trips its B20 breaker at once (an RCD upstream would disconnect it instead)',
  'Mains [n1]: ' + earthingProblem('TN-S', ['L', 'N']),
  'Mains [n1]: ' + earthingProblem('IT', ['L', 'N', 'PEN']),
  'Mains [n1]: ' + earthingProblem('TN-S', ['L', 'PEN']),
  'MCB 1P B6 [p1]: a PEN conductor must not pass through a switching device',
  'RCD 2P [p3]: it is fed through a terminal that its maker marks as an output',
  'MCB 1P B6 [p1]: it is fed from both of its sides, so something goes round it',
];

const OTHER = [
  'wire w5: a PEN conductor of 6 mm2 is below the minimum of 10 mm2 (copper)',
  ...Object.values(NET_PROBLEM_TEXT).map((text) => `${text}: Mains [n1] bottom:L, Mains [n1] bottom:N`),
  `${NET_PROBLEM_TEXT['mixed-phases']} through a closed device (Switch [p2]): Mains [n1] L1, Mains [n1] L2`,
  `${NET_PROBLEM_TEXT['mixed-phases']} through a closed device: Mains [n1] L1, Mains [n1] L2`,
  'sources that are on are joined in parallel through Switch [p2]: Mains [n1], Backup [n2]',
  'sources that are on are joined in parallel: Mains [n1], Backup [n2]',
  'wires w1 (Mains [n3] L → MCB [p1] L) and w2 (Mains [n3] L → MCB [p2] L) run on top of each other; Nodes > Separate overlapping wires moves them apart',
  'node n2: its module is on the shelf',
  'node n2: its module is not on the panel',
  'wire w3: connects a missing node or terminal',
  'placement p1: its module cannot be resized',
  'comb c1: width 3 is outside 4-12',
  'shelf item p9: width 3 is outside 4-12',
  'placement p1: overlap with p2',
  'placement p1: out-of-rail',
  'comb c1: not-a-comb',
  'duct d1 (d1) stands on MCB (p1).',
];

describe('the Ukrainian text of the findings of Check', () => {
  it.each([...WITH_ID, ...OTHER])('has no English sentence left in: %s', (message) => {
    const translated = t(message);
    expect(translated, message).not.toBe(message);
    expect(ENGLISH_WORD.test(translated), translated).toBe(false);
  });

  it('keeps the name and the id in front of a finding and translates the rest', () => {
    expect(t('MCB 1P B6 [p1]: its outputs are connected but its input is not fed')).toBe(
      'MCB 1P B6 [p1]: \u0439\u043e\u0433\u043e \u0432\u0438\u0445\u043e\u0434\u0438 \u043f\u0456\u0434\u2019\u0454\u0434\u043d\u0430\u043d\u043e, \u0430 \u0432\u0445\u0456\u0434 \u043d\u0435 \u0436\u0438\u0432\u0438\u0442\u044c\u0441\u044f',
    );
  });

  it('names the severity of a finding', () => {
    expect(t('Error')).toBe('\u041f\u043e\u043c\u0438\u043b\u043a\u0430');
    expect(t('Advice')).toBe('\u041f\u043e\u0440\u0430\u0434\u0430');
  });

  it('has every heading of the circuit list, the wire list and the cut list', () => {
    for (const heading of [...CIRCUIT_HEADER, ...WIRE_HEADER, ...CUT_HEADER, 'Qty', 'SKU', 'Rating']) expect(t(heading), heading).not.toBe(heading);
  });

  it('has the cells of the cut list and the ferrule list', () => {
    for (const cell of ['DIN rail', '35 mm', '1.5 mm2', '5 mm wide', 'not measured: an end is not on the panel', 'cross-section not known', 'not specified']) {
      expect(t(cell), cell).not.toBe(cell);
    }
  });

  it('has the module kinds, the sides and the conductors of the colour dialog', () => {
    for (const word of ['softstarter', 'vfd', 'plc', 'transformer', 'fuse', 'top', 'bottom', 'signal plus', 'signal minus', 'shield', 'bus line A', 'bus line B']) {
      expect(t(word), word).not.toBe(word);
    }
  });

  it('says both counts of the differences of a project from its libraries in Ukrainian', () => {
    expect(ENGLISH_WORD.test(t('2 differ from the libraries, 5 no longer in any library'))).toBe(false);
  });

  it('has the labels of the terminal fields of the library editor', () => {
    for (const field of ['name', 'conductor', 'side', 'net', 'role', 'position', 'copies']) expect(t(`T3 ${field}`), field).not.toBe(`T3 ${field}`);
    expect(t('Remove T3')).not.toBe('Remove T3');
  });

  it('does not take a word for a count: "one setting" in a sentence stays a sentence', () => {
    const hint = 'a sentence that has no entry and says this is one setting';
    expect(t(hint)).toBe(hint);
    expect(t('1 setting')).not.toBe('1 setting');
  });

  it('has the hint of the module designer as one text, as it is shown', () => {
    const hint =
      'Place: click the top or bottom half (the right or left half when the terminals stand down the sides) to add, click a terminal to select it, drag it to move it, Delete removes it. Click Place again to switch it off, and a click then only selects. Connect: click two terminals to join them inside the module.';
    expect(t(hint)).not.toBe(hint);
    expect(ENGLISH_WORD.test(t(hint))).toBe(false);
  });

  it('still takes a name in the place n of a phrase that has no forms of a count', () => {
    const shown = t('"other.eebox.json" compared with the project on the screen');
    expect(shown).not.toBe('"other.eebox.json" compared with the project on the screen');
    expect(ENGLISH_WORD.test(shown)).toBe(false);
    expect(t('Imported "Generic IEC modules".')).not.toBe('Imported "Generic IEC modules".');
  });
});
