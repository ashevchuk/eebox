import type { ModuleRef, Panel } from '../layout/placement';
import type { Conductor, ModuleDef } from '../library/types';
import type { SchematicNode } from '../schematic/model';
import { terminalId, terminalsOf, type Terminal } from './terminals';

export const FREE_NODE_PRESETS = {
  source1: { kind: 'source', label: 'Mains 1-phase', conductors: ['L', 'N', 'PE'] },
  source3: { kind: 'source', label: 'Mains 3-phase', conductors: ['L1', 'L2', 'L3', 'N', 'PE'] },
  load1: { kind: 'load', label: 'Load 1-phase', conductors: ['L', 'N', 'PE'] },
  load3: { kind: 'load', label: 'Load 3-phase', conductors: ['L1', 'L2', 'L3', 'N', 'PE'] },
} as const satisfies Record<string, { kind: 'source' | 'load'; label: string; conductors: Conductor[] }>;

/** A source feeds downwards, so its terminals are on the bottom; a load takes from above. */
export function freeNodeTerminals(node: SchematicNode): Terminal[] {
  const side = node.kind === 'source' ? 'bottom' : 'top';
  return (node.conductors ?? []).map((conductor, unit) => ({
    id: terminalId(side, conductor),
    name: conductor,
    conductor,
    side,
    unit,
  }));
}

/** Resolves the terminals of any node of a project: from the module for module nodes, own for the rest. */
export function nodeTerminalsLookup(
  panel: Panel,
  resolve: (ref: ModuleRef) => ModuleDef | undefined,
): (node: SchematicNode) => Terminal[] | undefined {
  return (node) => {
    if (node.kind !== 'module') return freeNodeTerminals(node);
    const placement = panel.placements.find((p) => p.id === node.placementId);
    const def = placement && resolve(placement.module);
    return def ? terminalsOf(def, placement.widthUnits ?? def.widthUnits) : undefined;
  };
}
