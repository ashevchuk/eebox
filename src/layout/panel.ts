import {
  DEFAULT_RAIL_LENGTH_UNITS,
  DEFAULT_RAIL_PITCH_MM,
  FIRST_RAIL_Y_MM,
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_POSITION_MM,
} from './limits';
import { normalizeLabel } from './labels';
import type { Panel, WidthOf } from './placement';
import type { Rail } from './rail';
import { LAYOUT_EPSILON_UNITS } from './units';

export type PanelEditError = 'invalid-value' | 'unknown-rail' | 'rail-not-empty' | 'modules-do-not-fit';

export type PanelEditResult = { ok: true; panel: Panel } | { ok: false; error: PanelEditError };

const failure = (error: PanelEditError): PanelEditResult => ({ ok: false, error });
const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Rails of the given lengths, one under the other, `pitchMm` apart. */
export function createPanel(railLengthsUnits: number[], pitchMm = DEFAULT_RAIL_PITCH_MM): Panel {
  return {
    rails: railLengthsUnits.map((lengthUnits, i) => ({ x: 0, y: FIRST_RAIL_Y_MM + i * pitchMm, lengthUnits })),
    placements: [],
    combs: [],
    shelf: [],
  };
}

/** New rows copy the last row's length and the distance between the last two rows. Rows can only be removed while empty. */
export function setRailCount(panel: Panel, count: number): PanelEditResult {
  if (!inRange(count, 1, MAX_RAILS)) return failure('invalid-value');
  if (panel.placements.some((p) => p.rail >= count) || panel.combs.some((c) => c.rail >= count)) {
    return failure('rail-not-empty');
  }
  const rails = panel.rails.slice(0, count);
  const last = rails[rails.length - 1];
  const before = rails[rails.length - 2];
  const gap = last && before && last.y > before.y ? last.y - before.y : DEFAULT_RAIL_PITCH_MM;
  while (rails.length < count) {
    const above = rails[rails.length - 1];
    rails.push(
      above
        ? { x: above.x, y: Math.min(above.y + gap, MAX_RAIL_POSITION_MM), lengthUnits: above.lengthUnits }
        : { x: 0, y: FIRST_RAIL_Y_MM, lengthUnits: DEFAULT_RAIL_LENGTH_UNITS },
    );
  }
  return { ok: true, panel: { ...panel, rails } };
}

export function setRailLength(panel: Panel, widthOf: WidthOf, rail: number, units: number): PanelEditResult {
  if (!inRange(rail, 0, panel.rails.length - 1)) return failure('unknown-rail');
  if (!Number.isFinite(units) || units < 1 || units > MAX_RAIL_LENGTH_UNITS) return failure('invalid-value');
  const overflows = [...panel.placements, ...panel.combs].some(
    (p) => p.rail === rail && p.slot + (widthOf(p) ?? 1) > units + LAYOUT_EPSILON_UNITS,
  );
  if (overflows) return failure('modules-do-not-fit');
  return { ok: true, panel: { ...panel, rails: panel.rails.map((r, i) => (i === rail ? { ...r, lengthUnits: units } : r)) } };
}

/** Puts the left end of a rail at `x` and its centre line at `y`, in mm; the modules on it go along. */
export function setRailPosition(panel: Panel, rail: number, x: number, y: number): PanelEditResult {
  if (!inRange(rail, 0, panel.rails.length - 1)) return failure('unknown-rail');
  const valid = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_RAIL_POSITION_MM;
  if (!valid(x) || !valid(y)) return failure('invalid-value');
  return { ok: true, panel: { ...panel, rails: panel.rails.map((r, i) => (i === rail ? { ...r, x, y } : r)) } };
}

/**
 * Moves a row with its modules to another position in the order. The places stay where they are:
 * the rails trade their lengths and labels, not their x and y.
 */
export function moveRail(panel: Panel, from: number, to: number): PanelEditResult {
  const last = panel.rails.length - 1;
  if (!inRange(from, 0, last) || !inRange(to, 0, last)) return failure('unknown-rail');
  const order = [...panel.rails];
  order.splice(to, 0, ...order.splice(from, 1));
  const rails: Rail[] = order.map((r, i) => ({ ...r, x: panel.rails[i]!.x, y: panel.rails[i]!.y }));
  const newIndex = (rail: number) => {
    if (rail === from) return to;
    if (from < to && rail > from && rail <= to) return rail - 1;
    if (from > to && rail >= to && rail < from) return rail + 1;
    return rail;
  };
  const placements = panel.placements.map((p) => ({ ...p, rail: newIndex(p.rail) }));
  const combs = panel.combs.map((c) => ({ ...c, rail: newIndex(c.rail) }));
  return { ok: true, panel: { ...panel, rails, placements, combs } };
}

export function setPanelTitle(panel: Panel, text: string): PanelEditResult {
  const parsed = normalizeLabel(text);
  if (!parsed.ok) return failure('invalid-value');
  const { title: _previous, ...rest } = panel;
  return { ok: true, panel: parsed.label === undefined ? rest : { ...rest, title: parsed.label } };
}

export function setRailLabel(panel: Panel, rail: number, text: string): PanelEditResult {
  if (!inRange(rail, 0, panel.rails.length - 1)) return failure('unknown-rail');
  const parsed = normalizeLabel(text);
  if (!parsed.ok) return failure('invalid-value');
  const rails = panel.rails.map((r, i) => {
    if (i !== rail) return r;
    const { label: _previous, ...rest } = r;
    return parsed.label === undefined ? rest : { ...rest, label: parsed.label };
  });
  return { ok: true, panel: { ...panel, rails } };
}
