import type { Finding } from '../electrical/problems';

export type CheckLevel = 'clear' | 'advice' | 'error';

/** What Check found, as much as the button of it shows. */
export interface CheckState {
  level: CheckLevel;
  errors: number;
  advice: number;
  total: number;
}

export function checkState(findings: readonly Finding[]): CheckState {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const advice = findings.length - errors;
  return { level: errors > 0 ? 'error' : advice > 0 ? 'advice' : 'clear', errors, advice, total: findings.length };
}

/** The button draws the eye only when something new was found; the first look, at a project just opened, is no news. */
export function shouldPulse(previous: CheckState | null, next: CheckState): boolean {
  return previous !== null && (next.errors > previous.errors || next.advice > previous.advice);
}
