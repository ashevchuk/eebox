import { describe, expect, it } from 'vitest';
import { DEFAULT_CABLE_SETTINGS, cableSettingsToText, parseCableSettings } from '../src/electrical/cables';
import { ampacityId, changedIds, checkDraft, draftOf, numberOf, scalarId, tripId } from '../src/ui/cableSettingsEditor';

const edited = (change: (draft: ReturnType<typeof draftOf>) => void) => {
  const draft = draftOf(DEFAULT_CABLE_SETTINGS);
  change(draft);
  return draft;
};

describe('draftOf and checkDraft', () => {
  it('turn the built-in settings into a form and back into the same settings', () => {
    const check = checkDraft(draftOf(DEFAULT_CABLE_SETTINGS));
    expect(check).toEqual({ settings: DEFAULT_CABLE_SETTINGS, problems: [] });
  });

  it('give what the file parser would give for the same values', () => {
    const draft = edited((d) => {
      d.scalars.other = '4';
      d.trip.C = '8';
      d.ampacity.C[2][0] = '20';
    });
    const check = checkDraft(draft);
    expect(check.settings && parseCableSettings(cableSettingsToText(check.settings)).ok).toBe(true);
    expect(check.settings?.voltageDropLimitPercent.other).toBe(4);
    expect(check.settings?.tripMultiples.C).toBe(8);
    expect(check.settings?.ampacity.C[2][0]).toBe(20);
  });
});

describe('numberOf', () => {
  it('takes a decimal comma and refuses blank text and words', () => {
    expect(numberOf('0,0225')).toBe(0.0225);
    expect(numberOf(' 17.5 ')).toBe(17.5);
    expect(Number.isNaN(numberOf(''))).toBe(true);
    expect(Number.isNaN(numberOf('abc'))).toBe(true);
  });
});

describe('problems are pinned to the cell or field that has them', () => {
  it('a cell that is not a number, or is blank', () => {
    const check = checkDraft(edited((d) => (d.ampacity.B1[3][4] = 'x')));
    expect(check.settings).toBeNull();
    expect(check.problems).toEqual([{ id: ampacityId('B1', 3, 4), message: 'must be a number above 0' }]);
    expect(checkDraft(edited((d) => (d.ampacity.E[2][0] = ''))).problems[0]?.id).toBe(ampacityId('E', 2, 0));
  });

  it('a cell that is not larger than the one to its left', () => {
    const check = checkDraft(edited((d) => (d.ampacity.C[2][3] = '10')));
    expect(check.problems).toEqual([{ id: ampacityId('C', 2, 3), message: 'must be larger than the cell to its left' }]);
  });

  it('a limit, a conductor value, the fault voltage and a trip multiple out of range', () => {
    const check = checkDraft(
      edited((d) => {
        d.scalars.lighting = '0';
        d.scalars.resistivity = '-1';
        d.scalars.faultVoltage = '5000';
        d.trip.D = '0';
      }),
    );
    expect(check.problems.map((p) => p.id).sort()).toEqual([scalarId('faultVoltage'), scalarId('lighting'), scalarId('resistivity'), tripId('D')].sort());
  });

  it('accepts a zero reactance', () => {
    expect(checkDraft(edited((d) => (d.scalars.reactance = '0'))).settings?.reactanceOhmPerM).toBe(0);
  });
});

describe('changedIds', () => {
  it('is empty for the built-in values and lists only what was edited', () => {
    expect(changedIds(draftOf(DEFAULT_CABLE_SETTINGS), DEFAULT_CABLE_SETTINGS).size).toBe(0);
    const draft = edited((d) => {
      d.ampacity.B2[3][7] = '100';
      d.trip.K = '12';
    });
    expect([...changedIds(draft, DEFAULT_CABLE_SETTINGS)].sort()).toEqual([ampacityId('B2', 3, 7), tripId('K')].sort());
  });

  it('does not count 10.0 as a change from 10', () => {
    expect(changedIds(edited((d) => (d.trip.C = '10.0')), DEFAULT_CABLE_SETTINGS).size).toBe(0);
  });
});
