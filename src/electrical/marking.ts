import type { Project } from '../project';
import { familyOf } from '../library/types';
import { netContextOf, type Resolve } from './context';
import { directionOf } from './direction';
import { PROTECTIVE_KINDS } from './loads';

const RESIDUAL_CURRENT_KINDS: readonly string[] = ['rcd', 'rcbo'];

/** What the marking of one module is worked out to be, before anything set by hand. */
export interface DerivedMarking {
  /** The placement id of the nearest RCD or RCBO that feeds it, the device itself included. */
  rcd?: string;
  /** Labels of the loads it protects, in the order of the schematic. */
  loads: string[];
}

/**
 * The group and the loads of every placed module, from the wiring. Upstream follows the phase
 * inputs to the devices whose outputs feed them, nearest first; downstream follows the phase outputs
 * to loads, through switches, contactors and bars, and stops at the next breaker, RCBO or fuse,
 * whose circuit the load is then.
 */
export function deriveMarking(project: Project, resolve: Resolve): Map<string, DerivedMarking> {
  const context = netContextOf(project, resolve);
  const { netOf, defs, terminals } = context;
  const direction = directionOf(context);
  const phaseKeys = (id: string, pick: (key: string) => boolean): string[] =>
    (terminals.get(id) ?? []).filter((t) => familyOf(t.terminal.conductor) === 'phase' && pick(t.key)).map((t) => t.key);

  function nearestRcd(start: string): string | undefined {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (RESIDUAL_CURRENT_KINDS.includes(defs.get(id)?.kind ?? '')) return id;
      for (const key of phaseKeys(id, direction.isInput)) {
        for (const t of netOf.get(key)?.terminals ?? []) {
          if (t.owner.kind !== 'placement' || seen.has(t.owner.id) || !direction.isOutput(t.key)) continue;
          seen.add(t.owner.id);
          queue.push(t.owner.id);
        }
      }
    }
    return undefined;
  }

  function loadsOf(start: string): string[] {
    const seen = new Set([start]);
    const queue = [start];
    const found = new Set<string>();
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const key of phaseKeys(id, direction.isOutput)) {
        for (const t of netOf.get(key)?.terminals ?? []) {
          if (t.owner.kind === 'node') {
            const node = project.schematic.nodes.find((n) => n.id === t.owner.id);
            if (node?.kind === 'load') found.add(node.id);
            continue;
          }
          if (seen.has(t.owner.id) || !direction.isInput(t.key)) continue;
          seen.add(t.owner.id);
          if (!PROTECTIVE_KINDS.includes(defs.get(t.owner.id)?.kind ?? '')) queue.push(t.owner.id);
        }
      }
    }
    return project.schematic.nodes.filter((n) => found.has(n.id)).map((n) => n.label);
  }

  const derived = new Map<string, DerivedMarking>();
  for (const placement of project.panel.placements) {
    const rcd = nearestRcd(placement.id);
    derived.set(placement.id, { ...(rcd ? { rcd } : {}), loads: loadsOf(placement.id) });
  }
  return derived;
}
