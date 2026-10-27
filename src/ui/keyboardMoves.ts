import type { Panel } from '../layout/placement';
import type { Schematic } from '../schematic/model';

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export const ARROWS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/** A module unit, or a quarter of one with Alt for the fine adjustments that real widths need. */
const FINE_STEP_UNITS = 0.25;
export const NODE_STEP_MM = 10;
export const NODE_BIG_STEP_MM = 50;

/** How many rows and units an arrow key moves modules: left and right along the rail, up and down between rails. */
export function panelStep(key: Arrow, fine: boolean): { rail: number; slot: number } {
  const unit = fine ? FINE_STEP_UNITS : 1;
  return { rail: key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0, slot: key === 'ArrowLeft' ? -unit : key === 'ArrowRight' ? unit : 0 };
}

/** How far an arrow key moves nodes of the schematic, in millimetres. */
export function nodeStep(key: Arrow, big: boolean): { dx: number; dy: number } {
  const step = big ? NODE_BIG_STEP_MM : NODE_STEP_MM;
  return { dx: key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, dy: key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0 };
}

/** The item after (or before) the selected one in reading order, wrapping round; the first or last when nothing is selected. */
function around<T extends { id: string }>(ordered: readonly T[], selected: readonly string[], backwards: boolean): string | null {
  if (ordered.length === 0) return null;
  const at = Math.max(-1, ...selected.map((id) => ordered.findIndex((item) => item.id === id)));
  if (at < 0) return ordered[backwards ? ordered.length - 1 : 0]!.id;
  return ordered[(at + (backwards ? -1 : 1) + ordered.length) % ordered.length]!.id;
}

/** The module Tab goes to: by row, then by position along the row. */
export function nextModuleId(panel: Panel, selected: readonly string[], backwards: boolean): string | null {
  const ordered = [...panel.placements].sort((a, b) => a.rail - b.rail || a.slot - b.slot || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return around(ordered, selected, backwards);
}

/** The node Tab goes to: from the top of the schematic down, left to right. */
export function nextNodeId(schematic: Schematic, selected: readonly string[], backwards: boolean): string | null {
  const ordered = [...schematic.nodes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return around(ordered, selected, backwards);
}
