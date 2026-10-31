import { ductsOf, type Duct } from './ducts';
import { MAX_RAIL_POSITION_MM } from './limits';
import { isFree, isOnRail, type FreePlacement, type Panel, type Placement, type PlacementResult, type WidthOf } from './placement';

/** Positions are kept to a tenth of a millimetre, so dragging does not leave values like 12.000000001. */
export const roundMm = (mm: number): number => Math.round(mm * 10) / 10;

const validPosition = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_RAIL_POSITION_MM;

/** Puts a device on the plate at a place; it may stand on other things, which is flagged and not refused. */
export function addFreePlacement(panel: Panel, widthOf: WidthOf, placement: FreePlacement): PlacementResult {
  if (panel.placements.some((p) => p.id === placement.id) || panel.shelf.some((s) => s.id === placement.id)) {
    return { ok: false, error: { kind: 'duplicate-id' } };
  }
  if (widthOf(placement) === undefined) return { ok: false, error: { kind: 'unknown-module' } };
  if (!validPosition(placement.x) || !validPosition(placement.y)) return { ok: false, error: { kind: 'bad-position' } };
  return { ok: true, panel: { ...panel, placements: [...panel.placements, placement] } };
}

/** Moves a device to a place on the plate; a device that was on a rail leaves it. */
export function moveFreePlacement(panel: Panel, id: string, x: number, y: number): PlacementResult {
  const current = panel.placements.find((p) => p.id === id);
  if (!current) return { ok: false, error: { kind: 'unknown-placement' } };
  if (!validPosition(x) || !validPosition(y)) return { ok: false, error: { kind: 'bad-position' } };
  const { rail: _rail, slot: _slot, ...rest } = current;
  const moved: FreePlacement = { ...rest, x: roundMm(x), y: roundMm(y) };
  return { ok: true, panel: { ...panel, placements: panel.placements.map((p) => (p.id === id ? moved : p)) } };
}

export type MoveFreeResult = { ok: true; panel: Panel } | { ok: false };

/**
 * Moves the chosen free devices and ducts together by the same distance. The distance is cut short
 * where the first of them would cross the top or the left edge of the plate, and refused where one
 * would pass the far limit.
 */
export function moveFreeGroup(panel: Panel, placementIds: readonly string[], ductIds: readonly string[], dx: number, dy: number): MoveFreeResult {
  const devices = panel.placements.filter((p): p is FreePlacement => isFree(p) && placementIds.includes(p.id));
  const ducts = ductsOf(panel).filter((d) => ductIds.includes(d.id));
  if (devices.length + ducts.length === 0) return { ok: false };
  const leftmost = Math.min(...devices.map((p) => p.x), ...ducts.map((d) => d.x));
  const topmost = Math.min(...devices.map((p) => p.y), ...ducts.map((d) => d.y));
  const moveX = Math.max(dx, -leftmost);
  const moveY = Math.max(dy, -topmost);
  const shifted = (value: number, by: number) => roundMm(value + by);
  const placements = panel.placements.map((p): Placement => (isFree(p) && placementIds.includes(p.id) ? { ...p, x: shifted(p.x, moveX), y: shifted(p.y, moveY) } : p));
  const moved: Duct[] = ductsOf(panel).map((d) => (ductIds.includes(d.id) ? { ...d, x: shifted(d.x, moveX), y: shifted(d.y, moveY) } : d));
  const all = [...placements.filter(isFree), ...moved];
  if (all.some((item) => !validPosition(item.x) || !validPosition(item.y))) return { ok: false };
  const { ducts: _previous, ...rest } = panel;
  return { ok: true, panel: { ...rest, placements, ...(moved.length > 0 ? { ducts: moved } : {}) } };
}

/** The devices of a panel that stand on rails, and those that are fixed to the plate. */
export const railPlacementsOf = (panel: Panel) => panel.placements.filter(isOnRail);
export const freePlacementsOf = (panel: Panel) => panel.placements.filter(isFree);
