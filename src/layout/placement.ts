import type { Annotation } from './annotations';
import type { Duct } from './ducts';
import type { ProjectInfo } from './info';
import { normalizeLabel } from './labels';
import type { Rail } from './rail';
import { LAYOUT_EPSILON_UNITS } from './units';

export interface ModuleRef {
  libraryId: string;
  moduleId: string;
}

interface PlacementCommon {
  id: string;
  module: ModuleRef;
  /** What the user calls this module on the panel, e.g. the circuit it protects. */
  label?: string;
  /** Own width of this copy; only for modules that are resizable in the library. */
  widthUnits?: number;
  /** Labels of single terminals, keyed by terminal id (e.g. `top:N3`). */
  terminalLabels?: Record<string, string>;
  /** Position of a device that switches: `closed` or `open`, or `1`, `2` or `open` with two inputs. */
  state?: string;
  /** Values of the logic flags the person has set; a flag not listed has its default. */
  flags?: Record<string, boolean>;
}

/** A mounting surface, such as the back plate of a cabinet or one of its doors; its things are measured from its top-left corner. */
export interface Plate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  /** Notes written on the view of this plate; only when there are some. */
  annotations?: Annotation[];
}

/** A module clipped on a DIN rail. */
export interface RailPlacement extends PlacementCommon {
  rail: number;
  /** Offset from the rail start in 17.5 mm units. */
  slot: number;
  x?: never;
  y?: never;
  plate?: never;
}

/** A device fixed straight to the mounting plate. */
export interface FreePlacement extends PlacementCommon {
  /** The plate the device is fixed to. */
  plate: string;
  /** Left edge of the device, in mm from the left edge of the working area. */
  x: number;
  /** Top edge of the device, in mm from the top of the working area. */
  y: number;
  rail?: never;
  slot?: never;
}

export type Placement = RailPlacement | FreePlacement;

export const isOnRail = (placement: Placement): placement is RailPlacement => placement.rail !== undefined;
export const isFree = (placement: Placement): placement is FreePlacement => placement.x !== undefined;

/** A module taken off the panel: it keeps its id, so a schematic node and wires find it again. */
export type ShelfItem = PlacementCommon;

/** A comb bus bar lying over the terminals of the modules on one side of a rail. */
export interface CombPlacement {
  id: string;
  module: ModuleRef;
  rail: number;
  slot: number;
  label?: string;
  widthUnits?: number;
}

export interface Panel {
  /** Name of the whole panel, shown on the drawing and used for file names. */
  title?: string;
  /** Which version this is and what the people it was passed to decided; only when something is stated. */
  info?: ProjectInfo;
  /** The mounting surfaces: a back plate, doors; at least one. */
  plates: Plate[];
  /** The rails, copied from the enclosure, so later library edits cannot move placed modules. */
  rails: Rail[];
  /** Cable ducts on the mounting plate; only when there are some. */
  ducts?: Duct[];
  /** How far devices on the plate and ducts are to be kept from other things, in mm; only when it is asked for. */
  clearanceMm?: number;
  placements: Placement[];
  combs: CombPlacement[];
  /** Modules that are off the rails for now; not part of the bill of materials. */
  shelf: ShelfItem[];
}

/** The width of a placed item: its own override, else the width its module has in the library. */
export type WidthOf = (item: { module: ModuleRef; widthUnits?: number }) => number | undefined;

/** The height in mm of a placed item: what its module's face measures in the library. */
export type HeightOf = (item: { module: ModuleRef }) => number | undefined;

/** How big a placed item is, which the drawing and the hit tests need and the placement rules do not. */
export interface Sizes {
  widthOf: WidthOf;
  heightOf: HeightOf;
}

/** What a library allows for the width of copies of a module; undefined when it cannot be resized. */
export interface ResizeInfo {
  minUnits: number;
  maxUnits: number;
  /** The width of the module in the library, which a copy returns to when no override is needed. */
  baseUnits: number;
}
export type ResizeOf = (module: ModuleRef) => ResizeInfo | undefined;

export type PlacementError =
  | { kind: 'unknown-module' }
  | { kind: 'unknown-rail' }
  | { kind: 'out-of-rail' }
  | { kind: 'bad-position' }
  | { kind: 'unknown-plate' }
  | { kind: 'overlap'; with: string }
  | { kind: 'duplicate-id' }
  | { kind: 'unknown-placement' }
  | { kind: 'invalid-label' }
  | { kind: 'not-resizable' }
  | { kind: 'invalid-state' }
  | { kind: 'width-out-of-range' };

export type PlacementResult =
  | { ok: true; panel: Panel }
  | { ok: false; error: PlacementError };

export interface PanelProblem {
  placementId: string;
  error: PlacementError;
}

function checkFit(
  panel: Panel,
  widthOf: WidthOf,
  candidate: RailPlacement,
  ignoreId?: string,
): PlacementError | null {
  const width = widthOf(candidate);
  if (width === undefined) return { kind: 'unknown-module' };
  const railLength = panel.rails[candidate.rail]?.lengthUnits;
  if (railLength === undefined) return { kind: 'unknown-rail' };
  const { slot } = candidate;
  if (!Number.isFinite(slot) || slot < 0 || slot + width > railLength + LAYOUT_EPSILON_UNITS) {
    return { kind: 'out-of-rail' };
  }
  for (const other of panel.placements.filter(isOnRail)) {
    if (other.id === ignoreId || other.rail !== candidate.rail) continue;
    const otherWidth = widthOf(other);
    if (otherWidth === undefined) continue;
    if (slot < other.slot + otherWidth - LAYOUT_EPSILON_UNITS && other.slot < slot + width - LAYOUT_EPSILON_UNITS) {
      return { kind: 'overlap', with: other.id };
    }
  }
  return null;
}

export function addPlacement(panel: Panel, widthOf: WidthOf, placement: RailPlacement): PlacementResult {
  if (panel.placements.some((p) => p.id === placement.id) || panel.shelf.some((s) => s.id === placement.id)) {
    return { ok: false, error: { kind: 'duplicate-id' } };
  }
  const error = checkFit(panel, widthOf, placement);
  if (error) return { ok: false, error };
  return { ok: true, panel: { ...panel, placements: [...panel.placements, placement] } };
}

export function movePlacement(
  panel: Panel,
  widthOf: WidthOf,
  id: string,
  rail: number,
  slot: number,
): PlacementResult {
  const current = panel.placements.find((p) => p.id === id);
  if (!current) return { ok: false, error: { kind: 'unknown-placement' } };
  const { x: _x, y: _y, plate: _plate, ...rest } = current;
  const moved: RailPlacement = { ...rest, rail, slot };
  const error = checkFit(panel, widthOf, moved, id);
  if (error) return { ok: false, error };
  return {
    ok: true,
    panel: { ...panel, placements: panel.placements.map((p) => (p.id === id ? moved : p)) },
  };
}

function pushRight(others: { p: RailPlacement; w: number }[], slot: number, width: number, railLength: number) {
  const shifted = new Map<string, number>();
  let frontier = slot + width;
  for (const { p, w } of others) {
    if (p.slot + w <= slot + LAYOUT_EPSILON_UNITS) continue;
    const newSlot = Math.max(p.slot, frontier);
    if (newSlot + w > railLength + LAYOUT_EPSILON_UNITS) return null;
    shifted.set(p.id, newSlot);
    frontier = newSlot + w;
  }
  return shifted;
}

function pushLeft(others: { p: RailPlacement; w: number }[], slot: number, width: number) {
  const shifted = new Map<string, number>();
  let frontier = slot;
  for (const { p, w } of [...others].reverse()) {
    if (p.slot >= slot + width - LAYOUT_EPSILON_UNITS) continue;
    const newSlot = Math.min(p.slot + w, frontier) - w;
    if (newSlot < -LAYOUT_EPSILON_UNITS) return null;
    shifted.set(p.id, newSlot);
    frontier = newSlot;
  }
  return shifted;
}

/**
 * Like addPlacement/movePlacement (when `replaceId` is set), but a drop onto occupied slots
 * inserts the module there and pushes the modules in the way aside: to the right if they fit,
 * otherwise to the left. Gaps between untouched modules are kept. Fails when neither side has room.
 */
export function insertPlacement(
  panel: Panel,
  widthOf: WidthOf,
  placement: RailPlacement,
  replaceId?: string,
): PlacementResult {
  const strict = replaceId
    ? movePlacement(panel, widthOf, replaceId, placement.rail, placement.slot)
    : addPlacement(panel, widthOf, placement);
  if (strict.ok || strict.error.kind !== 'overlap') return strict;

  const width = widthOf(placement) ?? 1;
  const railLength = panel.rails[placement.rail]?.lengthUnits ?? 0;
  const others = panel.placements
    .filter(isOnRail)
    .filter((p) => p.rail === placement.rail && p.id !== replaceId)
    .map((p) => ({ p, w: widthOf(p) ?? 1 }))
    .sort((a, b) => a.p.slot - b.p.slot);
  const shifted =
    pushRight(others, placement.slot, width, railLength) ?? pushLeft(others, placement.slot, width);
  if (!shifted) return strict;

  const moved = panel.placements.map((p) =>
    p.id === replaceId ? placement : shifted.has(p.id) && isOnRail(p) ? { ...p, slot: shifted.get(p.id)! } : p,
  );
  return { ok: true, panel: { ...panel, placements: replaceId ? moved : [...moved, placement] } };
}

/** Gives one copy its own width, within what the library allows, if the neighbours leave room. */
export function setPlacementWidth(
  panel: Panel,
  widthOf: WidthOf,
  resizeOf: ResizeOf,
  id: string,
  units: number,
): PlacementResult {
  const current = panel.placements.find((p) => p.id === id);
  if (!current) return { ok: false, error: { kind: 'unknown-placement' } };
  const allowed = resizeOf(current.module);
  if (!allowed) return { ok: false, error: { kind: 'not-resizable' } };
  if (!Number.isFinite(units) || units < allowed.minUnits || units > allowed.maxUnits) {
    return { ok: false, error: { kind: 'width-out-of-range' } };
  }
  const { widthUnits: _previous, ...rest } = current;
  const next: Placement = units === allowed.baseUnits ? rest : { ...rest, widthUnits: units };
  const error = isOnRail(next) ? checkFit(panel, widthOf, next, id) : null;
  if (error) return { ok: false, error };
  return { ok: true, panel: { ...panel, placements: panel.placements.map((p) => (p.id === id ? next : p)) } };
}

/** Labels one terminal of a placed module; blank text removes the label. */
export function setTerminalLabel(panel: Panel, id: string, terminalId: string, text: string): PlacementResult {
  const parsed = normalizeLabel(text);
  if (!parsed.ok) return { ok: false, error: { kind: 'invalid-label' } };
  if (!panel.placements.some((p) => p.id === id)) return { ok: false, error: { kind: 'unknown-placement' } };
  const placements = panel.placements.map((p) => {
    if (p.id !== id) return p;
    const { terminalLabels: previous, ...rest } = p;
    const labels = { ...previous };
    if (parsed.label === undefined) delete labels[terminalId];
    else labels[terminalId] = parsed.label;
    return Object.keys(labels).length === 0 ? rest : { ...rest, terminalLabels: labels };
  });
  return { ok: true, panel: { ...panel, placements } };
}

/** The number a terminal label may carry: the label is the pattern with this replaced by 1, 2, 3 along the terminals. */
export const LABEL_NUMBER_MARK = '{n}';
const MAX_TERMINAL_LABELS_PER_MODULE = 64;

/**
 * Labels some terminals of a placed module in one go, in the order given: `pattern` with its `{n}`
 * replaced by 1 for the first, 2 for the second and so on, as `X1:{n}` gives X1:1, X1:2.... An empty
 * pattern clears their labels. Nothing changes if one of the labels would be invalid.
 */
export function fillTerminalLabels(panel: Panel, id: string, terminalIds: readonly string[], pattern: string): PlacementResult {
  const current = panel.placements.find((p) => p.id === id);
  if (!current) return { ok: false, error: { kind: 'unknown-placement' } };
  const labels = { ...current.terminalLabels };
  if (pattern.trim() === '') {
    for (const terminalId of terminalIds) delete labels[terminalId];
  } else {
    if (!pattern.includes(LABEL_NUMBER_MARK)) return { ok: false, error: { kind: 'invalid-label' } };
    for (const [index, terminalId] of terminalIds.entries()) {
      const parsed = normalizeLabel(pattern.split(LABEL_NUMBER_MARK).join(String(index + 1)));
      if (!parsed.ok || parsed.label === undefined) return { ok: false, error: { kind: 'invalid-label' } };
      labels[terminalId] = parsed.label;
    }
  }
  if (Object.keys(labels).length > MAX_TERMINAL_LABELS_PER_MODULE) return { ok: false, error: { kind: 'invalid-label' } };
  const { terminalLabels: _previous, ...rest } = current;
  const next: Placement = Object.keys(labels).length === 0 ? rest : { ...rest, terminalLabels: labels };
  return { ok: true, panel: { ...panel, placements: panel.placements.map((p) => (p.id === id ? next : p)) } };
}

export function setPlacementLabel(panel: Panel, id: string, text: string): PlacementResult {
  const parsed = normalizeLabel(text);
  if (!parsed.ok) return { ok: false, error: { kind: 'invalid-label' } };
  if (!panel.placements.some((p) => p.id === id)) return { ok: false, error: { kind: 'unknown-placement' } };
  const placements = panel.placements.map((p) => {
    if (p.id !== id) return p;
    const { label: _previous, ...rest } = p;
    return parsed.label === undefined ? rest : { ...rest, label: parsed.label };
  });
  return { ok: true, panel: { ...panel, placements } };
}

/** Sets the position of a switching device, or clears it with `undefined` so it takes its default. */
export function setPlacementState(panel: Panel, id: string, state: string | undefined, allowed: readonly string[]): PlacementResult {
  if (!panel.placements.some((p) => p.id === id)) return { ok: false, error: { kind: 'unknown-placement' } };
  if (state !== undefined && !allowed.includes(state)) return { ok: false, error: { kind: 'invalid-state' } };
  const placements = panel.placements.map((p) => {
    if (p.id !== id) return p;
    const { state: _previous, ...rest } = p;
    return state === undefined ? rest : { ...rest, state };
  });
  return { ok: true, panel: { ...panel, placements } };
}

/** Sets a logic flag of a placed module, or clears it with `undefined` so it takes its default. */
export function setPlacementFlag(panel: Panel, id: string, flag: string, value: boolean | undefined, known: readonly string[]): PlacementResult {
  if (!panel.placements.some((p) => p.id === id)) return { ok: false, error: { kind: 'unknown-placement' } };
  if (!known.includes(flag)) return { ok: false, error: { kind: 'invalid-state' } };
  const placements = panel.placements.map((p) => {
    if (p.id !== id) return p;
    const { flags: previous, ...rest } = p;
    const flags = { ...previous };
    if (value === undefined) delete flags[flag];
    else flags[flag] = value;
    return Object.keys(flags).length === 0 ? rest : { ...rest, flags };
  });
  return { ok: true, panel: { ...panel, placements } };
}

export function removePlacement(panel: Panel, id: string): PlacementResult {
  if (!panel.placements.some((p) => p.id === id)) {
    return { ok: false, error: { kind: 'unknown-placement' } };
  }
  return { ok: true, panel: { ...panel, placements: panel.placements.filter((p) => p.id !== id) } };
}

/** Audits a panel that did not go through addPlacement, e.g. one loaded from a file. */
export function findProblems(panel: Panel, widthOf: WidthOf): PanelProblem[] {
  const problems: PanelProblem[] = [];
  panel.placements.forEach((placement, index) => {
    if (!isOnRail(placement)) return;
    const earlier: Panel = { ...panel, placements: panel.placements.slice(0, index) };
    const error = checkFit(earlier, widthOf, placement);
    if (error) problems.push({ placementId: placement.id, error });
  });
  return problems;
}

export function nextPlacementId(panel: Panel): string {
  const used = [...panel.placements, ...panel.shelf]
    .map((p) => /^p(\d+)$/.exec(p.id))
    .map((m) => (m ? Number(m[1]) : 0));
  return `p${Math.max(0, ...used) + 1}`;
}
