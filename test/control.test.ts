import { describe, expect, it } from 'vitest';
import { buildNets, findNetProblems } from '../src/electrical/nets';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { wireCurrents } from '../src/electrical/loads';
import type { ModuleRef } from '../src/layout/placement';
import { CONDUCTORS, familyOf, type ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { projectWarnings } from '../src/project/file';
import { addNode, connect, connectAll, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place } from './fixtures';

const defs: Record<string, ModuleDef> = {
  changeover: {
    id: 'changeover', kind: 'switch', name: 'Changeover 2P', widthUnits: 4, poles: 2, ratedCurrentA: 40,
    terminals: [
      { name: 'La', conductor: 'L', side: 'top' }, { name: 'Na', conductor: 'N', side: 'top' },
      { name: 'Lb', conductor: 'L', side: 'top' }, { name: 'Nb', conductor: 'N', side: 'top' },
      { name: 'L', conductor: 'L', side: 'bottom' }, { name: 'N', conductor: 'N', side: 'bottom' },
    ],
  },
  relay: {
    id: 'relay', kind: 'relay', name: 'Relay', widthUnits: 1, poles: 2,
    terminals: [
      { name: 'L', conductor: 'L', side: 'top' }, { name: 'N', conductor: 'N', side: 'top' },
      { name: '11', conductor: 'C', side: 'bottom' }, { name: '14', conductor: 'C', side: 'bottom' },
    ],
  },
  psu: {
    id: 'psu', kind: 'psu', name: 'PSU 24 V', widthUnits: 2, poles: 2,
    terminals: [
      { name: 'L', conductor: 'L', side: 'top' },
      { name: '24V', conductor: 'DCP', side: 'bottom' }, { name: '0V', conductor: 'DCN', side: 'bottom' },
    ],
  },
};
const resolve = (r: ModuleRef): ModuleDef | undefined => defs[r.moduleId];

function sceneOf(moduleIds: string[]) {
  const panel = panelOf(moduleIds.map((id, i) => place(`p${i + 1}`, id, 0, i * 4)));
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const add = (node: Parameters<typeof addNode>[1]) => {
    schematic = addNode(schematic, node).schematic;
    return schematic.nodes[schematic.nodes.length - 1]!.id;
  };
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const wire = (a: [string, string], b: [string, string]) => {
    const result = connect(schematic, terminalsOf, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
    return schematic.wires[schematic.wires.length - 1]!.id;
  };
  return { panel, add, wire, terminalsOf, get schematic() { return schematic; }, set schematic(s: Schematic) { schematic = s; } };
}

describe('the control family', () => {
  it('holds the signal and DC conductors and nothing else', () => {
    expect(CONDUCTORS.filter((c) => familyOf(c) === 'control')).toEqual(['C', 'DCP', 'DCN']);
    expect(CONDUCTORS.filter((c) => familyOf(c) === 'phase')).toEqual(['L', 'L1', 'L2', 'L3']);
  });

  it('cannot be wired to phase, neutral or earth, but wires to other control conductors', () => {
    const s = sceneOf(['relay', 'psu']);
    expect(connect(s.schematic, s.terminalsOf, { node: 'n1', terminal: 'bottom:11' }, { node: 'n2', terminal: 'top:L' })).toEqual({
      ok: false,
      error: { kind: 'incompatible-conductors' },
    });
    expect(connect(s.schematic, s.terminalsOf, { node: 'n1', terminal: 'bottom:11' }, { node: 'n2', terminal: 'bottom:24V' }).ok).toBe(true);
  });

  it('wires all poles of two nodes by matching conductor, so contacts meet contacts', () => {
    const s = sceneOf(['relay']);
    const load = s.add({ kind: 'load', label: 'Signal', x: 0, y: 0, conductors: ['C', 'L'] });
    const result = connectAll(s.schematic, s.terminalsOf, 'n1', load);
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.schematic.wires.map((w) => `${w.a.terminal}>${w.b.terminal}`)).toEqual(['bottom:11>top:C']);
  });
});

describe('DC plus and minus', () => {
  it('are reported as a short circuit when they end up on one net', () => {
    const s = sceneOf(['psu']);
    const load = s.add({ kind: 'load', label: 'Lamp', x: 0, y: 0, conductors: ['DCP', 'DCN'] });
    s.wire(['n1', 'bottom:24V'], [load, 'top:DCP']);
    s.wire(['n1', 'bottom:0V'], [load, 'top:DCN']);
    const project: Project = { panel: s.panel, schematic: s.schematic };
    expect(findNetProblems(buildNets(project, resolve))).toEqual([]);
    s.wire(['n1', 'bottom:24V'], ['n1', 'bottom:0V']);
    const shorted: Project = { panel: s.panel, schematic: s.schematic };
    expect(findNetProblems(buildNets(shorted, resolve)).map((p) => p.kind)).toEqual(['mixed-polarity']);
    expect(projectWarnings(shorted, resolve).some((w) => w.startsWith('DC plus and minus joined'))).toBe(true);
  });
});

describe('currents through a changeover switch', () => {
  function withSources(count: 1 | 2) {
    const s = sceneOf(['changeover']);
    const mains = s.add({ kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L', 'N'] });
    const load = s.add({ kind: 'load', label: 'Load', x: 0, y: 0, conductors: ['L', 'N'], load: { powerW: 2300 } });
    const incomingA = s.wire([mains, 'bottom:L'], ['n1', 'top:La']);
    const outgoing = s.wire(['n1', 'bottom:L'], [load, 'top:L']);
    let incomingB: string | undefined;
    if (count === 2) {
      const generator = s.add({ kind: 'source', label: 'Generator', x: 0, y: 0, conductors: ['L', 'N'] });
      incomingB = s.wire([generator, 'bottom:L'], ['n1', 'top:Lb']);
    }
    const currents = wireCurrents({ panel: s.panel, schematic: s.schematic }, resolve);
    return { currents, incomingA, incomingB, outgoing };
  }

  it('shows the load current on every wire when there is one supply', () => {
    const { currents, incomingA, outgoing } = withSources(1);
    expect(currents.get(outgoing)).toBeCloseTo(10);
    expect(currents.get(incomingA)).toBeCloseTo(10);
  });

  it('shows it only below the switch when two supplies meet there, because either could carry it', () => {
    const { currents, incomingA, incomingB, outgoing } = withSources(2);
    expect(currents.get(outgoing)).toBeCloseTo(10);
    expect(currents.has(incomingA)).toBe(false);
    expect(currents.has(incomingB!)).toBe(false);
  });
});
