import { describe, expect, it } from 'vitest';
import {
  ampacityA,
  cableSettingsToText,
  CROSS_SECTIONS_MM2,
  DEFAULT_CABLE_SETTINGS,
  INSTALL_METHODS,
  minimumSectionMm2,
  parseCableSettings,
} from '../src/electrical/cables';

describe('cable table', () => {
  it('has a value for every method, loading and cross-section', () => {
    for (const method of INSTALL_METHODS) {
      for (const loaded of [2, 3] as const) {
        for (const section of CROSS_SECTIONS_MM2) expect(ampacityA(method, loaded, section)).toBeGreaterThan(0);
      }
    }
  });

  it('grows with the cross-section', () => {
    for (const method of INSTALL_METHODS) {
      for (const loaded of [2, 3] as const) {
        const values = CROSS_SECTIONS_MM2.map((s) => ampacityA(method, loaded, s)!);
        expect(values).toEqual([...values].sort((a, b) => a - b));
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });

  it('never allows more with three loaded conductors than with two', () => {
    for (const method of INSTALL_METHODS) {
      for (const section of CROSS_SECTIONS_MM2) {
        expect(ampacityA(method, 3, section)!).toBeLessThan(ampacityA(method, 2, section)!);
      }
    }
  });

  it('agrees with the two values of method C, three loaded conductors, that a second source gave', () => {
    expect(ampacityA('C', 3, 1.5)).toBe(17.5);
    expect(ampacityA('C', 3, 2.5)).toBe(24);
  });

  it('knows nothing about a cross-section that is not listed', () => {
    expect(ampacityA('C', 2, 3)).toBeUndefined();
  });
});

describe('minimumSectionMm2', () => {
  it('picks the smallest section that carries the current, edge included', () => {
    expect(minimumSectionMm2('C', 2, 19.5)).toBe(1.5);
    expect(minimumSectionMm2('C', 2, 19.6)).toBe(2.5);
    expect(minimumSectionMm2('C', 3, 17.6)).toBe(2.5);
  });

  it('needs more with a worse laying method', () => {
    expect(minimumSectionMm2('B2', 2, 20)).toBeGreaterThan(minimumSectionMm2('E', 2, 20)!);
  });

  it('gives nothing when even the largest section is too small', () => {
    expect(minimumSectionMm2('C', 2, 500)).toBeUndefined();
  });
});

describe('cable settings', () => {
  it('print and parse back to the same values', () => {
    const parsed = parseCableSettings(cableSettingsToText(DEFAULT_CABLE_SETTINGS));
    expect(parsed).toEqual({ ok: true, settings: DEFAULT_CABLE_SETTINGS });
  });

  it('keep each row of amperes on one line when printed', () => {
    const lines = cableSettingsToText(DEFAULT_CABLE_SETTINGS).split('\n');
    expect(lines.filter((l) => l.includes('17.5, 24, 32')).length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThan(40);
  });

  const edit = (change: (s: Record<string, any>) => void) => {
    const settings = JSON.parse(cableSettingsToText(DEFAULT_CABLE_SETTINGS));
    change(settings);
    return parseCableSettings(JSON.stringify(settings));
  };
  const paths = (result: ReturnType<typeof parseCableSettings>) => (result.ok ? [] : result.errors.map((e) => e.path));

  it('refuse a row with the wrong number of values, values that do not grow, and non-numbers', () => {
    expect(paths(edit((s) => (s.ampacity.C[2] = [19.5, 27])))).toEqual(['ampacity.C.2']);
    expect(paths(edit((s) => (s.ampacity.C[3][2] = 1)))).toEqual(['ampacity.C.3']);
    expect(paths(edit((s) => (s.ampacity.B1[2][0] = 'x')))).toEqual(['ampacity.B1.2']);
  });

  it('refuse a missing method, an unknown field and values out of range', () => {
    expect(paths(edit((s) => delete s.ampacity.E))).toEqual(['ampacity.E']);
    expect(paths(edit((s) => (s.surprise = 1)))).toEqual(['surprise']);
    expect(paths(edit((s) => (s.voltageDropLimitPercent.other = 0)))).toEqual(['voltageDropLimitPercent.other']);
    expect(paths(edit((s) => (s.resistivityOhmMm2PerM = -1)))).toEqual(['resistivityOhmMm2PerM']);
    expect(paths(edit((s) => (s.reactanceOhmPerM = -0.1)))).toEqual(['reactanceOhmPerM']);
  });

  it('accept zero reactance and report text that is not JSON', () => {
    expect(edit((s) => (s.reactanceOhmPerM = 0)).ok).toBe(true);
    expect(parseCableSettings('{')).toMatchObject({ ok: false });
    expect(parseCableSettings('[]')).toEqual({ ok: false, errors: [{ path: '', message: 'must be an object' }] });
  });

  it('change what the lookups return', () => {
    const custom = JSON.parse(cableSettingsToText(DEFAULT_CABLE_SETTINGS));
    custom.ampacity.C[2][0] = 20;
    const result = parseCableSettings(JSON.stringify(custom));
    if (!result.ok) throw new Error('setup');
    expect(ampacityA('C', 2, 1.5, result.settings)).toBe(20);
    expect(minimumSectionMm2('C', 2, 20, result.settings)).toBe(1.5);
    expect(minimumSectionMm2('C', 2, 20)).toBe(2.5);
  });

  it('let a caller exclude cross-sections, as the voltage drop does', () => {
    expect(minimumSectionMm2('C', 2, 10, DEFAULT_CABLE_SETTINGS, (s) => s >= 4)).toBe(4);
  });
});
