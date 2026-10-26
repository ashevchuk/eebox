import type { ModuleRef, Panel } from '../layout/placement';
import type { ModuleDef } from '../library/types';
import type { Project } from '../project';

/** A label for one module, as wide as the module on its rail. */
export interface StripCell {
  /** Distance from the start of its line, in module units. */
  offsetUnits: number;
  widthUnits: number;
  text: string;
}

/** The labels of a stretch of one rail; a rail longer than a sheet is cut into several lines. */
export interface StripLine {
  rail: number;
  railLabel?: string;
  cells: StripCell[];
}

/** Units that fit across an A4 sheet in landscape with margins at 17.5 mm each: 262.5 mm of 277. */
export const STRIP_LINE_UNITS = 15;

/**
 * The label of every module, in the order of its rail. A new line starts at the first module that
 * would not end within `maxUnits` of the start of the line, so no module is split.
 */
export function labelStrips(
  panel: Panel,
  resolve: (ref: ModuleRef) => ModuleDef | undefined,
  maxUnits: number = STRIP_LINE_UNITS,
): StripLine[] {
  return panel.railLengthsUnits.flatMap((_length, rail): StripLine[] => {
    const modules = panel.placements.filter((p) => p.rail === rail).sort((a, b) => a.slot - b.slot);
    const lines: Array<{ start: number; cells: StripCell[] }> = [];
    for (const placement of modules) {
      const def = resolve(placement.module);
      const widthUnits = placement.widthUnits ?? def?.widthUnits ?? 1;
      let line = lines[lines.length - 1];
      if (!line || placement.slot + widthUnits - line.start > maxUnits) {
        line = { start: placement.slot, cells: [] };
        lines.push(line);
      }
      line.cells.push({
        offsetUnits: placement.slot - line.start,
        widthUnits,
        text: placement.label ?? def?.name ?? placement.module.moduleId,
      });
    }
    const railLabel = panel.railLabels[rail];
    return lines.map((line) => ({ rail, ...(railLabel ? { railLabel } : {}), cells: line.cells }));
  });
}

/** A marker for the end of a cable; every cable has two ends, so `copies` is two. */
export interface CableMarker {
  text: string;
  /** What else tells the cable apart, such as its cores and cross-section. */
  detail?: string;
  copies: number;
}

const CABLE_ENDS = 2;

/**
 * One marker per load that has a wire, named after the load, with its cable when one was chosen,
 * and one per distinct wire label that is not already such a name.
 */
export function cableMarkers(project: Project): CableMarker[] {
  const { nodes, wires } = project.schematic;
  const wired = new Set(wires.flatMap((w) => [w.a.node, w.b.node]));
  const loads = nodes
    .filter((n) => n.kind === 'load' && wired.has(n.id))
    .map((n): CableMarker => {
      const section = n.load?.crossSectionMm2;
      return {
        text: n.label,
        ...(section !== undefined ? { detail: `${n.conductors?.length ?? 0}x${section} mm2` } : {}),
        copies: CABLE_ENDS,
      };
    });
  const taken = new Set(loads.map((m) => m.text));
  const labels = [...new Set(wires.flatMap((w) => (w.label ? [w.label] : [])))].filter((text) => !taken.has(text));
  return [...loads, ...labels.map((text): CableMarker => ({ text, copies: CABLE_ENDS }))];
}
