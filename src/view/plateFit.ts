import { ductsOf } from '../layout/ducts';
import { FIRST_RAIL_Y_MM, MAX_PLATE_SIZE_MM, MIN_PLATE_SIZE_MM } from '../layout/limits';
import { resizePlate, scopeToPlate, type PlateResult } from '../layout/plates';
import type { Panel, Sizes } from '../layout/placement';
import { DIN_MODULE_HEIGHT_MM } from '../library/types';
import { FRAME_PADDING, ductRect, placementRect, railRect } from './geometry';

/** Room kept under the lowest row, where the labels stand, and under a device on the plate for its label. */
const LABEL_ROOM_MM = FIRST_RAIL_Y_MM - DIN_MODULE_HEIGHT_MM / 2;

/** The smallest plate that holds what is on it: its rows with room for their labels, the devices on the plate and the ducts. */
export function fittedPlateSize(panel: Panel, plateId: string, sizes: Sizes): { widthMm: number; heightMm: number } {
  const { panel: scoped } = scopeToPlate(panel, plateId);
  const rects = [
    ...scoped.rails.map((_r, rail) => railRect(scoped, rail)),
    ...scoped.placements.map((p) => placementRect(scoped, sizes, p)),
    ...ductsOf(scoped).map(ductRect),
  ];
  const clamp = (mm: number) => Math.min(MAX_PLATE_SIZE_MM, Math.max(MIN_PLATE_SIZE_MM, Math.ceil(mm * 10) / 10));
  const right = Math.max(0, ...rects.map((r) => r.x + r.width)) - FRAME_PADDING;
  const bottom = Math.max(
    0,
    ...scoped.rails.map((r) => r.y + FIRST_RAIL_Y_MM),
    ...scoped.placements.map((p) => placementRect(scoped, sizes, p).y + placementRect(scoped, sizes, p).height - FRAME_PADDING + LABEL_ROOM_MM),
    ...ductsOf(scoped).map((d) => d.y + d.heightMm),
  );
  return { widthMm: clamp(right), heightMm: clamp(bottom) };
}

/** Sizes a plate to what is on it. */
export function fitPlate(panel: Panel, plateId: string, sizes: Sizes): PlateResult {
  const { widthMm, heightMm } = fittedPlateSize(panel, plateId, sizes);
  return resizePlate(panel, plateId, widthMm, heightMm);
}
