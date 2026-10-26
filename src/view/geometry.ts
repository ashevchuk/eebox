import { MODULE_UNIT_MM } from '../library/types';
import type { Panel, Placement, WidthOf } from '../layout/placement';
import type { Point } from './Camera';

/** World units are millimetres. */
export const RAIL_HEIGHT = 35;
/** Space above the first and below the last rail, inside the frame. */
export const ROW_MARGIN = 75;
export const MODULE_HEIGHT = 90;
export const FRAME_PADDING = 40;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function railCenterY(panel: Panel, rail: number): number {
  const above = panel.railPitchesMm.slice(0, rail).reduce((sum, pitch) => sum + pitch, 0);
  return FRAME_PADDING + ROW_MARGIN + above;
}

export function railRect(panel: Panel, rail: number): Rect {
  return {
    x: FRAME_PADDING,
    y: railCenterY(panel, rail) - RAIL_HEIGHT / 2,
    width: (panel.railLengthsUnits[rail] ?? 0) * MODULE_UNIT_MM,
    height: RAIL_HEIGHT,
  };
}

export function moduleRect(panel: Panel, rail: number, slot: number, widthUnits: number): Rect {
  return {
    x: FRAME_PADDING + slot * MODULE_UNIT_MM,
    y: railCenterY(panel, rail) - MODULE_HEIGHT / 2,
    width: widthUnits * MODULE_UNIT_MM,
    height: MODULE_HEIGHT,
  };
}

export function frameRect(panel: Panel): Rect {
  const longest = Math.max(0, ...panel.railLengthsUnits) * MODULE_UNIT_MM;
  const lastRail = panel.railLengthsUnits.length - 1;
  const bottom = lastRail < 0 ? FRAME_PADDING : railCenterY(panel, lastRail) + ROW_MARGIN + FRAME_PADDING;
  return { x: 0, y: 0, width: longest + FRAME_PADDING * 2, height: bottom };
}

/**
 * Maps a world point to the rail row under it and the slot that puts the
 * grabbed point (`anchorUnits` from the module's left edge) under the pointer.
 * The slot is clamped into the rail so dragging past an end snaps inward.
 */
export function snapToSlot(
  panel: Panel,
  point: Point,
  widthUnits: number,
  anchorUnits: number,
): { rail: number; slot: number } | null {
  let rail = -1;
  let nearest = Infinity;
  panel.railLengthsUnits.forEach((_length, i) => {
    const distance = Math.abs(point.y - railCenterY(panel, i));
    if (distance < nearest) {
      nearest = distance;
      rail = i;
    }
  });
  const railLength = panel.railLengthsUnits[rail];
  if (railLength === undefined || nearest > ROW_MARGIN) return null;
  const raw = Math.round((point.x - FRAME_PADDING) / MODULE_UNIT_MM - anchorUnits);
  const slot = Math.max(0, Math.min(raw, railLength - widthUnits));
  return { rail, slot: Math.max(0, slot) };
}

export function placementAt(panel: Panel, widthOf: WidthOf, point: Point): Placement | undefined {
  return [...panel.placements].reverse().find((placement) => {
    const rect = moduleRect(panel, placement.rail, placement.slot, widthOf(placement.module) ?? 1);
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  });
}
