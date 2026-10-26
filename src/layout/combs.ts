import type { TerminalSide } from '../library/types';
import { normalizeLabel } from './labels';
import type { CombPlacement, ModuleRef, Panel, ResizeOf, WidthOf } from './placement';

export interface CombLookup {
  widthOf: WidthOf;
  /** The side a comb lies on; undefined for an unknown module or one that is not a comb. */
  sideOf: (module: ModuleRef) => TerminalSide | undefined;
}

export type CombError =
  | { kind: 'not-a-comb' }
  | { kind: 'unknown-rail' }
  | { kind: 'out-of-rail' }
  | { kind: 'overlap'; with: string }
  | { kind: 'duplicate-id' }
  | { kind: 'unknown-comb' }
  | { kind: 'invalid-label' }
  | { kind: 'not-resizable' }
  | { kind: 'width-out-of-range' };

export type CombResult = { ok: true; panel: Panel } | { ok: false; error: CombError };

export interface CombProblem {
  combId: string;
  error: CombError;
}

/** Combs lie over modules, so they only collide with other combs on the same side of the same rail. */
function checkComb(panel: Panel, lookup: CombLookup, candidate: CombPlacement, ignoreId?: string): CombError | null {
  const side = lookup.sideOf(candidate.module);
  const width = lookup.widthOf(candidate);
  if (side === undefined || width === undefined) return { kind: 'not-a-comb' };
  const railLength = panel.railLengthsUnits[candidate.rail];
  if (railLength === undefined) return { kind: 'unknown-rail' };
  const { slot } = candidate;
  if (!Number.isInteger(slot) || slot < 0 || slot + width > railLength) return { kind: 'out-of-rail' };
  for (const other of panel.combs) {
    if (other.id === ignoreId || other.rail !== candidate.rail || lookup.sideOf(other.module) !== side) continue;
    const otherWidth = lookup.widthOf(other) ?? 0;
    if (slot < other.slot + otherWidth && other.slot < slot + width) return { kind: 'overlap', with: other.id };
  }
  return null;
}

export function addComb(panel: Panel, lookup: CombLookup, comb: CombPlacement): CombResult {
  if (panel.combs.some((c) => c.id === comb.id)) return { ok: false, error: { kind: 'duplicate-id' } };
  const error = checkComb(panel, lookup, comb);
  if (error) return { ok: false, error };
  return { ok: true, panel: { ...panel, combs: [...panel.combs, comb] } };
}

export function moveComb(panel: Panel, lookup: CombLookup, id: string, rail: number, slot: number): CombResult {
  const current = panel.combs.find((c) => c.id === id);
  if (!current) return { ok: false, error: { kind: 'unknown-comb' } };
  const moved = { ...current, rail, slot };
  const error = checkComb(panel, lookup, moved, id);
  if (error) return { ok: false, error };
  return { ok: true, panel: { ...panel, combs: panel.combs.map((c) => (c.id === id ? moved : c)) } };
}

export function setCombWidth(
  panel: Panel,
  lookup: CombLookup,
  resizeOf: ResizeOf,
  id: string,
  units: number,
): CombResult {
  const current = panel.combs.find((c) => c.id === id);
  if (!current) return { ok: false, error: { kind: 'unknown-comb' } };
  const allowed = resizeOf(current.module);
  if (!allowed) return { ok: false, error: { kind: 'not-resizable' } };
  if (!Number.isInteger(units) || units < allowed.minUnits || units > allowed.maxUnits) {
    return { ok: false, error: { kind: 'width-out-of-range' } };
  }
  const { widthUnits: _previous, ...rest } = current;
  const next: CombPlacement = units === allowed.baseUnits ? rest : { ...rest, widthUnits: units };
  const error = checkComb(panel, lookup, next, id);
  if (error) return { ok: false, error };
  return { ok: true, panel: { ...panel, combs: panel.combs.map((c) => (c.id === id ? next : c)) } };
}

export function setCombLabel(panel: Panel, id: string, text: string): CombResult {
  const parsed = normalizeLabel(text);
  if (!parsed.ok) return { ok: false, error: { kind: 'invalid-label' } };
  if (!panel.combs.some((c) => c.id === id)) return { ok: false, error: { kind: 'unknown-comb' } };
  const combs = panel.combs.map((c) => {
    if (c.id !== id) return c;
    const { label: _previous, ...rest } = c;
    return parsed.label === undefined ? rest : { ...rest, label: parsed.label };
  });
  return { ok: true, panel: { ...panel, combs } };
}

export function removeComb(panel: Panel, id: string): CombResult {
  if (!panel.combs.some((c) => c.id === id)) return { ok: false, error: { kind: 'unknown-comb' } };
  return { ok: true, panel: { ...panel, combs: panel.combs.filter((c) => c.id !== id) } };
}

export function findCombProblems(panel: Panel, lookup: CombLookup): CombProblem[] {
  const problems: CombProblem[] = [];
  panel.combs.forEach((comb, index) => {
    const earlier: Panel = { ...panel, combs: panel.combs.slice(0, index) };
    const error = checkComb(earlier, lookup, comb);
    if (error) problems.push({ combId: comb.id, error });
  });
  return problems;
}

export function nextCombId(panel: Panel): string {
  const used = panel.combs.map((c) => /^c(\d+)$/.exec(c.id)).map((m) => (m ? Number(m[1]) : 0));
  return `c${Math.max(0, ...used) + 1}`;
}
