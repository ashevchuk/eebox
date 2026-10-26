import { insertPlacement, type Panel, type Placement, type PlacementError, type PlacementResult, type WidthOf } from './placement';

export type ShelfError = PlacementError | { kind: 'unknown-shelf-item' };

export type ShelfResult = { ok: true; panel: Panel } | { ok: false; error: ShelfError };

/** Takes a module off its rail and puts it on the shelf, keeping everything about it but the place. */
export function takeOff(panel: Panel, id: string): ShelfResult {
  const placement = panel.placements.find((p) => p.id === id);
  if (!placement) return { ok: false, error: { kind: 'unknown-placement' } };
  const { rail: _rail, slot: _slot, ...item } = placement;
  return {
    ok: true,
    panel: {
      ...panel,
      placements: panel.placements.filter((p) => p.id !== id),
      shelf: [...panel.shelf, item],
    },
  };
}

/**
 * Puts a shelved module on a rail. Like a drop from the palette, modules in the way are pushed
 * aside; if there is no room the shelf is left as it was.
 */
export function placeFromShelf(
  panel: Panel,
  widthOf: WidthOf,
  id: string,
  rail: number,
  slot: number,
): ShelfResult {
  const item = panel.shelf.find((s) => s.id === id);
  if (!item) return { ok: false, error: { kind: 'unknown-shelf-item' } };
  const without: Panel = { ...panel, shelf: panel.shelf.filter((s) => s.id !== id) };
  const placement: Placement = { ...item, rail, slot };
  const result: PlacementResult = insertPlacement(without, widthOf, placement);
  return result.ok ? result : { ok: false, error: result.error };
}

export function discardFromShelf(panel: Panel, id: string): ShelfResult {
  if (!panel.shelf.some((s) => s.id === id)) return { ok: false, error: { kind: 'unknown-shelf-item' } };
  return { ok: true, panel: { ...panel, shelf: panel.shelf.filter((s) => s.id !== id) } };
}
