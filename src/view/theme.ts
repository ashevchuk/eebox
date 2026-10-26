import type { Conductor } from '../library/types';
import { CONDUCTOR_COLORS } from './colors';

/** The colours that depend on the background; everything else reads the same on light and dark. */
export interface Theme {
  background: string;
  frame: string;
  frameFill: string;
  label: string;
  rowLabel: string;
  wireLabelBackground: string;
  wireLabelText: string;
  conductors: Record<Conductor, string>;
}

export const DARK_THEME: Theme = {
  background: '#0b0c10',
  frame: '#2a2f3b',
  frameFill: '#14161d',
  label: '#e5e7eb',
  rowLabel: '#9aa1b3',
  wireLabelBackground: 'rgba(11, 12, 16, 0.85)',
  wireLabelText: '#e5e7eb',
  conductors: CONDUCTOR_COLORS,
};

/** For paper: white ground, dark text, and phase colours that stay visible on white. */
export const LIGHT_THEME: Theme = {
  background: '#ffffff',
  frame: '#6b7280',
  frameFill: '#f3f4f6',
  label: '#111827',
  rowLabel: '#4b5563',
  wireLabelBackground: 'rgba(255, 255, 255, 0.9)',
  wireLabelText: '#111827',
  conductors: { L: '#b45309', L1: '#78350f', L2: '#111827', L3: '#6b7280', N: '#2563eb', PE: '#16a34a', C: '#7c3aed', DCP: '#dc2626', DCN: '#0891b2' },
};

let active: Theme = DARK_THEME;

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
