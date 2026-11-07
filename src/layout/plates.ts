import { withNotes, type Annotation } from './annotations';
import { ductsOf } from './ducts';
import { normalizeLabel } from './labels';
import { DEFAULT_RAIL_LENGTH_UNITS, FIRST_RAIL_Y_MM, MAX_PLATES, MAX_PLATE_SIZE_MM, MAX_RAILS, MIN_PLATE_SIZE_MM } from './limits';
import { isVertical, type Rail } from './rail';
import { DIN_MODULE_HEIGHT_MM, MODULE_UNIT_MM } from '../library/types';
import { isFree, isOnRail, type CombPlacement, type Panel, type Placement, type Plate } from './placement';

export const DEFAULT_PLATE_ID = 'plate1';
export const DEFAULT_PLATE_NAME = 'Back plate';
/** What a plate added by hand measures, until it is resized. */
export const DEFAULT_PLATE_NAME_SIZE_MM = { width: 600, height: 800 };

export type PlateError = 'duplicate-name' | 'unknown-plate' | 'invalid-value' | 'too-many' | 'not-empty' | 'last-plate' | 'unknown-rail' | 'too-many-rails';
export type PlateResult = { ok: true; panel: Panel } | { ok: false; error: PlateError };
const failure = (error: PlateError): PlateResult => ({ ok: false, error });

export const plateById = (panel: Panel, id: string): Plate | undefined => panel.plates.find((p) => p.id === id);

/** The plate a device stands on: its own for one on the plate, its rail's for one on a rail. */
export function plateOfPlacement(panel: Panel, placement: Placement): string | undefined {
  return isFree(placement) ? placement.plate : panel.rails[placement.rail]?.plate;
}

export const plateOfComb = (panel: Panel, comb: CombPlacement): string | undefined => panel.rails[comb.rail]?.plate;

/**
 * Rails are kept in one block per plate, the blocks in the order of the plates, so that the rails of a
 * plate have consecutive indexes and a rail's place in its plate is its index minus `railOffset`.
 */
export function railOffset(panel: Panel, plateId: string): number {
  const first = panel.rails.findIndex((r) => r.plate === plateId);
  if (first >= 0) return first;
  const before = panel.plates.slice(0, panel.plates.findIndex((p) => p.id === plateId)).map((p) => p.id);
  return panel.rails.filter((r) => before.includes(r.plate)).length;
}

/** The number a row is shown by: its place among the rows of its own plate, counted from 1. */
export function rowNumber(panel: Panel, rail: number): number {
  const plate = panel.rails[rail]?.plate;
  return plate === undefined ? rail + 1 : rail - railOffset(panel, plate) + 1;
}

/** How many rows the plate of a row has. */
export function rowsOnPlateOf(panel: Panel, rail: number): number {
  const plate = panel.rails[rail]?.plate;
  return panel.rails.filter((r) => r.plate === plate).length;
}

/** The index in the panel of row number `row` (from 1) of the plate that `rail` is on; null when the plate has no such row. */
export function railOfRowNumber(panel: Panel, rail: number, row: number): number | null {
  const plate = panel.rails[rail]?.plate;
  if (plate === undefined || !Number.isInteger(row) || row < 1 || row > rowsOnPlateOf(panel, rail)) return null;
  return railOffset(panel, plate) + row - 1;
}

/** Whether the rails stand in blocks, one per plate, in the order of the plates. */
export function railsAreGrouped(panel: Panel): boolean {
  const order = panel.plates.map((p) => p.id);
  let last = -1;
  for (const rail of panel.rails) {
    const at = order.indexOf(rail.plate);
    if (at < last) return false;
    last = at;
  }
  return true;
}

export interface PlateScope {
  /** Only what is on the plate, its rails numbered from 0: everything that draws or finds things on a plate can work on it as on a panel of its own. */
  panel: Panel;
  /** The index in the whole panel of the first rail of the plate. */
  offset: number;
}

/** A panel of one plate: its rails, the devices and combs on them, the devices on the plate and the ducts. */
export function scopeToPlate(panel: Panel, plateId: string): PlateScope {
  const plate = plateById(panel, plateId) ?? panel.plates[0]!;
  const offset = railOffset(panel, plate.id);
  const rails = panel.rails.filter((r) => r.plate === plate.id);
  const onThisRail = (rail: number) => rail >= offset && rail < offset + rails.length;
  const ducts = ductsOf(panel).filter((d) => d.plate === plate.id);
  const { ducts: _ducts, ...rest } = panel;
  return {
    offset,
    panel: {
      ...rest,
      plates: [plate],
      rails,
      placements: panel.placements.flatMap((p): Placement[] => (isOnRail(p) ? (onThisRail(p.rail) ? [{ ...p, rail: p.rail - offset }] : []) : p.plate === plate.id ? [p] : [])),
      combs: panel.combs.filter((c) => onThisRail(c.rail)).map((c) => ({ ...c, rail: c.rail - offset })),
      ...(ducts.length > 0 ? { ducts } : {}),
    },
  };
}

/** The ids and plate of what a rail, device or duct selection points at, for showing the plate it is on. */
export function plateOfSelection(panel: Panel, selection: { placementId?: string; placementIds?: string[]; combId?: string; combIds?: string[]; ductId?: string; ductIds?: string[]; rail?: number }): string | undefined {
  const placementId = selection.placementId ?? selection.placementIds?.[0];
  const placement = placementId ? panel.placements.find((p) => p.id === placementId) : undefined;
  if (placement) return plateOfPlacement(panel, placement);
  const combId = selection.combId ?? selection.combIds?.[0];
  const comb = combId ? panel.combs.find((c) => c.id === combId) : undefined;
  if (comb) return plateOfComb(panel, comb);
  const ductId = selection.ductId ?? selection.ductIds?.[0];
  const duct = ductId ? ductsOf(panel).find((d) => d.id === ductId) : undefined;
  if (duct) return duct.plate;
  return selection.rail !== undefined ? panel.rails[selection.rail]?.plate : undefined;
}

export function nextPlateId(panel: Panel): string {
  const used = panel.plates.map((p) => /^plate(\d+)$/.exec(p.id)).map((m) => (m ? Number(m[1]) : 0));
  return `plate${Math.max(0, ...used) + 1}`;
}

const validSize = (v: number) => Number.isFinite(v) && v >= MIN_PLATE_SIZE_MM && v <= MAX_PLATE_SIZE_MM;

export function addPlate(panel: Panel, name: string, widthMm: number, heightMm: number): PlateResult & { id?: string } {
  const label = normalizeLabel(name);
  if (!label.ok || label.label === undefined) return failure('invalid-value');
  if (!validSize(widthMm) || !validSize(heightMm)) return failure('invalid-value');
  if (panel.plates.some((p) => p.name === label.label)) return failure('duplicate-name');
  if (panel.plates.length >= MAX_PLATES) return failure('too-many');
  const id = nextPlateId(panel);
  return { ok: true, panel: { ...panel, plates: [...panel.plates, { id, name: label.label, widthMm, heightMm }] }, id };
}

const replacePlate = (panel: Panel, id: string, change: (plate: Plate) => Plate): Panel => ({ ...panel, plates: panel.plates.map((p) => (p.id === id ? change(p) : p)) });

export function renamePlate(panel: Panel, id: string, name: string): PlateResult {
  if (!plateById(panel, id)) return failure('unknown-plate');
  const label = normalizeLabel(name);
  if (!label.ok || label.label === undefined) return failure('invalid-value');
  const newName = label.label;
  if (panel.plates.some((p) => p.id !== id && p.name === newName)) return failure('duplicate-name');
  return { ok: true, panel: replacePlate(panel, id, (p) => ({ ...p, name: newName })) };
}

export function resizePlate(panel: Panel, id: string, widthMm: number, heightMm: number): PlateResult {
  if (!plateById(panel, id)) return failure('unknown-plate');
  if (!validSize(widthMm) || !validSize(heightMm)) return failure('invalid-value');
  return { ok: true, panel: replacePlate(panel, id, (p) => ({ ...p, widthMm, heightMm })) };
}

/** Whether anything is fixed to the plate. */
export function plateIsEmpty(panel: Panel, id: string): boolean {
  return !panel.rails.some((r) => r.plate === id) && !panel.placements.some((p) => isFree(p) && p.plate === id) && !ductsOf(panel).some((d) => d.plate === id);
}

/** Removes a plate that holds nothing; a panel keeps at least one. */
export function removePlate(panel: Panel, id: string): PlateResult {
  if (!plateById(panel, id)) return failure('unknown-plate');
  if (panel.plates.length <= 1) return failure('last-plate');
  if (!plateIsEmpty(panel, id)) return failure('not-empty');
  return { ok: true, panel: { ...panel, plates: panel.plates.filter((p) => p.id !== id) } };
}

/** Renumbers the rails: `order[i]` is the old index of the rail that becomes number i. Devices and combs follow their rails. */
function reorderRails(panel: Panel, order: number[]): Panel {
  const newIndex = new Map(order.map((old, now) => [old, now]));
  return {
    ...panel,
    rails: order.map((old) => panel.rails[old]!),
    placements: panel.placements.map((p) => (isOnRail(p) ? { ...p, rail: newIndex.get(p.rail)! } : p)),
    combs: panel.combs.map((c) => ({ ...c, rail: newIndex.get(c.rail)! })),
  };
}

/** Puts the rails back in blocks, one per plate in the order of the plates; the order inside a plate is kept. */
function grouped(panel: Panel): Panel {
  const order = panel.plates.flatMap((plate) => panel.rails.flatMap((r, i) => (r.plate === plate.id ? [i] : [])));
  return order.every((old, now) => old === now) ? panel : reorderRails(panel, order);
}

/** Adds a row at the bottom of a plate, as long as the last one and under it. */
export function addRail(panel: Panel, plateId: string): PlateResult {
  if (!plateById(panel, plateId)) return failure('unknown-plate');
  if (panel.rails.length >= MAX_RAILS) return failure('too-many-rails');
  const mine = panel.rails.filter((r) => r.plate === plateId && !isVertical(r));
  const last = mine[mine.length - 1];
  const before = mine[mine.length - 2];
  const gap = last && before && last.y > before.y ? last.y - before.y : 150;
  const rail: Rail = last
    ? { plate: plateId, orientation: 'horizontal', x: last.x, y: last.y + gap, lengthUnits: last.lengthUnits }
    : { plate: plateId, orientation: 'horizontal', x: 0, y: FIRST_RAIL_Y_MM, lengthUnits: 12 };
  return { ok: true, panel: grouped({ ...panel, rails: [...panel.rails, rail] }) };
}

/** Where a vertical rail added to a plate stands: its top end this far down, and its centre line this far from what is beside it. */
const VERTICAL_RAIL_TOP_MM = 40;
const VERTICAL_RAIL_CLEARANCE_MM = 60;

/**
 * Adds a vertical row to a plate, as long as a default row or as the plate is tall. It stands to the right of the
 * horizontal rows when the plate has room there, and by the right edge of the plate when it has not, where it crosses them.
 */
export function addVerticalRail(panel: Panel, plateId: string): PlateResult {
  const plate = plateById(panel, plateId);
  if (!plate) return failure('unknown-plate');
  if (panel.rails.length >= MAX_RAILS) return failure('too-many-rails');
  const rowsEnd = Math.max(0, ...panel.rails.filter((r) => r.plate === plateId && !isVertical(r)).map((r) => r.x + r.lengthUnits * MODULE_UNIT_MM));
  const beside = rowsEnd + VERTICAL_RAIL_CLEARANCE_MM;
  const fits = Math.floor((plate.heightMm - VERTICAL_RAIL_TOP_MM) / MODULE_UNIT_MM);
  const rail: Rail = {
    plate: plateId,
    orientation: 'vertical',
    x: beside + DIN_MODULE_HEIGHT_MM / 2 <= plate.widthMm ? beside : Math.max(DIN_MODULE_HEIGHT_MM / 2, plate.widthMm - VERTICAL_RAIL_CLEARANCE_MM),
    y: VERTICAL_RAIL_TOP_MM,
    lengthUnits: Math.max(1, Math.min(DEFAULT_RAIL_LENGTH_UNITS, fits)),
  };
  return { ok: true, panel: grouped({ ...panel, rails: [...panel.rails, rail] }) };
}

/** Removes a row that holds no module and no comb; the rows after it are renumbered. */
export function removeRail(panel: Panel, index: number): PlateResult {
  if (!panel.rails[index]) return failure('unknown-rail');
  if (panel.placements.some((p) => isOnRail(p) && p.rail === index) || panel.combs.some((c) => c.rail === index)) return failure('not-empty');
  return { ok: true, panel: reorderRails(panel, panel.rails.map((_r, i) => i).filter((i) => i !== index)) };
}

/** Moves a row, with its modules and combs, to another plate, where it becomes the last row. */
export function moveRailToPlate(panel: Panel, index: number, plateId: string): PlateResult {
  if (!panel.rails[index]) return failure('unknown-rail');
  if (!plateById(panel, plateId)) return failure('unknown-plate');
  const order = [...panel.rails.map((_r, i) => i).filter((i) => i !== index), index];
  const last = reorderRails(panel, order);
  const moved = { ...last, rails: last.rails.map((r, i) => (i === last.rails.length - 1 ? { ...r, plate: plateId } : r)) };
  return { ok: true, panel: grouped(moved) };
}

/** Moves a device that is fixed to the plate, or a duct, to another plate; its place on it stays. */
export function moveToPlate(panel: Panel, id: string, plateId: string): PlateResult {
  if (!plateById(panel, plateId)) return failure('unknown-plate');
  const placement = panel.placements.find((p) => p.id === id);
  if (placement && isFree(placement)) return { ok: true, panel: { ...panel, placements: panel.placements.map((p) => (p.id === id ? { ...placement, plate: plateId } : p)) } };
  const duct = ductsOf(panel).find((d) => d.id === id);
  if (duct) return { ok: true, panel: { ...panel, ducts: ductsOf(panel).map((d) => (d.id === id ? { ...d, plate: plateId } : d)) } };
  return failure('unknown-rail');
}

/** The notes written on the view of a plate. */
export const notesOnPlate = (panel: Panel, plateId: string): Annotation[] | undefined => plateById(panel, plateId)?.annotations;

/** The panel with the notes of one plate replaced; a plate with none keeps no list. */
export function withPlateNotes(panel: Panel, plateId: string, list: readonly Annotation[]): Panel {
  return replacePlate(panel, plateId, (plate) => withNotes(plate, list));
}

/** Gives a plate that many rows by adding rows at its bottom or removing empty ones from it; a row that holds modules stops the removal. */
export function setRailCountOnPlate(panel: Panel, plateId: string, count: number): PlateResult {
  if (!plateById(panel, plateId)) return failure('unknown-plate');
  if (!Number.isInteger(count) || count < 0 || count > MAX_RAILS) return failure('invalid-value');
  let next = panel;
  for (;;) {
    const mine = next.rails.flatMap((r, i) => (r.plate === plateId ? [i] : []));
    if (mine.length === count) return { ok: true, panel: next };
    const result = mine.length < count ? addRail(next, plateId) : removeRail(next, mine[mine.length - 1]!);
    if (!result.ok) return result;
    next = result.panel;
  }
}
