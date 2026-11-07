import { terminalsOf, type Terminal } from '../electrical/terminals';
import { ductsOf } from '../layout/ducts';
import { isOnRail, type CombPlacement, type ModuleRef, type Panel, type RailPlacement, type Sizes } from '../layout/placement';
import { isVertical } from '../layout/rail';
import { MODULE_UNIT_MM, type ModuleDef } from '../library/types';
import { FRAME_PADDING, ductRect, frameRect, levelLabelEdge, placementRect, rowRect, type Rect } from './geometry';

export const PIN_SPACING_MM = 5;
const LABEL_GAP_MM = 3;
const LABEL_MAX_MM = 60;
const LABEL_HALF_WIDTH_MM = 4;
const LABEL_HALF_HEIGHT_MM = 3;

/** How far along the length of a module a terminal's dot is: terminals that share a unit stand side by side. */
export function terminalAlong(terminals: readonly Terminal[], terminal: Terminal): number {
  const sharing = terminals.filter((t) => t.side === terminal.side && t.unit === terminal.unit);
  const offset = (sharing.indexOf(terminal) - (sharing.length - 1) / 2) * PIN_SPACING_MM;
  return (terminal.unit + 0.5) * MODULE_UNIT_MM + offset;
}

/** Where the dot of a terminal is across an upright module. */
export function terminalX(terminals: readonly Terminal[], terminal: Terminal, body: Rect): number {
  return body.x + terminalAlong(terminals, terminal);
}

/**
 * A name over a terminal of a terminal block, and how far it may run. On a horizontal rail it reads upwards from
 * (x, y); on a vertical one, where the top terminals face right, it reads to the right from (x, y).
 */
export interface TerminalLabel {
  text: string;
  x: number;
  y: number;
  maxLength: number;
  direction: 'up' | 'right';
}

/**
 * The names that the person gave to the top terminals of terminal blocks, printed over them as on a wiring
 * drawing: upwards over a block on a horizontal rail, to the right of one on a vertical rail. A terminal
 * without a name of its own is left bare, and a name runs only as far as the nearest thing in its way, or
 * the edge of the plate.
 */
export function terminalLabels(panel: Panel, sizes: Sizes, resolve: (ref: ModuleRef) => ModuleDef | undefined): TerminalLabel[] {
  const rows = panel.rails.map((_r, i) => rowRect(panel, sizes, i));
  const ducts = ductsOf(panel).map(ductRect);
  const combInfoOf = (comb: CombPlacement) => {
    const def = resolve(comb.module);
    return def?.comb ? { widthUnits: sizes.widthOf(comb) ?? def.widthUnits, side: def.comb.side } : undefined;
  };
  const edgeRight = frameRect(panel).width - FRAME_PADDING;
  const labels: TerminalLabel[] = [];
  for (const placement of panel.placements) {
    const def = resolve(placement.module);
    if (def?.kind !== 'terminal' || !placement.terminalLabels) continue;
    const body = placementRect(panel, sizes, placement);
    const terminals = terminalsOf(def, sizes.widthOf(placement) ?? def.widthUnits);
    const hindrances = [...rows, ...ducts, ...panel.placements.filter((p) => p.id !== placement.id).map((p) => placementRect(panel, sizes, p))];
    const upright = !isOnRail(placement) || !isVertical(panel.rails[placement.rail]);
    for (const terminal of terminals) {
      const text = placement.terminalLabels[terminal.id];
      if (terminal.side !== 'top' || text === undefined) continue;
      if (upright) {
        const x = terminalX(terminals, terminal, body);
        const y = body.y - LABEL_GAP_MM;
        const ceiling = Math.max(
          FRAME_PADDING,
          ...hindrances
            .filter((r) => r.x < x + LABEL_HALF_WIDTH_MM && x - LABEL_HALF_WIDTH_MM < r.x + r.width && r.y + r.height <= y)
            .map((r) => r.y + r.height),
        );
        const maxLength = Math.min(LABEL_MAX_MM, y - ceiling - LABEL_GAP_MM);
        if (maxLength > 0) labels.push({ text, x, y, maxLength, direction: 'up' });
      } else {
        const x = levelLabelEdge(panel, sizes, combInfoOf, body, (placement as RailPlacement).rail, 'right') + LABEL_GAP_MM;
        const y = body.y + terminalAlong(terminals, terminal);
        const wall = Math.min(
          edgeRight,
          ...hindrances.filter((r) => r.x >= x - LABEL_GAP_MM && r.y < y + LABEL_HALF_HEIGHT_MM && y - LABEL_HALF_HEIGHT_MM < r.y + r.height).map((r) => r.x),
        );
        const maxLength = Math.min(LABEL_MAX_MM, wall - x - LABEL_GAP_MM);
        if (maxLength > 0) labels.push({ text, x, y, maxLength, direction: 'right' });
      }
    }
  }
  return labels;
}

/** The box a label occupies, for a drawing that has to include it; `measure` is the length of a text in mm. */
export function labelBox(label: TerminalLabel, measure: (text: string) => number): Rect {
  const length = Math.min(measure(label.text), label.maxLength);
  if (label.direction === 'right') return { x: label.x, y: label.y - LABEL_HALF_HEIGHT_MM, width: length, height: 2 * LABEL_HALF_HEIGHT_MM };
  return { x: label.x - LABEL_HALF_WIDTH_MM, y: label.y - length, width: 2 * LABEL_HALF_WIDTH_MM, height: length };
}
