import type { Project } from '../project';
import type { CableSettings } from './cables';
import { DEFAULT_CABLE_SETTINGS } from './cables';
import type { Resolve } from './context';
import { formatAmps, loadReports, type LoadReport } from './loads';
import { findRuleFindings, ownerName } from './rules';

export type CheckStatus = 'ok' | 'warning' | 'unknown';
export const CHECK_IDS = ['cable', 'drop', 'breaker', 'rcd', 'earth'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface Check {
  id: CheckId;
  status: CheckStatus;
  /** One short word for a cell. */
  text: string;
  /** The reason, with the numbers. */
  detail: string;
}

export interface CircuitSummary {
  nodeId: string;
  load: string;
  currentA: number;
  checks: Check[];
  /** `attention` when something is wrong, `incomplete` when nothing is wrong but something is not known yet. */
  result: 'ok' | 'attention' | 'incomplete';
}

const ok = (id: CheckId, text: string, detail: string): Check => ({ id, status: 'ok', text, detail });
const warning = (id: CheckId, text: string, detail: string): Check => ({ id, status: 'warning', text, detail });
const unknown = (id: CheckId, text: string, detail: string): Check => ({ id, status: 'unknown', text, detail });

function cableCheck(report: LoadReport): Check {
  const { chosenSectionMm2: chosen, chosenAmpacityA: ampacity, requiredA, minimumSectionMm2: minimum } = report;
  if (chosen === undefined || ampacity === undefined) {
    return unknown('cable', 'not chosen', minimum === undefined ? `no listed cross-section carries ${formatAmps(requiredA)} A` : `choose at least ${minimum} mm2 for ${formatAmps(requiredA)} A`);
  }
  return ampacity < requiredA
    ? warning('cable', 'too small', `${chosen} mm2 carries ${ampacity} A, ${formatAmps(requiredA)} A is needed`)
    : ok('cable', 'ok', `${chosen} mm2 carries ${ampacity} A, ${formatAmps(requiredA)} A is needed`);
}

function dropCheck(report: LoadReport): Check {
  if (report.dropPercent === undefined) return unknown('drop', 'no length', 'give the cable length to see the voltage drop');
  const detail = `${report.dropPercent.toFixed(1)} % over ${report.lengthM} m, the limit is ${report.dropLimitPercent} %`;
  return report.dropPercent > report.dropLimitPercent ? warning('drop', 'too high', detail) : ok('drop', 'ok', detail);
}

function breakerCheck(report: LoadReport): Check {
  const { breakerA, chosenAmpacityA, currentA } = report;
  if (breakerA === undefined) return unknown('breaker', 'none found', 'no breaker is wired straight to this load');
  if (currentA > breakerA) return warning('breaker', 'too small', `the load draws ${formatAmps(currentA)} A, the breaker is rated ${breakerA} A`);
  if (chosenAmpacityA !== undefined && breakerA > chosenAmpacityA) return warning('breaker', 'above cable', `the breaker of ${breakerA} A does not protect a cable that carries ${chosenAmpacityA} A`);
  return ok('breaker', 'ok', `${breakerA} A for ${formatAmps(currentA)} A${chosenAmpacityA === undefined ? '' : `, the cable carries ${chosenAmpacityA} A`}`);
}

/** For each load that has a power: whether its cable, voltage drop, breaker, RCD and earth hold, and why not. */
export function circuitSummaries(project: Project, resolve: Resolve, settings: CableSettings = DEFAULT_CABLE_SETTINGS): CircuitSummary[] {
  const findings = findRuleFindings(project, resolve, settings);
  const found = (rule: 'open-earth' | 'no-rcd', nodeId: string) => findings.some((f) => f.rule === rule && f.nodes.includes(nodeId));
  const earthCheck = (nodeId: string): Check => {
    const conductors = project.schematic.nodes.find((n) => n.id === nodeId)?.conductors ?? [];
    if (!conductors.some((c) => c === 'PE' || c === 'PEN')) return unknown('earth', 'no PE', 'the load has no protective earth terminal');
    return found('open-earth', nodeId) ? warning('earth', 'open', 'protective earth is not connected') : ok('earth', 'ok', 'protective earth is connected');
  };
  return loadReports(project, resolve, settings).map((report) => {
    const checks: Check[] = [
      cableCheck(report),
      dropCheck(report),
      breakerCheck(report),
      found('no-rcd', report.nodeId) ? warning('rcd', 'none', 'it is fed without passing an RCD or RCBO') : ok('rcd', 'ok', 'no path from a source without an RCD or RCBO was found'),
      earthCheck(report.nodeId),
    ];
    const result = checks.some((c) => c.status === 'warning') ? 'attention' : checks.some((c) => c.status === 'unknown') ? 'incomplete' : 'ok';
    return { nodeId: report.nodeId, load: ownerName(project, resolve, { kind: 'node', id: report.nodeId }), currentA: report.currentA, checks, result };
  });
}
