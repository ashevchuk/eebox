import { ductsOf } from '../layout/ducts';
import type { Project } from '../project';
import type { Resolve } from './context';
import type { Finding } from './problems';
import { wireList } from './schedule';

/** The share of a duct's cross-section that wires may take before the advice says it is too full. */
export const DUCT_FILL_LIMIT_PERCENT = 50;

/**
 * Outer diameter in mm of a flexible single-core conductor with PVC insulation, by cross-section in mm2.
 * Typical values, NOT checked against a standard or a maker's sheet: a real cable is a little thicker or thinner.
 */
export const WIRE_DIAMETER_MM: Readonly<Record<number, number>> = { 1.5: 3.2, 2.5: 3.9, 4: 4.6, 6: 5.2, 10: 6.9, 16: 8.4, 25: 10.5, 35: 11.9 };

export interface DuctFill {
  ductId: string;
  /** The wires said to run in the duct whose cross-section is known, and so are counted. */
  counted: string[];
  /** The wires said to run in it that have no cross-section, which cannot be counted. */
  uncounted: string[];
  /** Area of the wires, in mm2. */
  wiresMm2: number;
  /** Cross-section of the inside of the duct, in mm2: its narrower side times its depth. */
  ductMm2: number;
  percent: number;
}

const areaOfWire = (sectionMm2: number): number | undefined => {
  const diameter = WIRE_DIAMETER_MM[sectionMm2];
  return diameter === undefined ? undefined : (Math.PI * diameter * diameter) / 4;
};

/** How full each duct is whose depth is known; the wires that are said to run in a duct are summed by their outer size. */
export function ductFills(project: Project, resolve: Resolve): DuctFill[] {
  const rows = new Map(wireList(project, resolve).map((row) => [row.wireId, row]));
  return ductsOf(project.panel).flatMap((duct) => {
    if (duct.depthMm === undefined) return [];
    const counted: string[] = [];
    const uncounted: string[] = [];
    let wiresMm2 = 0;
    for (const wire of project.schematic.wires.filter((w) => w.duct === duct.id)) {
      const section = rows.get(wire.id)?.sectionMm2;
      const area = section === undefined ? undefined : areaOfWire(section);
      if (area === undefined) uncounted.push(wire.id);
      else {
        counted.push(wire.id);
        wiresMm2 += area;
      }
    }
    const ductMm2 = Math.min(duct.widthMm, duct.heightMm) * duct.depthMm;
    return [{ ductId: duct.id, counted, uncounted, wiresMm2, ductMm2, percent: (wiresMm2 / ductMm2) * 100 }];
  });
}

/** Advice for every duct that is filled past the limit. */
export function findDuctFillFindings(project: Project, resolve: Resolve): Finding[] {
  return ductFills(project, resolve)
    .filter((fill) => fill.percent > DUCT_FILL_LIMIT_PERCENT)
    .map((fill) => {
      const duct = ductsOf(project.panel).find((d) => d.id === fill.ductId)!;
      return {
        message: `${duct.label ?? duct.id} is ${Math.round(fill.percent)} % full of wires; keep it under ${DUCT_FILL_LIMIT_PERCENT} %.`,
        severity: 'advice' as const,
        wires: fill.counted,
        nodes: [],
        placements: [],
        ducts: [fill.ductId],
      };
    });
}
