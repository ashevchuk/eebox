import { describe, expect, it } from 'vitest';
import { FONT_FAMILY, FONT_NAME } from '../src/view/font';
import { embedFont, fontFaceCss } from '../src/view/fontLoader';

const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('the bundled font', () => {
  it('is named first in the family list, with the system font behind it for what it lacks', () => {
    expect(FONT_FAMILY).toBe(`'${FONT_NAME}', sans-serif`);
  });

  it('is written as two @font-face rules with the font inside, for a saved SVG', () => {
    const css = fontFaceCss();
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('font-weight:400');
    expect(css).toContain('font-weight:700');
    expect(css.match(/src:url\([^)]+\) format\('woff'\)/g)).toHaveLength(2);
  });

  it('is put into the definitions of a drawing, once', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs></defs><g/></svg>';
    const embedded = embedFont(svg);
    expect(embedded).toMatch(/<defs><style>@font-face\{font-family:'eebox-sans'/);
    expect(embedded.match(/<style>/g)).toHaveLength(1);
    expect(embedded).toContain('</style></defs><g/></svg>');
  });

  it('is what every canvas font in the application names, not the system font', () => {
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      text
        .split('\n')
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter(({ file: f, text: line }) => /\.font = .*sans-serif/.test(line) && !f.endsWith('svgContext.ts')),
    );
    expect(offenders).toEqual([]);
  });
});
