import { nextCombId } from './combs';
import { addRail } from './plates';
import { DEFAULT_RAIL_PITCH_MM, MAX_RAIL_POSITION_MM } from './limits';
import { moveRail, setRailLabel, setRailLength, setRailOrientation, setRailPosition, type PanelEditError, type PanelEditResult } from './panel';
import { isVertical, type Rail } from './rail';
import { findProblems, isOnRail, nextPlacementId, type Panel, type RailPlacement, type WidthOf } from './placement';
import { roundUnits } from './units';

export type ArrangeHow = 'pack-left' | 'pack-right' | 'spread' | 'row-start' | 'row-end';

export type ArrangeResult =
  | { ok: true; panel: Panel }
  | { ok: false; error: 'nothing-to-do' | 'blocked' | 'too-few' };

/** Where the chosen modules of one rail go, in the order they stand in. */
function slotsFor(rail: RailPlacement[], widths: number[], railLength: number, how: ArrangeHow): number[] {
  const slots: number[] = [];
  const total = widths.reduce((sum, w) => sum + w, 0);
  const first = rail[0]!.slot;
  const lastRight = rail[rail.length - 1]!.slot + widths[widths.length - 1]!;
  const gap = rail.length > 1 ? (lastRight - first - total) / (rail.length - 1) : 0;
  let edge = how === 'pack-left' ? first : how === 'pack-right' ? lastRight - total : how === 'row-start' ? 0 : how === 'row-end' ? railLength - total : first;
  rail.forEach((_, i) => {
    slots.push(roundUnits(edge));
    edge += widths[i]! + (how === 'spread' ? gap : 0);
  });
  return slots;
}

/**
 * Lines the chosen modules up along their rails, each rail on its own: against the left or right end of the
 * group, against the left or right end of the rail, or with equal gaps between the first and the last.
 * Nothing changes if the result would put a module on another one.
 */
export function arrangeModules(panel: Panel, widthOf: WidthOf, ids: readonly string[], how: ArrangeHow): ArrangeResult {
  const chosen = panel.placements.filter(isOnRail).filter((p) => ids.includes(p.id));
  if (chosen.length === 0) return { ok: false, error: 'nothing-to-do' };
  const byRail = new Map<number, RailPlacement[]>();
  for (const placement of chosen) byRail.set(placement.rail, [...(byRail.get(placement.rail) ?? []), placement]);
  const moved = new Map<string, number>();
  let spreadable = false;
  for (const [rail, group] of byRail) {
    const ordered = [...group].sort((a, b) => a.slot - b.slot);
    if (how === 'spread' && ordered.length < 3) continue;
    spreadable = true;
    const widths = ordered.map((p) => widthOf(p) ?? 1);
    const slots = slotsFor(ordered, widths, panel.rails[rail]?.lengthUnits ?? 0, how);
    ordered.forEach((p, i) => {
      if (Math.abs(slots[i]! - p.slot) > 1e-9) moved.set(p.id, slots[i]!);
    });
  }
  if (how === 'spread' && !spreadable) return { ok: false, error: 'too-few' };
  if (moved.size === 0) return { ok: false, error: 'nothing-to-do' };
  const next: Panel = { ...panel, placements: panel.placements.map((p) => (isOnRail(p) && moved.has(p.id) ? { ...p, slot: moved.get(p.id)! } : p)) };
  if (findProblems(next, widthOf).length > findProblems(panel, widthOf).length) return { ok: false, error: 'blocked' };
  return { ok: true, panel: next };
}

export type DuplicateRowResult = { ok: true; panel: Panel; placementIds: string[] } | { ok: false; error: PanelEditError };

/** Puts a copy of a row, with its modules, combs and label, right below it. */
/** The copy of a vertical row stands upright too, one pitch to the right of its source. */
function turnedLikeSource(panel: Panel, copy: number, source: Rail): PanelEditResult {
  const turned = setRailOrientation(panel, copy, source.orientation);
  return turned.ok ? setRailPosition(turned.panel, copy, Math.min(source.x + DEFAULT_RAIL_PITCH_MM, MAX_RAIL_POSITION_MM), source.y) : turned;
}

export function duplicateRow(panel: Panel, rail: number): DuplicateRowResult {
  const source = panel.rails[rail];
  if (source === undefined) return { ok: false, error: 'unknown-rail' };
  const added = addRail(panel, source.plate);
  if (!added.ok) return { ok: false, error: 'invalid-value' };
  const lastIndex = added.panel.rails.map((r) => r.plate).lastIndexOf(source.plate);
  const sized = setRailLength(added.panel, () => 1, lastIndex, source.lengthUnits);
  if (!sized.ok) return sized;
  const turned: PanelEditResult = isVertical(source) ? turnedLikeSource(sized.panel, lastIndex, source) : sized;
  if (!turned.ok) return turned;
  const labelled = setRailLabel(turned.panel, lastIndex, source.label ?? '');
  if (!labelled.ok) return labelled;
  let next: Panel = labelled.panel;
  const placementIds: string[] = [];
  for (const source of panel.placements.filter(isOnRail).filter((p) => p.rail === rail)) {
    const id = nextPlacementId(next);
    next = { ...next, placements: [...next.placements, { ...source, id, rail: lastIndex }] };
    placementIds.push(id);
  }
  for (const source of panel.combs.filter((c) => c.rail === rail)) {
    next = { ...next, combs: [...next.combs, { ...source, id: nextCombId(next), rail: lastIndex }] };
  }
  // The copy goes right after its row when only rows of its own orientation lie in between, and at the end of the plate's rows otherwise.
  const placed = moveRail(next, lastIndex, rail + 1);
  return { ok: true, panel: placed.ok ? placed.panel : next, placementIds };
}
