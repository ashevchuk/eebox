import type { ModuleDef, ModuleKind } from '../library/types';
import type { Finding } from '../electrical/problems';
import { isOnRail, type ModuleRef, type Panel, type Placement, type PlacementResult } from './placement';

export const MAX_REF_LENGTH = 16;
/** Letters, digits and the signs of a structured designation such as `=A1+B2-QF1`. */
const REF_PATTERN = /^[\p{L}\p{N}.\-+=:_/]+$/u;

/**
 * The usual letter codes of devices in a distribution board, as drawings in the GOST 2.710 tradition
 * write them; they are not checked against IEC 81346-2. Kinds without a code (bars, combs, terminal
 * blocks) are not numbered: a terminal strip is one item, not one per block.
 */
export const REF_PREFIX: Partial<Record<ModuleKind, string>> = {
  breaker: 'QF',
  rcd: 'QD',
  rcbo: 'QFD',
  switch: 'QS',
  fuse: 'FU',
  spd: 'FV',
  contactor: 'KM',
  relay: 'K',
  meter: 'PI',
  psu: 'G',
  softstarter: 'A',
  vfd: 'UZ',
  plc: 'A',
  transformer: 'T',
  other: 'A',
};

export function isStoredRef(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_REF_LENGTH && REF_PATTERN.test(value);
}

/** Turns what the user typed into what is stored: empty text clears the designation. */
export function normalizeRef(text: string): { ok: true; ref: string | undefined } | { ok: false } {
  const ref = text.trim();
  if (ref === '') return { ok: true, ref: undefined };
  return isStoredRef(ref) ? { ok: true, ref } : { ok: false };
}

export function setPlacementRef(panel: Panel, id: string, text: string): PlacementResult {
  const parsed = normalizeRef(text);
  if (!parsed.ok) return { ok: false, error: { kind: 'invalid-ref' } };
  if (!panel.placements.some((p) => p.id === id)) return { ok: false, error: { kind: 'unknown-placement' } };
  const placements = panel.placements.map((p) => {
    if (p.id !== id) return p;
    const { ref: _previous, ...rest } = p;
    return parsed.ref === undefined ? rest : { ...rest, ref: parsed.ref };
  });
  return { ok: true, panel: { ...panel, placements } };
}

/** A copy of a device is another device, so it does not take the designation of the original. */
export function withoutRef<T extends { ref?: string }>(item: T): T {
  const { ref: _ref, ...rest } = item;
  return rest as T;
}

/** Plate by plate; on a plate the rows from the top and each from the left, then the loose devices from the top left. */
export function readingOrder(panel: Panel): Placement[] {
  const plateIndex = (plate: string) => panel.plates.findIndex((p) => p.id === plate);
  const key = (p: Placement): number[] =>
    // A loaded file may still hold a module on a rail that is gone; it is reported, so here it only must not throw.
    isOnRail(p) ? [plateIndex(panel.rails[p.rail]?.plate ?? ''), 0, p.rail, p.slot] : [plateIndex(p.plate), 1, p.y, p.x];
  return [...panel.placements].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    const i = ka.findIndex((v, n) => v !== kb[n]);
    return i < 0 ? 0 : ka[i]! - kb[i]!;
  });
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highestNumber(panel: Panel, prefix: string): number {
  const used = new RegExp(`^${escaped(prefix)}(\\d+)$`);
  // A module on the shelf keeps its designation and may come back, so its number stays taken.
  return Math.max(0, ...[...panel.placements, ...panel.shelf].map((p) => Number(used.exec(p.ref ?? '')?.[1] ?? 0)));
}

/** The designation the next device of this kind would get, if it has a code. */
/** The letters a device's designation starts with: those of its module, else those of its kind. */
export const refCodeOf = (def: ModuleDef | undefined): string | undefined => (def ? (def.refCode ?? REF_PREFIX[def.kind]) : undefined);

export function nextRef(panel: Panel, def: ModuleDef | undefined): string | undefined {
  const prefix = refCodeOf(def);
  return prefix === undefined ? undefined : `${prefix}${highestNumber(panel, prefix) + 1}`;
}

/**
 * Gives every placed device without a designation the code of its kind and the next number of that
 * code, in reading order. Numbers go on from the highest one in use, so a typed designation is never
 * replaced and none is given twice. Modules on the shelf are not numbered.
 */
export function numberDevices(panel: Panel, resolve: (ref: ModuleRef) => ModuleDef | undefined): { panel: Panel; numbered: number } {
  const next = new Map<string, number>();
  const given = new Map<string, string>();
  for (const placement of readingOrder(panel)) {
    if (placement.ref !== undefined) continue;
    const prefix = refCodeOf(resolve(placement.module));
    if (prefix === undefined) continue;
    const number = (next.get(prefix) ?? highestNumber(panel, prefix)) + 1;
    next.set(prefix, number);
    given.set(placement.id, `${prefix}${number}`);
  }
  const placements = panel.placements.map((p) => {
    const ref = given.get(p.id);
    return ref === undefined ? p : { ...p, ref };
  });
  return { panel: given.size > 0 ? { ...panel, placements } : panel, numbered: given.size };
}

/** How a device is named in lists and on the schematic: its designation first, when it has one. */
export function designated(item: { ref?: string }, name: string): string {
  return item.ref === undefined ? name : `${item.ref} ${name}`;
}

/** Two devices with one designation make the drawings ambiguous; a module on the shelf counts, as it may come back. */
export function findRefFindings(panel: Panel, resolve: (ref: ModuleRef) => ModuleDef | undefined): Finding[] {
  const byRef = new Map<string, Array<{ id: string; ref?: string; label?: string; module: ModuleRef }>>();
  for (const item of [...panel.placements, ...panel.shelf]) {
    if (item.ref !== undefined) byRef.set(item.ref, [...(byRef.get(item.ref) ?? []), item]);
  }
  return [...byRef]
    .filter(([, items]) => items.length > 1)
    .map(([ref, items]) => ({
      message: `Designation ${ref} is given to ${items.map((i) => `${i.label ?? resolve(i.module)?.name ?? i.module.moduleId} [${i.id}]`).join(', ')}`,
      severity: 'advice' as const,
      wires: [],
      nodes: [],
      placements: items.filter((i) => panel.placements.some((p) => p.id === i.id)).map((i) => i.id),
    }));
}

/** A device, as the designations and the legend count them: a kind that has a letter code. */
export const isDevice = (def: ModuleDef | undefined): boolean => refCodeOf(def) !== undefined;
