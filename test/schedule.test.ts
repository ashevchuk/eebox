import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { circuitSchedule, ferruleCounts, scheduleToCsv, wireList, wireListToCsv } from '../src/electrical/schedule';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, setWireLabel, setWireSection, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

/** Mains n2 -> breaker n1 -> load n3, with the wire ids returned. */
function circuit(loadLabel = 'Oven') {
  const panel = panelOf([place('p1', 'breaker16', 0, 0)]);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N', 'PE'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: loadLabel, x: 0, y: 300, conductors: ['L', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const wire = (a: [string, string], b: [string, string]) => {
    const result = connect(schematic, terminalsOf, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
    return schematic.wires[schematic.wires.length - 1]!.id;
  };
  const feed = wire(['n2', 'bottom:L'], ['n1', 'top:L']);
  const branch = wire(['n1', 'bottom:L'], ['n3', 'top:L']);
  const withLoad = (spec: Parameters<typeof setNodeLoad>[2]): Project => {
    const result = setNodeLoad(schematic, 'n3', spec);
    if (!result.ok) throw new Error(result.error.kind);
    return { panel, schematic: result.schematic };
  };
  return { panel, schematic, feed, branch, withLoad };
}

describe('circuitSchedule', () => {
  it('describes a load with its breaker, cable and voltage drop', () => {
    const project = circuit().withLoad({ powerW: 2300, crossSectionMm2: 2.5, lengthM: 20 });
    const [row] = circuitSchedule(project, resolve);
    expect(row).toMatchObject({
      nodeId: 'n3', load: 'Oven', powerW: 2300, breaker: 'MCB 1P C16', breakerA: 16, method: 'C', cores: 3,
      lengthM: 20, chosenSectionMm2: 2.5, minimumSectionMm2: 1.5, ampacityA: 27,
    });
    expect(row!.currentA).toBeCloseTo(10);
    expect(row!.dropPercent).toBeCloseTo(1.5652, 3);
  });

  it('leaves out what is unknown and has no row for a load without a power', () => {
    const { withLoad, schematic, panel } = circuit();
    const [row] = circuitSchedule(withLoad({ powerW: 1000 }), resolve);
    expect(row).not.toHaveProperty('lengthM');
    expect(row).not.toHaveProperty('chosenSectionMm2');
    expect(circuitSchedule({ panel, schematic }, resolve)).toEqual([]);
  });
});

describe('ferruleCounts', () => {
  it('counts two per wire and takes the size from the cable of the load a wire leads to', () => {
    const project = circuit().withLoad({ powerW: 2300, crossSectionMm2: 2.5 });
    expect(ferruleCounts(project)).toEqual([{ sectionMm2: 2.5, quantity: 2 }, { sectionMm2: null, quantity: 2 }]);
  });

  it('prefers the cross-section of the wire itself and lists the sizes in order, unknown last', () => {
    const scene = circuit();
    const set = setWireSection(scene.schematic, scene.feed, 6);
    if (!set.ok) throw new Error(set.error.kind);
    const project: Project = { panel: scene.panel, schematic: set.schematic };
    expect(ferruleCounts(project)).toEqual([{ sectionMm2: 6, quantity: 2 }, { sectionMm2: null, quantity: 2 }]);
  });

  it('has nothing for a schematic without wires', () => {
    expect(ferruleCounts({ panel: panelOf([]), schematic: emptySchematic() })).toEqual([]);
  });
});

describe('setWireSection', () => {
  it('sets, replaces and clears the cross-section of a wire', () => {
    const { schematic, feed } = circuit();
    const set = setWireSection(schematic, feed, 4);
    if (!set.ok) throw new Error(set.error.kind);
    expect(set.schematic.wires.find((w) => w.id === feed)?.crossSectionMm2).toBe(4);
    const cleared = setWireSection(set.schematic, feed, undefined);
    if (!cleared.ok) throw new Error(cleared.error.kind);
    expect('crossSectionMm2' in cleared.schematic.wires.find((w) => w.id === feed)!).toBe(false);
  });

  it('refuses an unknown wire and a size that is not in the table', () => {
    const { schematic, feed } = circuit();
    expect(setWireSection(schematic, 'w99', 4)).toEqual({ ok: false, error: { kind: 'unknown-wire' } });
    expect(setWireSection(schematic, feed, 3)).toEqual({ ok: false, error: { kind: 'invalid-section' } });
  });

  it('survives saving and loading, and a bad value in a file is refused', () => {
    const scene = circuit();
    const set = setWireSection(scene.schematic, scene.feed, 4);
    if (!set.ok) throw new Error('setup');
    const file = JSON.parse(JSON.stringify(buildProjectFile({ panel: scene.panel, schematic: set.schematic }, resolve)));
    const parsed = parseProjectJson(JSON.stringify(file));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.file.project.schematic.wires.find((w) => w.id === scene.feed)?.crossSectionMm2).toBe(4);
    file.project.schematic.wires[0].crossSectionMm2 = 3;
    expect(parseProjectJson(JSON.stringify(file)).ok).toBe(false);
  });
});

describe('scheduleToCsv', () => {
  it('writes the circuits, a blank line, then the ferrules', () => {
    const project = circuit().withLoad({ powerW: 2300, crossSectionMm2: 2.5, lengthM: 20 });
    const lines = scheduleToCsv(circuitSchedule(project, resolve), ferruleCounts(project)).split('\r\n');
    expect(lines[0]).toBe('Load,Power (W),Current (A),Breaker,Breaker (A),Laying method,Cores,Length (m),Cable (mm2),Minimum (mm2),Carries (A),Voltage drop (%)');
    expect(lines[1]).toBe('Oven,2300,10,MCB 1P C16,16,C,3,20,2.5,1.5,27,1.6');
    expect(lines.slice(2)).toEqual(['', 'Ferrule (mm2),Quantity', '2.5,2', 'not specified,2', '']);
  });

  it('keeps a label that starts like a formula from running in a spreadsheet', () => {
    const project = circuit('=HYPERLINK("x")').withLoad({ powerW: 1000 });
    const csv = scheduleToCsv(circuitSchedule(project, resolve), []);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('wireList', () => {
  const sample = () => circuit('Oven').withLoad({ powerW: 2300, crossSectionMm2: 2.5, lengthM: 20 });

  it('names both ends of every wire by module or node and terminal, and gives the conductor', () => {
    const rows = wireList(sample(), resolve);
    expect(rows.map((r) => [r.wireId, r.from, r.to, r.conductor])).toEqual([
      ['w1', 'Mains L (bottom)', 'breaker16 L (top)', 'L'],
      ['w2', 'breaker16 L (bottom)', 'Oven L (top)', 'L'],
    ]);
  });

  it('takes the cross-section and length from the cable of the load a wire leads to, and the current from the schematic', () => {
    const [feed, branch] = wireList(sample(), resolve);
    expect(feed).toMatchObject({ currentA: expect.closeTo(10, 3) });
    expect(feed).not.toHaveProperty('sectionMm2');
    expect(branch).toMatchObject({ sectionMm2: 2.5, lengthM: 20 });
    expect(branch!.currentA).toBeCloseTo(10, 3);
  });

  it('prefers the label of a placement and of a terminal to the names of the module and the terminal', () => {
    const scene = circuit('Oven');
    const placements = scene.panel.placements.map((p) => ({ ...p, label: 'Kitchen', terminalLabels: { 'bottom:L': 'out' } }));
    const rows = wireList({ panel: { ...scene.panel, placements }, schematic: scene.schematic }, resolve);
    expect(rows[1]!.from).toBe('Kitchen out (bottom)');
  });

  it('shows the label of a wire and the cross-section the wire has of its own', () => {
    const scene = circuit();
    const labelled = setWireLabel(scene.schematic, scene.feed, 'Supply');
    if (!labelled.ok) throw new Error('setup');
    const sized = setWireSection(labelled.schematic, scene.feed, 6);
    if (!sized.ok) throw new Error('setup');
    expect(wireList({ panel: scene.panel, schematic: sized.schematic }, resolve)[0]).toMatchObject({ label: 'Supply', sectionMm2: 6 });
  });

  it('writes a header and a row per wire, and keeps a label that starts like a formula from running', () => {
    const scene = circuit();
    const labelled = setWireLabel(scene.schematic, scene.feed, '=1+1');
    if (!labelled.ok) throw new Error('setup');
    const csv = wireListToCsv(wireList({ panel: scene.panel, schematic: labelled.schematic }, resolve)).split('\r\n');
    expect(csv[0]).toBe('Wire,Label,From,To,Conductor,Cross-section (mm2),Length (m),Current (A)');
    expect(csv).toHaveLength(4);
    expect(csv[1]).toContain("'=1+1");
  });

  it('has nothing to list for a schematic without wires', () => {
    expect(wireList({ panel: panelOf([]), schematic: emptySchematic() }, resolve)).toEqual([]);
    expect(wireListToCsv([])).toBe('Wire,Label,From,To,Conductor,Cross-section (mm2),Length (m),Current (A)\r\n');
  });
});
