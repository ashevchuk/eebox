import { normalizeLabel } from '../layout/labels';
import type { Schematic } from './model';

export const DEFAULT_WIRE_PATTERN = 'W{n}';
const PLACEHOLDER = '{n}';

export type NumberWiresResult =
  | { ok: true; schematic: Schematic; numbered: number }
  | { ok: false; error: 'no-placeholder' | 'invalid-label' };

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Gives every wire that has no label one made from the pattern, `{n}` being the number. Numbers go on
 * from the highest one that a label of the same pattern already has, so nothing is numbered twice and a
 * label that was typed is never replaced.
 */
export function numberWires(schematic: Schematic, typed: string): NumberWiresResult {
  const pattern = typed.trim();
  const at = pattern.indexOf(PLACEHOLDER);
  if (at < 0 || pattern.indexOf(PLACEHOLDER, at + 1) >= 0) return { ok: false, error: 'no-placeholder' };
  const before = pattern.slice(0, at);
  const after = pattern.slice(at + PLACEHOLDER.length);
  const used = new RegExp(`^${escaped(before)}(\\d+)${escaped(after)}$`);
  const highest = Math.max(0, ...schematic.wires.map((w) => Number(used.exec(w.label ?? '')?.[1] ?? 0)));

  let next = highest;
  const wires = schematic.wires.map((wire) => {
    if (wire.label !== undefined) return wire;
    next += 1;
    return { ...wire, label: `${before}${next}${after}` };
  });
  const numbered = next - highest;
  if (numbered > 0 && !normalizeLabel(`${before}${next}${after}`).ok) return { ok: false, error: 'invalid-label' };
  return { ok: true, schematic: { ...schematic, wires }, numbered };
}
