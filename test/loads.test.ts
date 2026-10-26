import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { loadCurrentA, loadReports, loadSpecProblem, wireCurrents, type LoadSpec } from '../src/electrical/loads';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, syncModuleNodes, type Schematic, type SchematicNode } from '../src/schematic/model';
import { combAt, panelOf, place, resolve } from './fixtures';

const load = (conductors: SchematicNode['conductors'], spec?: LoadSpec): Omit<SchematicNode, 'id'> => ({
  kind: 'load', label: 'Load', x: 0, y: 0, conductors, ...(spec ? { load: spec } : {}),
});

describe('loadCurrentA', () => {
  it('divides a single-phase power by 230 V and the power factor', () => {
    expect(loadCurrentA({ ...load(['L', 'N', 'PE'], { powerW: 2300 }), id: 'n1' })).toBeCloseTo(10);
    expect(loadCurrentA({ ...load(['L', 'N', 'PE'], { powerW: 2300, powerFactor: 0.8 }), id: 'n1' })).toBeCloseTo(12.5);
  });

  it('divides a three-phase power by the square root of three, 400 V and the power factor', () => {
    expect(loadCurrentA({ ...load(['L1', 'L2', 'L3', 'N', 'PE'], { powerW: 3000 }), id: 'n1' })).toBeCloseTo(4.3301, 3);
  });

  it('has no current without a power, on a node that is not a load, or with two phases', () => {
    expect(loadCurrentA({ ...load(['L', 'N']), id: 'n1' })).toBeUndefined();
    expect(loadCurrentA({ ...load(['L', 'N'], { powerW: 100 }), kind: 'source', id: 'n1' })).toBeUndefined();
    expect(loadCurrentA({ ...load(['L1', 'L2'], { powerW: 100 }), id: 'n1' })).toBeUndefined();
  });
});

describe('loadSpecProblem', () => {
  it('accepts a power on its own and rejects what is out of range', () => {
    expect(loadSpecProblem({ powerW: 1 })).toBeNull();
    expect(loadSpecProblem({ powerW: 0 })).not.toBeNull();
    expect(loadSpecProblem({ powerW: Number.NaN })).not.toBeNull();
    expect(loadSpecProblem({ powerW: 100, powerFactor: 1.2 })).not.toBeNull();
    expect(loadSpecProblem({ powerW: 100, powerFactor: 0 })).not.toBeNull();
    expect(loadSpecProblem({ powerW: 100, crossSectionMm2: 3 })).not.toBeNull();
    expect(loadSpecProblem({ powerW: 100, method: 'Z' as never })).not.toBeNull();
  });
});

/** Mains -> breaker (16 A) -> loads, wired by hand so that each test states its own topology. */
function scene(powers: number[]) {
  const panel = panelOf([place('p1', 'breaker16', 0, 0)]);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const wire = (a: [string, string], b: [string, string]) => {
    const result = connect(schematic, terminalsOf, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
    return schematic.wires[schematic.wires.length - 1]!.id;
  };
  const feed = wire(['n2', 'bottom:L'], ['n1', 'top:L']);
  const branches = powers.map((powerW, i) => {
    schematic = addNode(schematic, load(['L', 'N', 'PE'], { powerW })).schematic;
    const id = schematic.nodes[schematic.nodes.length - 1]!.id;
    return { node: id, wire: wire(['n1', 'bottom:L'], [id, 'top:L']), index: i };
  });
  const project: Project = { panel, schematic };
  return { project, feed, branches };
}

describe('wireCurrents', () => {
  it('gives a wire the current of the load behind it, all the way up to the source', () => {
    const { project, feed, branches } = scene([2300]);
    const currents = wireCurrents(project, resolve);
    expect(currents.get(branches[0]!.wire)).toBeCloseTo(10);
    expect(currents.get(feed)).toBeCloseTo(10);
  });

  it('gives each branch its own load and the feeding wire the sum', () => {
    const { project, feed, branches } = scene([1150, 2300]);
    const currents = wireCurrents(project, resolve);
    expect(currents.get(branches[0]!.wire)).toBeCloseTo(5);
    expect(currents.get(branches[1]!.wire)).toBeCloseTo(10);
    expect(currents.get(feed)).toBeCloseTo(15);
  });

  it('shows nothing when no load has a power', () => {
    const { project } = scene([2300]);
    const withoutPower = { ...project, schematic: { ...project.schematic, nodes: project.schematic.nodes.map(({ load: _l, ...n }) => n) } };
    expect(wireCurrents(withoutPower, resolve).size).toBe(0);
  });

  it('follows a comb: the wire into the first breaker carries what every breaker under the comb passes on', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)], [combAt('c1', 'comb1', 0, 0)]);
    let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
    schematic = addNode(schematic, load(['L', 'N'], { powerW: 2300 })).schematic;
    schematic = addNode(schematic, load(['L', 'N'], { powerW: 1150 })).schematic;
    const terminalsOf = nodeTerminalsLookup(panel, resolve);
    const ids: string[] = [];
    for (const [a, b] of [
      [['n3', 'bottom:L'], ['n1', 'top:L']],
      [['n1', 'bottom:L'], ['n4', 'top:L']],
      [['n2', 'bottom:L'], ['n5', 'top:L']],
    ] as const) {
      const result = connect(schematic, terminalsOf, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
      if (!result.ok) throw new Error(result.error.kind);
      schematic = result.schematic;
      ids.push(schematic.wires[schematic.wires.length - 1]!.id);
    }
    const currents = wireCurrents({ panel, schematic }, resolve);
    expect(currents.get(ids[0]!)).toBeCloseTo(15);
    expect(currents.get(ids[1]!)).toBeCloseTo(10);
    expect(currents.get(ids[2]!)).toBeCloseTo(5);
  });
});

describe('loadReports', () => {
  const reportFor = (powerW: number, extra: Partial<LoadSpec> = {}) => {
    const { project, branches } = scene([powerW]);
    const node = branches[0]!.node;
    const spec: LoadSpec = { powerW, ...extra };
    const schematic = setNodeLoad(project.schematic, node, spec);
    if (!schematic.ok) throw new Error(schematic.error.kind);
    return loadReports({ ...project, schematic: schematic.schematic }, resolve)[0]!;
  };

  it('sizes the cable for the breaker rating when that is higher than the load current', () => {
    const report = reportFor(2300);
    expect(report.currentA).toBeCloseTo(10);
    expect(report.breakerA).toBe(16);
    expect(report.requiredA).toBe(16);
    expect(report.minimumSectionMm2).toBe(1.5);
    expect(report.method).toBe('C');
    expect(report.loaded).toBe(2);
  });

  it('sizes the cable for the load when the load is higher than the breaker', () => {
    const report = reportFor(4600);
    expect(report.requiredA).toBeCloseTo(20);
    expect(report.minimumSectionMm2).toBe(2.5);
  });

  it('reports what the chosen cable carries and respects the laying method', () => {
    const report = reportFor(2300, { crossSectionMm2: 1.5, method: 'B2' });
    expect(report.chosenSectionMm2).toBe(1.5);
    expect(report.chosenAmpacityA).toBe(16.5);
    expect(report.method).toBe('B2');
  });

  it('has no report for a load without a power', () => {
    const { project } = scene([]);
    expect(loadReports(project, resolve)).toEqual([]);
  });
});

describe('setNodeLoad', () => {
  const base = addNode(emptySchematic(), load(['L', 'N'])).schematic;

  it('sets and clears the load of a load node', () => {
    const set = setNodeLoad(base, 'n1', { powerW: 500 });
    if (!set.ok) throw new Error(set.error.kind);
    expect(set.schematic.nodes[0]!.load).toEqual({ powerW: 500 });
    const cleared = setNodeLoad(set.schematic, 'n1', undefined);
    if (!cleared.ok) throw new Error(cleared.error.kind);
    expect('load' in cleared.schematic.nodes[0]!).toBe(false);
  });

  it('refuses unknown nodes, nodes that are not loads and values out of range', () => {
    const source = addNode(emptySchematic(), { ...load(['L', 'N']), kind: 'source' }).schematic;
    expect(setNodeLoad(base, 'n9', { powerW: 1 })).toEqual({ ok: false, error: { kind: 'unknown-node' } });
    expect(setNodeLoad(source, 'n1', { powerW: 1 })).toEqual({ ok: false, error: { kind: 'not-a-load' } });
    expect(setNodeLoad(base, 'n1', { powerW: -1 })).toEqual({ ok: false, error: { kind: 'invalid-load' } });
  });
});

describe('load in the project file', () => {
  const project = (): Project => {
    const { project: p, branches } = scene([2300]);
    const schematic = setNodeLoad(p.schematic, branches[0]!.node, { powerW: 2300, powerFactor: 0.9, method: 'E', crossSectionMm2: 2.5 });
    if (!schematic.ok) throw new Error('setup');
    return { ...p, schematic: schematic.schematic };
  };
  const json = () => JSON.parse(JSON.stringify(buildProjectFile(project(), resolve)));

  it('survives saving and loading', () => {
    const parsed = parseProjectJson(JSON.stringify(json()));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.file.project.schematic.nodes.find((n) => n.load)?.load).toEqual({ powerW: 2300, powerFactor: 0.9, method: 'E', crossSectionMm2: 2.5 });
  });

  it('rejects a load on a node that is not a load, a bad method and an unknown field', () => {
    const onSource = json();
    onSource.project.schematic.nodes.find((n: SchematicNode) => n.kind === 'source').load = { powerW: 1 };
    expect(parseProjectJson(JSON.stringify(onSource)).ok).toBe(false);
    const badMethod = json();
    badMethod.project.schematic.nodes.find((n: SchematicNode) => n.load).load.method = 'Z';
    expect(parseProjectJson(JSON.stringify(badMethod)).ok).toBe(false);
    const unknown = json();
    unknown.project.schematic.nodes.find((n: SchematicNode) => n.load).load.voltage = 400;
    expect(parseProjectJson(JSON.stringify(unknown)).ok).toBe(false);
  });
});
