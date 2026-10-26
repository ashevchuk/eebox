import type { Project } from '../project';
import type { CableSettings } from './cables';
import { netContextOf, type Resolve } from './context';
import type { LoadReport } from './loads';
import { PROTECTIVE_KINDS } from './loads';

const MOHM_PER_OHM = 1000;

/** The largest value among the sources that state one: with several sources the worst case counts. */
function worstOfSources(project: Project, key: 'shortCircuitKA' | 'loopImpedanceMOhm'): number | undefined {
  const values = project.schematic.nodes.flatMap((n) => (n.kind === 'source' && n[key] !== undefined ? [n[key]] : []));
  return values.length === 0 ? undefined : Math.max(...values);
}

/**
 * Checks that need what is known of the supply. A breaker must be able to break the prospective
 * short-circuit current, and the fault current at the end of each cable must be large enough to
 * trip its breaker at once. Both are conservative estimates: the impedance of the cables upstream
 * is ignored for the first, and any RCD upstream is ignored for the second.
 */
export function protectionWarnings(
  project: Project,
  resolve: Resolve,
  settings: CableSettings,
  reports: LoadReport[],
  name: (nodeId: string) => string,
): string[] {
  const context = netContextOf(project, resolve);
  const warnings: string[] = [];

  const shortCircuitKA = worstOfSources(project, 'shortCircuitKA');
  if (shortCircuitKA !== undefined) {
    for (const placement of project.panel.placements) {
      const def = context.defs.get(placement.id);
      const wired = (context.terminals.get(placement.id) ?? []).some((t) => context.netOf.has(t.key));
      if (!wired || !def?.breakingCapacityKA || !PROTECTIVE_KINDS.includes(def.kind)) continue;
      if (def.breakingCapacityKA < shortCircuitKA) {
        warnings.push(
          `${placement.label ?? def.name} [${placement.id}]: its breaking capacity of ${def.breakingCapacityKA} kA is below the prospective short-circuit current of ${shortCircuitKA} kA`,
        );
      }
    }
  }

  const sourceMOhm = worstOfSources(project, 'loopImpedanceMOhm');
  if (sourceMOhm === undefined) return warnings;
  for (const report of reports) {
    if (report.breakerPlacementId === undefined || report.lengthM === undefined || report.chosenSectionMm2 === undefined) continue;
    const placement = project.panel.placements.find((p) => p.id === report.breakerPlacementId);
    const def = placement && context.defs.get(placement.id);
    if (!def?.curve || def.residualCurrentMa !== undefined || !def.ratedCurrentA) continue;
    const loopResistance = (2 * settings.resistivityOhmMm2PerM * report.lengthM) / report.chosenSectionMm2;
    const loopReactance = 2 * settings.reactanceOhmPerM * report.lengthM;
    const impedanceMOhm = Math.hypot(sourceMOhm / MOHM_PER_OHM + loopResistance, loopReactance) * MOHM_PER_OHM;
    const faultA = (settings.faultVoltageV * MOHM_PER_OHM) / impedanceMOhm;
    const needsA = settings.tripMultiples[def.curve] * def.ratedCurrentA;
    if (faultA < needsA) {
      warnings.push(
        `${name(report.nodeId)} [${report.nodeId}]: a fault at the end of ${report.lengthM} m of ${report.chosenSectionMm2} mm2 gives about ${Math.round(faultA)} A, below the ${Math.round(needsA)} A that trips its ${def.curve}${def.ratedCurrentA} breaker at once (an RCD upstream would disconnect it instead)`,
      );
    }
  }
  return warnings;
}
