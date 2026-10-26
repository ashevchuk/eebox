import {
  DEFAULT_RAIL_LENGTH_UNITS,
  DEFAULT_RAIL_PITCH_MM,
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_PITCH_MM,
  MIN_RAIL_PITCH_MM,
} from './limits';
import type { Panel, WidthOf } from './placement';

export type PanelEditError = 'invalid-value' | 'unknown-rail' | 'rail-not-empty' | 'modules-do-not-fit';

export type PanelEditResult = { ok: true; panel: Panel } | { ok: false; error: PanelEditError };

const failure = (error: PanelEditError): PanelEditResult => ({ ok: false, error });
const inRange = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

export function createPanel(railLengthsUnits: number[], pitchMm = DEFAULT_RAIL_PITCH_MM): Panel {
  return {
    railLengthsUnits: [...railLengthsUnits],
    railPitchesMm: railLengthsUnits.slice(1).map(() => pitchMm),
    placements: [],
  };
}

/** New rows copy the last row's length and spacing. Rows can only be removed while empty. */
export function setRailCount(panel: Panel, count: number): PanelEditResult {
  if (!inRange(count, 1, MAX_RAILS)) return failure('invalid-value');
  if (panel.placements.some((p) => p.rail >= count)) return failure('rail-not-empty');
  const lengths = panel.railLengthsUnits.slice(0, count);
  const pitches = panel.railPitchesMm.slice(0, count - 1);
  const lastLength = lengths[lengths.length - 1] ?? DEFAULT_RAIL_LENGTH_UNITS;
  const lastPitch = pitches[pitches.length - 1] ?? DEFAULT_RAIL_PITCH_MM;
  while (lengths.length < count) lengths.push(lastLength);
  while (pitches.length < count - 1) pitches.push(lastPitch);
  return { ok: true, panel: { ...panel, railLengthsUnits: lengths, railPitchesMm: pitches } };
}

export function setRailLength(panel: Panel, widthOf: WidthOf, rail: number, units: number): PanelEditResult {
  if (!inRange(rail, 0, panel.railLengthsUnits.length - 1)) return failure('unknown-rail');
  if (!inRange(units, 1, MAX_RAIL_LENGTH_UNITS)) return failure('invalid-value');
  const overflows = panel.placements.some(
    (p) => p.rail === rail && p.slot + (widthOf(p.module) ?? 1) > units,
  );
  if (overflows) return failure('modules-do-not-fit');
  const railLengthsUnits = panel.railLengthsUnits.map((length, i) => (i === rail ? units : length));
  return { ok: true, panel: { ...panel, railLengthsUnits } };
}

/**
 * Moves a row with its modules to another position. Spacing stays attached to the positions,
 * not to the rows, so the gaps between rails keep their places.
 */
export function moveRail(panel: Panel, from: number, to: number): PanelEditResult {
  const last = panel.railLengthsUnits.length - 1;
  if (!inRange(from, 0, last) || !inRange(to, 0, last)) return failure('unknown-rail');
  const railLengthsUnits = [...panel.railLengthsUnits];
  railLengthsUnits.splice(to, 0, ...railLengthsUnits.splice(from, 1));
  const newIndex = (rail: number) => {
    if (rail === from) return to;
    if (from < to && rail > from && rail <= to) return rail - 1;
    if (from > to && rail >= to && rail < from) return rail + 1;
    return rail;
  };
  const placements = panel.placements.map((p) => ({ ...p, rail: newIndex(p.rail) }));
  return { ok: true, panel: { ...panel, railLengthsUnits, placements } };
}

/** `gap` 0 is the distance between rail 0 and rail 1, measured between rail centre lines. */
export function setRailPitch(panel: Panel, gap: number, mm: number): PanelEditResult {
  if (!inRange(gap, 0, panel.railPitchesMm.length - 1)) return failure('unknown-rail');
  if (!inRange(mm, MIN_RAIL_PITCH_MM, MAX_RAIL_PITCH_MM)) return failure('invalid-value');
  const railPitchesMm = panel.railPitchesMm.map((pitch, i) => (i === gap ? mm : pitch));
  return { ok: true, panel: { ...panel, railPitchesMm } };
}
