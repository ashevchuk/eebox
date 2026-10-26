import { addComb, nextCombId, type CombLookup } from './combs';
import { addPlacement, nextPlacementId, type CombPlacement, type Panel, type Placement, type WidthOf } from './placement';
import { LAYOUT_EPSILON_UNITS, roundUnits } from './units';

/** Modules and combs taken from a panel, to be placed again with new ids. */
export interface Clip {
  placements: Placement[];
  combs: CombPlacement[];
}

export type PasteResult =
  | { ok: true; panel: Panel; placementIds: string[]; combIds: string[] }
  | { ok: false; error: 'nothing-copied' | 'no-room' };

const GRID_UNITS = 0.25;

export function copyItems(panel: Panel, placementIds: readonly string[], combIds: readonly string[]): Clip {
  return {
    placements: panel.placements.filter((p) => placementIds.includes(p.id)),
    combs: panel.combs.filter((c) => combIds.includes(c.id)),
  };
}

function tryPaste(panel: Panel, widthOf: WidthOf, combLookup: CombLookup, clip: Clip, dx: number): PasteResult {
  let next = panel;
  const placementIds: string[] = [];
  const combIds: string[] = [];
  for (const source of clip.placements) {
    const id = nextPlacementId(next);
    const result = addPlacement(next, widthOf, { ...source, id, slot: roundUnits(source.slot + dx) });
    if (!result.ok) return { ok: false, error: 'no-room' };
    next = result.panel;
    placementIds.push(id);
  }
  for (const source of clip.combs) {
    const id = nextCombId(next);
    const result = addComb(next, combLookup, { ...source, id, slot: roundUnits(source.slot + dx) });
    if (!result.ok) return { ok: false, error: 'no-room' };
    next = result.panel;
    combIds.push(id);
  }
  return { ok: true, panel: next, placementIds, combIds };
}

/**
 * Places copies of the clip at the nearest free offset along the rails: to the right first, then to
 * the left. A copy never goes into a gap inside the group it copies, it starts where the group ends. Offsets that put the group flush against a neighbour are tried as well as a coarse
 * grid, so 22.5 mm relays can be pasted edge to edge.
 */
export function pasteItems(panel: Panel, widthOf: WidthOf, combLookup: CombLookup, clip: Clip): PasteResult {
  if (clip.placements.length === 0 && clip.combs.length === 0) return { ok: false, error: 'nothing-copied' };
  const clipEdges = [...clip.placements, ...clip.combs].map((item) => {
    const width = widthOf(item) ?? 1;
    return { left: item.slot, right: item.slot + width };
  });
  const panelEdges = panel.placements.map((item) => ({ left: item.slot, right: item.slot + (widthOf(item) ?? 1) }));
  const railLength = Math.max(0, ...panel.railLengthsUnits);

  const offsets = new Set<number>([0]);
  for (let dx = GRID_UNITS; dx <= railLength; dx += GRID_UNITS) offsets.add(roundUnits(dx)).add(roundUnits(-dx));
  for (const edge of panelEdges) {
    for (const c of clipEdges) {
      offsets.add(roundUnits(edge.right - c.left));
      offsets.add(roundUnits(edge.left - c.right));
    }
  }
  const span = Math.max(...clipEdges.map((c) => c.right)) - Math.min(...clipEdges.map((c) => c.left));
  const beyondGroup = (dx: number) => dx === 0 || Math.abs(dx) >= span - LAYOUT_EPSILON_UNITS;
  const ordered = [...offsets].filter(beyondGroup).sort((a, b) => {
    if (a >= 0 !== b >= 0) return a >= 0 ? -1 : 1;
    return Math.abs(a) - Math.abs(b);
  });
  for (const dx of ordered) {
    const result = tryPaste(panel, widthOf, combLookup, clip, dx);
    if (result.ok) return result;
  }
  return { ok: false, error: 'no-room' };
}

export const MAX_REPEAT_COPIES = 100;

export type RepeatResult =
  | { ok: true; panel: Panel; placementIds: string[]; combIds: string[]; added: number }
  | { ok: false; error: 'nothing-copied' | 'no-room' };

/**
 * Places up to `count` copies of the clip one after another, each copying the one before it, so the
 * spacing of the group carries on. Copies that do not fit are left out, so `added` may be less than `count`; it fails when not
 * even one fits.
 */
export function repeatItems(panel: Panel, widthOf: WidthOf, combLookup: CombLookup, clip: Clip, count: number): RepeatResult {
  let next = panel;
  const placementIds: string[] = [];
  const combIds: string[] = [];
  let added = 0;
  let source = clip;
  for (let i = 0; i < Math.min(count, MAX_REPEAT_COPIES); i++) {
    const result = pasteItems(next, widthOf, combLookup, source);
    if (!result.ok) {
      if (added === 0) return result;
      break;
    }
    next = result.panel;
    placementIds.push(...result.placementIds);
    combIds.push(...result.combIds);
    source = copyItems(next, result.placementIds, result.combIds);
    added++;
  }
  return { ok: true, panel: next, placementIds, combIds, added };
}
