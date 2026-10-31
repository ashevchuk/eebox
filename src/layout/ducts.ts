import { normalizeLabel } from './labels';
import { MAX_DUCTS, MAX_DUCT_SIZE_MM, MAX_RAIL_POSITION_MM, MIN_DUCT_SIZE_MM } from './limits';
import type { Panel } from './placement';

/** A cable duct: a rectangle on the mounting plate that nothing else should stand on. */
export interface Duct {
  id: string;
  /** The plate the duct is fixed to. */
  plate: string;
  /** Left edge, in mm from the left edge of the working area. */
  x: number;
  /** Top edge, in mm from the top of the working area. */
  y: number;
  widthMm: number;
  heightMm: number;
  label?: string;
}

export type DuctError = 'unknown-duct' | 'invalid-value' | 'duplicate-id' | 'too-many';
export type DuctResult = { ok: true; panel: Panel } | { ok: false; error: DuctError };

export const ductsOf = (panel: Panel): readonly Duct[] => panel.ducts ?? [];

const validPosition = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_RAIL_POSITION_MM;
const validSize = (v: number) => Number.isFinite(v) && v >= MIN_DUCT_SIZE_MM && v <= MAX_DUCT_SIZE_MM;

/** Why a stored duct is not one, or null; the project file uses the same rule. */
export function ductProblem(duct: Duct): string | null {
  if (!validPosition(duct.x) || !validPosition(duct.y)) return `the position must be 0 to ${MAX_RAIL_POSITION_MM} mm`;
  if (!validSize(duct.widthMm) || !validSize(duct.heightMm)) return `the size must be ${MIN_DUCT_SIZE_MM} to ${MAX_DUCT_SIZE_MM} mm`;
  return null;
}

/** The panel with its ducts replaced; an empty list is not kept, as with the notes. */
function withDucts(panel: Panel, ducts: Duct[]): Panel {
  const { ducts: _previous, ...rest } = panel;
  return ducts.length === 0 ? rest : { ...rest, ducts };
}

export function nextDuctId(panel: Panel): string {
  const used = ductsOf(panel).map((d) => /^d(\d+)$/.exec(d.id)).map((m) => (m ? Number(m[1]) : 0));
  return `d${Math.max(0, ...used) + 1}`;
}

export function addDuct(panel: Panel, duct: Duct): DuctResult {
  if (ductsOf(panel).some((d) => d.id === duct.id)) return { ok: false, error: 'duplicate-id' };
  if (ductsOf(panel).length >= MAX_DUCTS) return { ok: false, error: 'too-many' };
  if (ductProblem(duct)) return { ok: false, error: 'invalid-value' };
  return { ok: true, panel: withDucts(panel, [...ductsOf(panel), duct]) };
}

/** Changes the place or the size of a duct; what is not given stays. */
export function changeDuct(panel: Panel, id: string, change: Partial<Pick<Duct, 'x' | 'y' | 'widthMm' | 'heightMm'>>): DuctResult {
  const current = ductsOf(panel).find((d) => d.id === id);
  if (!current) return { ok: false, error: 'unknown-duct' };
  const next = { ...current, ...change };
  if (ductProblem(next)) return { ok: false, error: 'invalid-value' };
  return { ok: true, panel: withDucts(panel, ductsOf(panel).map((d) => (d.id === id ? next : d))) };
}

export function setDuctLabel(panel: Panel, id: string, text: string): DuctResult {
  const current = ductsOf(panel).find((d) => d.id === id);
  if (!current) return { ok: false, error: 'unknown-duct' };
  const parsed = normalizeLabel(text);
  if (!parsed.ok) return { ok: false, error: 'invalid-value' };
  const { label: _previous, ...rest } = current;
  const next: Duct = parsed.label === undefined ? rest : { ...rest, label: parsed.label };
  return { ok: true, panel: withDucts(panel, ductsOf(panel).map((d) => (d.id === id ? next : d))) };
}

export function removeDuct(panel: Panel, id: string): DuctResult {
  if (!ductsOf(panel).some((d) => d.id === id)) return { ok: false, error: 'unknown-duct' };
  return { ok: true, panel: withDucts(panel, ductsOf(panel).filter((d) => d.id !== id)) };
}
