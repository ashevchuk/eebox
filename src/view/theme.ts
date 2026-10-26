import type { Conductor } from '../library/types';
import { EU_SCHEME, styleOf, type ColourScheme, type ConductorStyle, type Ground } from './colourScheme';

/** The colours that depend on the background; everything else reads the same on light and dark. */
export interface Theme {
  background: string;
  frame: string;
  frameFill: string;
  label: string;
  rowLabel: string;
  wireLabelBackground: string;
  wireLabelText: string;
  /** Whether the ground is dark or light, which decides when a conductor colour needs an outline. */
  ground: Ground;
}

export const DARK_THEME: Theme = {
  background: '#0b0c10',
  frame: '#2a2f3b',
  frameFill: '#14161d',
  label: '#e5e7eb',
  rowLabel: '#9aa1b3',
  wireLabelBackground: 'rgba(11, 12, 16, 0.85)',
  wireLabelText: '#e5e7eb',
  ground: 'dark',
};

/** For paper: white ground and dark text. */
export const LIGHT_THEME: Theme = {
  background: '#ffffff',
  frame: '#6b7280',
  frameFill: '#f3f4f6',
  label: '#111827',
  rowLabel: '#4b5563',
  wireLabelBackground: 'rgba(255, 255, 255, 0.9)',
  wireLabelText: '#111827',
  ground: 'light',
};

let active: Theme = DARK_THEME;
let scheme: ColourScheme = EU_SCHEME;

/** The colours conductors are drawn in; the same on the screen, in an export and in print. */
export function setColourScheme(next: ColourScheme): void {
  scheme = next;
}

export const colourScheme = (): ColourScheme => scheme;

/** How to draw a conductor on the ground of the theme in use. */
export const conductorStyle = (conductor: Conductor): ConductorStyle => styleOf(scheme, conductor, active.ground);

export const theme = (): Theme => active;

/** Draws with another theme for the duration of `run`, which must not be asynchronous. */
export function withTheme<T>(next: Theme, run: () => T): T {
  const previous = active;
  active = next;
  try {
    return run();
  } finally {
    active = previous;
  }
}
