import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Native alert, confirm and prompt block the whole page; every dialog in the app must be HTML. */
describe('native dialogs', () => {
  it('scans the source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });

  it('are not used anywhere in the application code', () => {
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      text
        .split('\n')
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter(({ text: line }) => /(^|[^\w.])(window\.)?(alert|confirm|prompt)\s*\(/.test(line)),
    );
    expect(offenders).toEqual([]);
  });

  it('would catch the usual spellings', () => {
    const pattern = /(^|[^\w.])(window\.)?(alert|confirm|prompt)\s*\(/;
    expect(pattern.test("if (confirm('x')) {}")).toBe(true);
    expect(pattern.test("window.alert('x')")).toBe(true);
    expect(pattern.test("  prompt ('x')")).toBe(true);
    expect(pattern.test("confirmDialog('x')")).toBe(false);
    expect(pattern.test('await confirmDiscard()')).toBe(false);
    expect(pattern.test('dialog.confirm.focus()')).toBe(false);
  });
});
