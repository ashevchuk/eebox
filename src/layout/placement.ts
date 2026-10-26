import { normalizeLabel } from './labels';

export interface ModuleRef {
  libraryId: string;
  moduleId: string;
}

export interface Placement {
  id: string;
  module: ModuleRef;
  rail: number;
  /** Offset from the rail start in 17.5 mm units. */
  slot: number;
  /** What the user calls this module on the panel, e.g. the circuit it protects. */
  label?: string;
  /** Own width of this copy; only for modules that are resizable in the library. */
  widthUnits?: number;
  /** Labels of single terminals, keyed by terminal id (e.g. `top:N3`). */
  terminalLabels?: Record<string, string>;
  /** Position of a device that switches: `closed` or `open`, or `1`, `2` or `open` with two inputs. */
  state?: string;
}

/** A module taken off its rail: it keeps its id, so a schematic node and wires find it again. */
export type ShelfItem = Omit<Placement, 'rail' | 'slot'>;

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
  /** Snapshot of the enclosure rails, so later library edits cannot move placed modules. */
  railLengthsUnits: number[];
  /** Centre-to-centre distance in mm between rail i and rail i+1; one entry fewer than the rails. */
  railPitchesMm: number[];
  /** One entry per rail; empty text means no label. */
  railLabels: string[];
  placements: Placement[];
  combs: CombPlacement[];
  /** Modules that are off the rails for now; not part of the bill of materials. */
  shelf: ShelfItem[];
}

/** The width of a placed item: its own override, else the width its module has in the library. */
export type WidthOf = (item: { module: ModuleRef; widthUnits?: number }) => number | undefined;

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
  candidate: Placement,
  ignoreId?: string,
): PlacementError | null {
  const width = widthOf(candidate);
  if (width === undefined) return { kind: 'unknown-module' };
  const railLength = panel.railLengthsUnits[candidate.rail];
  if (railLength === undefined) return { kind: 'unknown-rail' };
  const { slot } = candidate;
  if (!Number.isInteger(slot) || slot < 0 || slot + width > railLength) {
    return { kind: 'out-of-rail' };
  }
  for (const other of panel.placements) {
    if (other.id === ignoreId || other.rail !== candidate.rail) continue;
    const otherWidth = widthOf(other);
    if (otherWidth === undefined) continue;
    if (slot < other.slot + otherWidth && other.slot < slot + width) {
      return { kind: 'overlap', with: other.id };
    }
  }
  return null;
}

export function addPlacement(panel: Panel, widthOf: WidthOf, placement: Placement): PlacementResult {
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
  const moved: Placement = { ...current, rail, slot };
  const error = checkFit(panel, widthOf, moved, id);
  if (error) return { ok: false, error };
  return {
    ok: true,
    panel: { ...panel, placements: panel.placements.map((p) => (p.id === id ? moved : p)) },
  };
}

function pushRight(others: { p: Placement; w: number }[], slot: number, width: number, railLength: number) {
  const shifted = new Map<string, number>();
  let frontier = slot + width;
  for (const { p, w } of others) {
    if (p.slot + w <= slot) continue;
    const newSlot = Math.max(p.slot, frontier);
    if (newSlot + w > railLength) return null;
    shifted.set(p.id, newSlot);
    frontier = newSlot + w;
  }
  return shifted;
}

function pushLeft(others: { p: Placement; w: number }[], slot: number, width: number) {
  const shifted = new Map<string, number>();
  let frontier = slot;
  for (const { p, w } of [...others].reverse()) {
    if (p.slot >= slot + width) continue;
    const newSlot = Math.min(p.slot + w, frontier) - w;
    if (newSlot < 0) return null;
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
  placement: Placement,
  replaceId?: string,
): PlacementResult {
  const strict = replaceId
    ? movePlacement(panel, widthOf, replaceId, placement.rail, placement.slot)
    : addPlacement(panel, widthOf, placement);
  if (strict.ok || strict.error.kind !== 'overlap') return strict;

  const width = widthOf(placement) ?? 1;
  const railLength = panel.railLengthsUnits[placement.rail] ?? 0;
  const others = panel.placements
    .filter((p) => p.rail === placement.rail && p.id !== replaceId)
    .map((p) => ({ p, w: widthOf(p) ?? 1 }))
    .sort((a, b) => a.p.slot - b.p.slot);
  const shifted =
    pushRight(others, placement.slot, width, railLength) ?? pushLeft(others, placement.slot, width);
  if (!shifted) return strict;

  const moved = panel.placements.map((p) =>
    p.id === replaceId ? placement : shifted.has(p.id) ? { ...p, slot: shifted.get(p.id)! } : p,
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
  if (!Number.isInteger(units) || units < allowed.minUnits || units > allowed.maxUnits) {
    return { ok: false, error: { kind: 'width-out-of-range' } };
  }
  const { widthUnits: _previous, ...rest } = current;
  const next: Placement = units === allowed.baseUnits ? rest : { ...rest, widthUnits: units };
  const error = checkFit(panel, widthOf, next, id);
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
