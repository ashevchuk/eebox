import boldUrl from '../assets/fonts/NotoSans-Bold.woff?inline';
import regularUrl from '../assets/fonts/NotoSans-Regular.woff?inline';
import { FONT_NAME } from './font';

const FACES = [
  { weight: '400', url: regularUrl },
  { weight: '700', url: boldUrl },
] as const;

/**
 * Makes the bundled font available to the page, so canvas text is drawn and measured with it. The
 * result says what went wrong; the drawings then fall back to the system font.
 */
export async function loadFonts(): Promise<string | undefined> {
  try {
    const faces = FACES.map(({ weight, url }) => new FontFace(FONT_NAME, `url(${url})`, { weight }));
    await Promise.all(faces.map((face) => face.load()));
    for (const face of faces) document.fonts.add(face);
    return undefined;
  } catch (error) {
    return `the bundled font could not be loaded: ${(error as Error).message}`;
  }
}

/** The font as `@font-face` rules, for an SVG that is saved as a file and must not depend on the font being installed. */
export const fontFaceCss = (): string =>
  FACES.map(({ weight, url }) => `@font-face{font-family:'${FONT_NAME}';font-weight:${weight};src:url(${url}) format('woff');}`).join('');

/** Puts the font into a drawing made by `SvgContext`. */
export function embedFont(svg: string): string {
  return svg.replace('<defs>', `<defs><style>${fontFaceCss()}</style>`);
}
