import { MODULE_UNIT_MM } from '../library/types';
import { ductsOf, type Duct } from './ducts';
import { roundMm } from './free';
import { isFree, type FreePlacement, type Panel, type Placement, type Sizes } from './placement';

export const ALIGNMENTS = ['left', 'centre-x', 'right', 'top', 'centre-y', 'bottom', 'spread-x', 'spread-y'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** Spreading keeps the two outermost items where they are, so it needs a third one between them. */
export const MIN_ITEMS_TO_SPREAD = 3;

interface Item {
  x: number;
  y: number;
  width: number;
  height: number;
  moveTo: (x: number, y: number) => void;
}

export type AlignResult = { ok: true; panel: Panel } | { ok: false };

/** How many of the chosen things can be aligned: the devices fixed to the plate and the ducts, not those on rails. */
export function alignableCount(panel: Panel, placementIds: readonly string[], ductIds: readonly string[]): number {
  return panel.placements.filter((p) => isFree(p) && placementIds.includes(p.id)).length + ductsOf(panel).filter((d) => ductIds.includes(d.id)).length;
}

/**
 * Lines up the chosen devices and ducts on the plate by their edges or middles, or spreads them with
 * equal gaps between neighbours. Devices on rails are left where they are. Refused when fewer than two
 * (three for spreading) can move, or when the gaps would be negative.
 */
export function alignFree(panel: Panel, sizes: Sizes, placementIds: readonly string[], ductIds: readonly string[], how: Alignment): AlignResult {
  const moved = new Map<string, { x: number; y: number }>();
  const movedDucts = new Map<string, { x: number; y: number }>();
  const items: Item[] = [
    ...panel.placements
      .filter((p): p is FreePlacement => isFree(p) && placementIds.includes(p.id))
      .map((p) => ({ x: p.x, y: p.y, width: (sizes.widthOf(p) ?? 1) * MODULE_UNIT_MM, height: sizes.heightOf(p) ?? 0, moveTo: (x: number, y: number) => void moved.set(p.id, { x, y }) })),
    ...ductsOf(panel)
      .filter((d) => ductIds.includes(d.id))
      .map((d) => ({ x: d.x, y: d.y, width: d.widthMm, height: d.heightMm, moveTo: (x: number, y: number) => void movedDucts.set(d.id, { x, y }) })),
  ];
  if (items.length < (how === 'spread-x' || how === 'spread-y' ? MIN_ITEMS_TO_SPREAD : 2)) return { ok: false };

  const horizontal = how === 'left' || how === 'centre-x' || how === 'right' || how === 'spread-x';
  const start = (item: Item) => (horizontal ? item.x : item.y);
  const size = (item: Item) => (horizontal ? item.width : item.height);
  const place = (item: Item, position: number) => (horizontal ? item.moveTo(roundMm(position), item.y) : item.moveTo(item.x, roundMm(position)));
  const first = Math.min(...items.map(start));
  const last = Math.max(...items.map((item) => start(item) + size(item)));

  if (how === 'left' || how === 'top') items.forEach((item) => place(item, first));
  else if (how === 'right' || how === 'bottom') items.forEach((item) => place(item, last - size(item)));
  else if (how === 'centre-x' || how === 'centre-y') items.forEach((item) => place(item, (first + last) / 2 - size(item) / 2));
  else {
    const ordered = [...items].sort((a, b) => start(a) - start(b));
    const outer = [ordered[0]!, ordered[ordered.length - 1]!];
    const span = start(outer[1]!) + size(outer[1]!) - start(outer[0]!);
    const gap = (span - ordered.reduce((total, item) => total + size(item), 0)) / (ordered.length - 1);
    if (gap < 0) return { ok: false };
    let at = start(outer[0]!);
    for (const item of ordered) {
      place(item, at);
      at += size(item) + gap;
    }
  }

  const placements = panel.placements.map((p): Placement => {
    const to = moved.get(p.id);
    return to && isFree(p) ? { ...p, x: to.x, y: to.y } : p;
  });
  const ducts: Duct[] = ductsOf(panel).map((d) => ({ ...d, ...(movedDucts.get(d.id) ?? {}) }));
  const { ducts: _previous, ...rest } = panel;
  return { ok: true, panel: { ...rest, placements, ...(ducts.length > 0 ? { ducts } : {}) } };
}
