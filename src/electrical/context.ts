import type { ModuleRef } from '../layout/placement';
import type { ModuleDef } from '../library/types';
import type { Project } from '../project';
import { buildNets, type Net } from './nets';
import { terminalsOf, type Terminal } from './terminals';

export type Resolve = (ref: ModuleRef) => ModuleDef | undefined;

/** Bars and terminal blocks pass current through without limiting it. */
export const PASSIVE_KINDS: readonly ModuleDef['kind'][] = ['busbar', 'terminal'];

export interface NetContext {
  project: Project;
  nets: Net[];
  netOf: Map<string, Net>;
  /** Placed modules whose definition is known, by placement id. */
  defs: Map<string, ModuleDef>;
  /** Terminals of each placed module with their net keys. */
  terminals: Map<string, { key: string; terminal: Terminal }[]>;
}

export function netContextOf(project: Project, resolve: Resolve): NetContext {
  const nets = buildNets(project, resolve);
  const netOf = new Map<string, Net>();
  for (const net of nets) for (const t of net.terminals) netOf.set(t.key, net);
  const defs = new Map<string, ModuleDef>();
  const terminals = new Map<string, { key: string; terminal: Terminal }[]>();
  for (const placement of project.panel.placements) {
    const def = resolve(placement.module);
    if (!def) continue;
    defs.set(placement.id, def);
    terminals.set(
      placement.id,
      terminalsOf(def, placement.widthUnits ?? def.widthUnits).map((terminal) => ({
        key: `p:${placement.id}/${terminal.id}`,
        terminal,
      })),
    );
  }
  return { project, nets, netOf, defs, terminals };
}
