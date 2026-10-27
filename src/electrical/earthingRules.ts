import type { Project } from '../project';
import type { Resolve } from './context';
import { PEN_MIN_SECTION_MM2, earthingProblem } from './earthing';
import { SWITCHING_KINDS } from './energy';
import { nodeTerminalsLookup } from './nodeTerminals';
import type { RuleFinding } from './rules';
import { terminalsOf } from './terminals';

const about = (message: string, nodes: string[], placements: string[] = []): RuleFinding => ({ message, nodes, placements });

/** What the earthing system of a source asks of the rest: the conductors it gives, the PEN conductor's size, and that a PEN is never switched. */
export function earthingFindings(project: Project, resolve: Resolve, name: (nodeId: string) => string): RuleFinding[] {
  const { schematic, panel } = project;
  const nodeTerminals = nodeTerminalsLookup(panel, resolve);
  const conductorOf = (ref: { node: string; terminal: string }) => {
    const node = schematic.nodes.find((n) => n.id === ref.node);
    return node && nodeTerminals(node)?.find((t) => t.id === ref.terminal)?.conductor;
  };

  const fromSources = schematic.nodes.flatMap((node) => {
    const problem = node.kind === 'source' && node.earthing && node.conductors ? earthingProblem(node.earthing, node.conductors) : null;
    return problem ? [about(`${name(node.id)} [${node.id}]: ${problem}`, [node.id])] : [];
  });

  const fromWires = schematic.wires.flatMap((wire) => {
    const small = wire.crossSectionMm2 !== undefined && wire.crossSectionMm2 < PEN_MIN_SECTION_MM2;
    return small && conductorOf(wire.a) === 'PEN'
      ? [about(`wire ${wire.id}: a PEN conductor of ${wire.crossSectionMm2} mm2 is below the minimum of ${PEN_MIN_SECTION_MM2} mm2 (copper)`, [wire.a.node, wire.b.node])]
      : [];
  });

  const fromModules = panel.placements.flatMap((placement) => {
    const def = resolve(placement.module);
    const switchesPen = def && SWITCHING_KINDS.includes(def.kind) && terminalsOf(def, placement.widthUnits ?? def.widthUnits).some((t) => t.conductor === 'PEN');
    return switchesPen ? [about(`${placement.label ?? def.name} [${placement.id}]: a PEN conductor must not pass through a switching device`, [], [placement.id])] : [];
  });

  return [...fromSources, ...fromWires, ...fromModules];
}
