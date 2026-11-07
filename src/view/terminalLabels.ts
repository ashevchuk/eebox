import { terminalsOf, type Terminal } from '../electrical/terminals';
import { ductsOf } from '../layout/ducts';
import { isOnRail, type ModuleRef, type Panel, type Sizes } from '../layout/placement';
import { isVertical } from '../layout/rail';
import { MODULE_UNIT_MM, type ModuleDef } from '../library/types';
import { FRAME_PADDING, ductRect, placementRect, rowRect, type Rect } from './geometry';

export const PIN_SPACING_MM = 5;
const LABEL_GAP_MM = 3;
const LABEL_MAX_MM = 60;
const LABEL_HALF_WIDTH_MM = 4;

/** Where the dot of a terminal is across a module: terminals that share a unit stand side by side. */
export function terminalX(terminals: readonly Terminal[], terminal: Terminal, body: Rect): number {
  const sharing = terminals.filter((t) => t.side === terminal.side && t.unit === terminal.unit);
  const offset = (sharing.indexOf(terminal) - (sharing.length - 1) / 2) * PIN_SPACING_MM;
  return body.x + (terminal.unit + 0.5) * MODULE_UNIT_MM + offset;
}

/** A name over a terminal of a terminal block, read upwards from `y`, and how far up it may run. */
export interface TerminalLabel {
  text: string;
  x: number;
  y: number;
  maxLength: number;
}

/**
 * The names that the person gave to the top terminals of terminal blocks, printed upwards over them as
 * on a wiring drawing. A terminal without a name of its own is left bare, and a name runs only as far
 * as the nearest thing above it, or the edge of the plate.
 */
export function terminalLabels(panel: Panel, sizes: Sizes, resolve: (ref: ModuleRef) => ModuleDef | undefined): TerminalLabel[] {
  const rows = panel.rails.map((_r, i) => rowRect(panel, sizes, i));
  const ducts = ductsOf(panel).map(ductRect);
  const labels: TerminalLabel[] = [];
  for (const placement of panel.placements) {
    const def = resolve(placement.module);
    if (def?.kind !== 'terminal' || !placement.terminalLabels) continue;
    if (isOnRail(placement) && isVertical(panel.rails[placement.rail])) continue;
    const body = placementRect(panel, sizes, placement);
    const terminals = terminalsOf(def, sizes.widthOf(placement) ?? def.widthUnits);
    const hindrances = [...rows, ...ducts, ...panel.placements.filter((p) => p.id !== placement.id).map((p) => placementRect(panel, sizes, p))];
    for (const terminal of terminals) {
      const text = placement.terminalLabels[terminal.id];
      if (terminal.side !== 'top' || text === undefined) continue;
      const x = terminalX(terminals, terminal, body);
      const y = body.y - LABEL_GAP_MM;
      const ceiling = Math.max(
        FRAME_PADDING,
        ...hindrances
          .filter((r) => r.x < x + LABEL_HALF_WIDTH_MM && x - LABEL_HALF_WIDTH_MM < r.x + r.width && r.y + r.height <= y)
          .map((r) => r.y + r.height),
      );
      const maxLength = Math.min(LABEL_MAX_MM, y - ceiling - LABEL_GAP_MM);
      if (maxLength > 0) labels.push({ text, x, y, maxLength });
    }
  }
  return labels;
}

/** The box a label occupies, for a drawing that has to include it; `measure` is the length of a text in mm. */
export function labelBox(label: TerminalLabel, measure: (text: string) => number): Rect {
  const length = Math.min(measure(label.text), label.maxLength);
  return { x: label.x - LABEL_HALF_WIDTH_MM, y: label.y - length, width: 2 * LABEL_HALF_WIDTH_MM, height: length };
}
