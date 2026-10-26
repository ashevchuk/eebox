import type { Conductor } from '../library/types';

/** IEC wire colours, adjusted to stay readable on the dark canvas. */
export const CONDUCTOR_COLORS: Record<Conductor, string> = {
  L: '#d97706',
  L1: '#a16207',
  L2: '#6b7280',
  L3: '#d1d5db',
  N: '#3b82f6',
  PE: '#84cc16',
  C: '#a78bfa',
  DCP: '#ef4444',
  DCN: '#22d3ee',
};
