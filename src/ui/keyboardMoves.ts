import { isFree, isOnRail, type Panel } from '../layout/placement';
import { isVertical } from '../layout/rail';
import type { Schematic } from '../schematic/model';

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export const ARROWS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/** A module unit, or a quarter of one with Alt for the fine adjustments that real widths need. */
const FINE_STEP_UNITS = 0.25;
export const NODE_STEP_MM = 10;
export const NODE_BIG_STEP_MM = 50;

/**
 * How many rows and units an arrow key moves modules: along the rail and between rails. Along a horizontal
 * rail is left and right and between rails up and down; on a vertical rail it is the other way round.
 */
export function panelStep(key: Arrow, fine: boolean, vertical = false): { rail: number; slot: number } {
  const unit = fine ? FINE_STEP_UNITS : 1;
  const sign = (negative: Arrow, positive: Arrow) => (key === negative ? -1 : key === positive ? 1 : 0);
  return vertical
    ? { rail: sign('ArrowLeft', 'ArrowRight'), slot: sign('ArrowUp', 'ArrowDown') * unit }
    : { rail: sign('ArrowUp', 'ArrowDown'), slot: sign('ArrowLeft', 'ArrowRight') * unit };
}

/** True when every chosen module and comb that stands on a rail stands on a vertical one, so the arrows run the other way round. */
export function onVerticalRails(panel: Panel, placementIds: readonly string[], combIds: readonly string[]): boolean {
  const rails = [
    ...panel.placements.filter(isOnRail).filter((p) => placementIds.includes(p.id)).map((p) => p.rail),
    ...panel.combs.filter((c) => combIds.includes(c.id)).map((c) => c.rail),
  ];
  return rails.length > 0 && rails.every((rail) => isVertical(panel.rails[rail]));
}

/** How far an arrow key moves a device on the plate or a duct, in millimetres: 1, with Shift 10, with Alt 0.5. */
export function plateStep(key: Arrow, shift: boolean, alt: boolean): { dx: number; dy: number } {
  const step = alt ? 0.5 : shift ? 10 : 1;
  return { dx: key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, dy: key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0 };
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

/** The module Tab goes to: by row, then by position along the row, and last the devices on the plate from the top down. */
export function nextModuleId(panel: Panel, selected: readonly string[], backwards: boolean): string | null {
  const railed = panel.placements.filter(isOnRail).sort((a, b) => a.rail - b.rail || a.slot - b.slot || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const plated = panel.placements.filter(isFree).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const ordered = [...railed, ...plated];
  return around(ordered, selected, backwards);
}

/** The node Tab goes to: from the top of the schematic down, left to right. */
export function nextNodeId(schematic: Schematic, selected: readonly string[], backwards: boolean): string | null {
  const ordered = [...schematic.nodes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return around(ordered, selected, backwards);
}
