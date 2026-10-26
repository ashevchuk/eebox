import { CONDUCTORS, type Conductor } from '../library/types';

/** The colour of a conductor as its insulation is: one colour, or a base colour with a stripe. */
export interface ConductorColour {
  color: string;
  stripe?: string;
}

export type ColourScheme = Record<Conductor, ConductorColour>;
export type Ground = 'dark' | 'light';

const BASE: Pick<ColourScheme, 'L' | 'C' | 'DCP' | 'DCN'> = {
  L: { color: '#d97706' },
  C: { color: '#a78bfa' },
  DCP: { color: '#ef4444' },
  DCN: { color: '#22d3ee' },
};
const GREEN_YELLOW: ConductorColour = { color: '#2f9e44', stripe: '#f2d21b' };

/** Harmonised colours of the European Union: brown, black and grey phases, blue neutral. */
export const EU_SCHEME: ColourScheme = {
  ...BASE,
  L1: { color: '#a0642a' },
  L2: { color: '#111111' },
  L3: { color: '#8b9099' },
  N: { color: '#2f7de1' },
  PE: GREEN_YELLOW,
};

/** The older Ukrainian and Soviet marking of the phases A, B and C: yellow, green and red. */
export const PUE_SCHEME: ColourScheme = {
  ...BASE,
  L1: { color: '#ffd700' },
  L2: { color: '#008000' },
  L3: { color: '#ff0000' },
  N: { color: '#0057ff' },
  PE: GREEN_YELLOW,
};

/** Hues chosen to be told apart on a screen, not to follow a standard. */
export const CONTRAST_SCHEME: ColourScheme = {
  L: { color: '#f97316' },
  L1: { color: '#ef4444' },
  L2: { color: '#facc15' },
  L3: { color: '#8b5cf6' },
  N: { color: '#3b82f6' },
  PE: { color: '#22c55e', stripe: '#facc15' },
  C: { color: '#94a3b8' },
  DCP: { color: '#ec4899' },
  DCN: { color: '#22d3ee' },
};

export type SchemeId = 'eu' | 'pue' | 'contrast' | 'custom';

export const BUILT_IN_SCHEMES: ReadonlyArray<{ id: Exclude<SchemeId, 'custom'>; name: string; colours: ColourScheme }> = [
  { id: 'eu', name: 'EU (L1 brown, L2 black, L3 grey)', colours: EU_SCHEME },
  { id: 'pue', name: 'PUE (A yellow, B green, C red)', colours: PUE_SCHEME },
  { id: 'contrast', name: 'High contrast on a screen', colours: CONTRAST_SCHEME },
];

const GROUND_COLOUR: Record<Ground, string> = { dark: '#0b0c10', light: '#ffffff' };
const OUTLINE: Record<Ground, string> = { dark: '#d1d5db', light: '#374151' };
/** WCAG contrast below which a line on the ground is hard to see. */
const MIN_CONTRAST = 3;

const channel = (hex: string, from: number) => {
  const v = parseInt(hex.slice(from, from + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export interface ConductorStyle extends ConductorColour {
  /** Drawn around a line or a dot that would not stand out from the ground by itself, such as black on a dark screen. */
  outline?: string;
}

/** How to draw a conductor on a ground: its colours, and an outline when one of them would be lost on it. */
export function styleOf(scheme: ColourScheme, conductor: Conductor, ground: Ground): ConductorStyle {
  const { color, stripe } = scheme[conductor];
  const lost = [color, ...(stripe ? [stripe] : [])].some((c) => contrastRatio(c, GROUND_COLOUR[ground]) < MIN_CONTRAST);
  return { color, ...(stripe ? { stripe } : {}), ...(lost ? { outline: OUTLINE[ground] } : {}) };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const COLOURS_FORMAT = 'eebox-colours';

export interface SchemeError {
  path: string;
  message: string;
}

/** Reads a scheme from text, strictly: every conductor, colours as #rrggbb, nothing else. */
export function parseColourScheme(text: string): { ok: true; scheme: ColourScheme } | { ok: false; errors: SchemeError[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `invalid JSON: ${(e as Error).message}` }] };
  }
  const errors: SchemeError[] = [];
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(raw)) return { ok: false, errors: [{ path: '', message: 'must be an object' }] };
  for (const key of Object.keys(raw)) if (!['format', 'version', 'colours'].includes(key)) errors.push({ path: key, message: 'unknown field' });
  if (raw.format !== COLOURS_FORMAT) errors.push({ path: 'format', message: `must be "${COLOURS_FORMAT}"` });
  if (raw.version !== 1) errors.push({ path: 'version', message: 'unsupported version, this build reads 1' });
  const colours = raw.colours;
  if (!isObject(colours)) {
    errors.push({ path: 'colours', message: 'must be an object with a colour for each conductor' });
    return { ok: false, errors };
  }
  for (const key of Object.keys(colours)) if (!(CONDUCTORS as readonly string[]).includes(key)) errors.push({ path: `colours.${key}`, message: 'unknown conductor' });
  const scheme: Partial<ColourScheme> = {};
  for (const conductor of CONDUCTORS) {
    const entry = colours[conductor];
    if (!isObject(entry)) {
      errors.push({ path: `colours.${conductor}`, message: 'is required' });
      continue;
    }
    for (const key of Object.keys(entry)) if (key !== 'color' && key !== 'stripe') errors.push({ path: `colours.${conductor}.${key}`, message: 'unknown field' });
    const colour = entry.color;
    const stripe = entry.stripe;
    if (typeof colour !== 'string' || !HEX.test(colour)) errors.push({ path: `colours.${conductor}.color`, message: 'must be a colour like #a0642a' });
    if (stripe !== undefined && (typeof stripe !== 'string' || !HEX.test(stripe))) errors.push({ path: `colours.${conductor}.stripe`, message: 'must be a colour like #f2d21b' });
    if (typeof colour === 'string' && HEX.test(colour)) {
      scheme[conductor] = { color: colour.toLowerCase(), ...(typeof stripe === 'string' && HEX.test(stripe) ? { stripe: stripe.toLowerCase() } : {}) };
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scheme: scheme as ColourScheme };
}

export function colourSchemeToText(scheme: ColourScheme): string {
  return `${JSON.stringify({ format: COLOURS_FORMAT, version: 1, colours: scheme }, null, 2)}\n`;
}

/** What the person chose: one of the built-in schemes, or their own, which is kept even while a built-in one is in use. */
export interface ColourChoice {
  scheme: SchemeId;
  custom: ColourScheme;
}

export const DEFAULT_COLOUR_CHOICE: ColourChoice = { scheme: 'pue', custom: PUE_SCHEME };

export function coloursOf(choice: ColourChoice): ColourScheme {
  return choice.scheme === 'custom' ? choice.custom : BUILT_IN_SCHEMES.find((s) => s.id === choice.scheme)!.colours;
}
