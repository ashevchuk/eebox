import { addComb, type CombLookup } from './combs';
import { addPlacement, type Panel, type WidthOf } from './placement';
import { roundUnits } from './units';

export type MoveGroupResult = { ok: true; panel: Panel } | { ok: false };

/**
 * Moves the chosen modules and combs together by the same number of rows and units. It succeeds
 * only if every one of them fits where it lands, next to the items that stay.
 */
export function moveGroup(
  panel: Panel,
  widthOf: WidthOf,
  combLookup: CombLookup,
  placementIds: readonly string[],
  combIds: readonly string[],
  railDelta: number,
  slotDelta: number,
): MoveGroupResult {
  const moving = panel.placements.filter((p) => placementIds.includes(p.id));
  const movingCombs = panel.combs.filter((c) => combIds.includes(c.id));
  let next: Panel = {
    ...panel,
    placements: panel.placements.filter((p) => !placementIds.includes(p.id)),
    combs: panel.combs.filter((c) => !combIds.includes(c.id)),
  };
  for (const item of moving) {
    const result = addPlacement(next, widthOf, { ...item, rail: item.rail + railDelta, slot: roundUnits(item.slot + slotDelta) });
    if (!result.ok) return { ok: false };
    next = result.panel;
  }
  for (const item of movingCombs) {
    const result = addComb(next, combLookup, { ...item, rail: item.rail + railDelta, slot: roundUnits(item.slot + slotDelta) });
    if (!result.ok) return { ok: false };
    next = result.panel;
  }
  return { ok: true, panel: next };
}
