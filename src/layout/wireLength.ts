import type { Resolve } from '../electrical/context';
import { terminalsOf } from '../electrical/terminals';
import { MODULE_UNIT_MM } from '../library/types';
import type { Project } from '../project';
import { FRAME_PADDING, placementRect } from '../view/geometry';
import { DEFAULT_WIRE_SLACK_MM } from './limits';
import { lookupsOf } from './lookups';
import { isFree } from './placement';

/** What a wire adds for going from one plate to another, for example across a hinge to a door. */
export const CROSS_PLATE_MM = 300;

interface Spot {
  plate: string;
  x: number;
  y: number;
  plateWidthMm: number;
  plateHeightMm: number;
}

/** The nearest an edge of the plate is to a spot: a wire to another plate leaves this way. */
const edgeDistance = (s: Spot): number => Math.max(0, Math.min(s.x, s.plateWidthMm - s.x, s.y, s.plateHeightMm - s.y));

/**
 * Estimated length of each wire that runs between two modules that stand on the panel, in mm: the
 * distance between its terminals along and across the plate, with the slack of the panel; between
 * plates, the way out to the nearest edge on each plate and `CROSS_PLATE_MM`. A wire to a source, a
 * load or a module on the shelf has no place to measure from and is left out.
 */
export function wireRuns(project: Project, resolve: Resolve): Map<string, number> {
  const { panel, schematic } = project;
  const { sizes } = lookupsOf(resolve);
  const slack = panel.wireSlackMm ?? DEFAULT_WIRE_SLACK_MM;

  const spotOf = (ref: { node: string; terminal: string }): Spot | null => {
    const node = schematic.nodes.find((n) => n.id === ref.node);
    if (node?.kind !== 'module') return null;
    const placement = panel.placements.find((p) => p.id === node.placementId);
    const def = placement && resolve(placement.module);
    if (!placement || !def) return null;
    const terminal = terminalsOf(def, sizes.widthOf(placement) ?? def.widthUnits).find((t) => t.id === ref.terminal);
    const plate = panel.plates.find((p) => p.id === (isFree(placement) ? placement.plate : panel.rails[placement.rail]?.plate));
    if (!terminal || !plate) return null;
    const box = placementRect(panel, sizes, placement);
    return {
      plate: plate.id,
      x: box.x - FRAME_PADDING + terminal.unit * MODULE_UNIT_MM,
      y: (terminal.side === 'top' ? box.y : box.y + box.height) - FRAME_PADDING,
      plateWidthMm: plate.widthMm,
      plateHeightMm: plate.heightMm,
    };
  };

  const runs = new Map<string, number>();
  for (const wire of schematic.wires) {
    const a = spotOf(wire.a);
    const b = spotOf(wire.b);
    if (!a || !b) continue;
    const run = a.plate === b.plate ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : edgeDistance(a) + edgeDistance(b) + CROSS_PLATE_MM;
    runs.set(wire.id, Math.round(run + slack));
  }
  return runs;
}
