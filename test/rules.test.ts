import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { findRuleWarnings } from '../src/electrical/rules';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { projectWarnings } from '../src/project/file';
import { addNode, connect, connectAll, emptySchematic, setNodeLoad, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { defs, panelOf, place } from './fixtures';

const local: Record<string, ModuleDef> = {
  ...defs,
  main32: { id: 'main32', kind: 'switch', name: 'Main 32 A', widthUnits: 3, poles: 3, ratedCurrentA: 32 },
  mcb3x40: { id: 'mcb3x40', kind: 'breaker', name: 'MCB 3P 40 A', widthUnits: 3, poles: 3, ratedCurrentA: 40 },
  mcb1x25: { id: 'mcb1x25', kind: 'breaker', name: 'MCB 1P 25 A', widthUnits: 1, poles: 1, ratedCurrentA: 25 },
  mcb3x16: { id: 'mcb3x16', kind: 'breaker', name: 'MCB 3P 16 A', widthUnits: 3, poles: 3, ratedCurrentA: 16 },
};
const resolve = (r: ModuleRef): ModuleDef | undefined => local[r.moduleId];

const SOURCE = 'Mains';
const LOAD = 'Motor';

/** A project with the given modules on one rail (slots in order), a 3-phase source and a 3-phase load. */
function build(moduleIds: string[]) {
  let slot = 0;
  const placements = moduleIds.map((id, i) => {
    const p = place(`p${i + 1}`, id, 0, slot);
    slot += local[id]!.widthUnits;
    return p;
  });
  const panel = panelOf(placements);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: SOURCE, x: 0, y: -300, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: LOAD, x: 0, y: 600, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const idOf = (label: string) => schematic.nodes.find((n) => n.label === label)!.id;
  const nodeOfPlacement = (placementId: string) => schematic.nodes.find((n) => n.placementId === placementId)!.id;
  const wire = (from: string, to: string) => {
    const result = connectAll(schematic, terminalsOf, from, to);
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  };
  return {
    panel,
    get schematic(): Schematic {
      return schematic;
    },
    source: idOf(SOURCE),
    load: idOf(LOAD),
    node: nodeOfPlacement,
    wire,
    connectTerminals(a: { node: string; terminal: string }, b: { node: string; terminal: string }) {
      const result = connect(schematic, terminalsOf, a, b);
      if (!result.ok) throw new Error(result.error.kind);
      schematic = result.schematic;
    },
    warnings: () => findRuleWarnings({ panel, schematic } satisfies Project, resolve),
  };
}

const about = (warnings: string[], text: string) => warnings.filter((w) => w.includes(text));

describe('protective earth of a load', () => {
  it('is reported when the PE terminal of a load has no wire', () => {
    const scene = build(['mcb3']);
    expect(about(scene.warnings(), 'protective earth')).toEqual([`${LOAD} [${scene.load}]: protective earth is not connected`]);
  });

  it('is not reported once the PE terminal is wired', () => {
    const scene = build(['mcb3', 'fixedbar']);
    scene.connectTerminals({ node: scene.load, terminal: 'top:PE' }, { node: scene.node('p2'), terminal: 'top:PE1' });
    expect(about(scene.warnings(), 'protective earth')).toEqual([]);
  });

  it('does not apply to a load that has no PE conductor', () => {
    const schematic = addNode(emptySchematic(), { kind: 'load', label: 'Lamp', x: 0, y: 0, conductors: ['L', 'N'] }).schematic;
    expect(findRuleWarnings({ panel: panelOf([]), schematic }, resolve)).toEqual([]);
  });
});

describe('modules that are not fed', () => {
  it('reports a module whose output is wired while its input is not', () => {
    const scene = build(['mcb3']);
    scene.wire(scene.node('p1'), scene.load);
    expect(about(scene.warnings(), 'not fed')).toEqual([`MCB 3P [p1]: its outputs are connected but its input is not fed`]);
  });

  it('is quiet once the input is wired', () => {
    const scene = build(['mcb3']);
    scene.wire(scene.source, scene.node('p1'));
    scene.wire(scene.node('p1'), scene.load);
    expect(about(scene.warnings(), 'not fed')).toEqual([]);
  });

  it('is quiet for a module with nothing wired and for terminal bars', () => {
    const scene = build(['mcb3', 'nbar']);
    expect(about(scene.warnings(), 'not fed')).toEqual([]);
  });
});

describe('rating of what a module feeds', () => {
  it('reports a module that feeds more current than it is rated for', () => {
    const scene = build(['main32', 'mcb3x40']);
    scene.wire(scene.source, scene.node('p1'));
    scene.wire(scene.node('p1'), scene.node('p2'));
    expect(about(scene.warnings(), 'rating')).toEqual([
      'Main 32 A [p1]: the modules it feeds add up to 40 A on one phase, above its rating of 32 A',
    ]);
  });

  it('accepts a smaller or equal load', () => {
    const scene = build(['main32', 'mcb3x16']);
    scene.wire(scene.source, scene.node('p1'));
    scene.wire(scene.node('p1'), scene.node('p2'));
    expect(about(scene.warnings(), 'rating')).toEqual([]);
  });

  it('adds the modules that hang on one phase and counts each module once', () => {
    const scene = build(['main32', 'mcb3x16', 'mcb3x16', 'mcb3x16']);
    scene.wire(scene.source, scene.node('p1'));
    for (const p of ['p2', 'p3', 'p4']) scene.wire(scene.node('p1'), scene.node(p));
    expect(about(scene.warnings(), 'rating')).toEqual([
      'Main 32 A [p1]: the modules it feeds add up to 48 A on one phase, above its rating of 32 A',
    ]);
  });
});

describe('residual current protection', () => {
  it('reports a load fed straight from the source through a breaker', () => {
    const scene = build(['mcb3']);
    scene.wire(scene.source, scene.node('p1'));
    scene.wire(scene.node('p1'), scene.load);
    expect(about(scene.warnings(), 'RCD')).toEqual([`${LOAD} [${scene.load}]: it is fed without passing an RCD or RCBO`]);
  });

  it('is quiet when an RCD sits in the only path', () => {
    const scene = build(['rcd4', 'mcb3']);
    scene.wire(scene.source, scene.node('p1'));
    scene.wire(scene.node('p1'), scene.node('p2'));
    scene.wire(scene.node('p2'), scene.load);
    expect(about(scene.warnings(), 'RCD')).toEqual([]);
  });

  it('reports a load that has a second path around the RCD', () => {
    const scene = build(['rcd4', 'mcb3']);
    scene.wire(scene.source, scene.node('p1'));
    scene.wire(scene.node('p1'), scene.load);
    scene.wire(scene.source, scene.node('p2'));
    scene.wire(scene.node('p2'), scene.load);
    expect(about(scene.warnings(), 'RCD')).toHaveLength(1);
  });

  it('is quiet when there is no source to trace back to, or the load is not wired', () => {
    expect(about(build(['mcb3']).warnings(), 'RCD')).toEqual([]);
    const scene = build(['mcb3']);
    scene.wire(scene.node('p1'), scene.load);
    expect(about(scene.warnings(), 'RCD')).toEqual([]);
  });
});

describe('project check', () => {
  it('includes the design rules next to the structural problems', () => {
    const scene = build(['mcb3']);
    scene.wire(scene.source, scene.node('p1'));
    scene.wire(scene.node('p1'), scene.load);
    const warnings = projectWarnings({ panel: scene.panel, schematic: scene.schematic }, resolve);
    expect(warnings).toContain(`${LOAD} [${scene.load}]: it is fed without passing an RCD or RCBO`);
    expect(warnings).toContain(`${LOAD} [${scene.load}]: protective earth is not connected`);
  });
});

/** The messages about load, breaker and cable; the circuits below have neither earth nor RCD on purpose. */
const cableWarnings = (warnings: string[]) => warnings.filter((w) => /draws|cable|cross-section/.test(w));

describe('voltage drop in Check', () => {
  const warnings = (spec: Parameters<typeof setNodeLoad>[2]) => {
    const panel = panelOf([place('p1', 'breaker16', 0, 0)]);
    let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: SOURCE, x: 0, y: -300, conductors: ['L', 'N', 'PE'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Pump', x: 0, y: 300, conductors: ['L', 'N', 'PE'] }).schematic;
    const terminalsOf = nodeTerminalsLookup(panel, resolve);
    for (const [a, b] of [
      [{ node: 'n2', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' }],
      [{ node: 'n1', terminal: 'bottom:L' }, { node: 'n3', terminal: 'top:L' }],
    ] as const) {
      const wired = connect(schematic, terminalsOf, a, b);
      if (!wired.ok) throw new Error(wired.error.kind);
      schematic = wired.schematic;
    }
    const loaded = setNodeLoad(schematic, 'n3', spec);
    if (!loaded.ok) throw new Error(loaded.error.kind);
    return findRuleWarnings({ panel, schematic: loaded.schematic }, resolve).filter((w) => /voltage drop/.test(w));
  };

  it('is quiet for a short run and when no length is given', () => {
    expect(warnings({ powerW: 2300, crossSectionMm2: 2.5, lengthM: 20 })).toEqual([]);
    expect(warnings({ powerW: 2300, crossSectionMm2: 1.5 })).toEqual([]);
  });

  it('reports a chosen cable that drops more than the limit over its length', () => {
    expect(warnings({ powerW: 3680, crossSectionMm2: 1.5, lengthM: 80 })).toEqual([
      'Pump [n3]: the voltage drop over 80 m of 1.5 mm2 is 16.7 %, above the limit of 5 %',
    ]);
  });

  it('applies the lower limit to a lighting circuit', () => {
    expect(warnings({ powerW: 3680, crossSectionMm2: 6, lengthM: 80 })).toEqual([]);
    expect(warnings({ powerW: 3680, crossSectionMm2: 6, lengthM: 80, circuit: 'lighting' })).toEqual([
      'Pump [n3]: the voltage drop over 80 m of 6 mm2 is 4.2 %, above the limit of 3 %',
    ]);
  });

  it('says so when no listed cross-section keeps the drop within the limit', () => {
    expect(warnings({ powerW: 3680, lengthM: 1000 })).toEqual(['Pump [n3]: no listed cross-section keeps the voltage drop within 5 %']);
  });
});

describe('cable against breaker', () => {
  /** Mains -> breaker -> 1-phase load with the given data. */
  function circuit(spec: Parameters<typeof setNodeLoad>[2], breaker = 'breaker16') {
    const panel = panelOf([place('p1', breaker, 0, 0)]);
    let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: SOURCE, x: 0, y: -300, conductors: ['L', 'N', 'PE'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 300, conductors: ['L', 'N', 'PE'] }).schematic;
    const terminalsOf = nodeTerminalsLookup(panel, resolve);
    for (const [a, b] of [
      [{ node: 'n2', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' }],
      [{ node: 'n1', terminal: 'bottom:L' }, { node: 'n3', terminal: 'top:L' }],
    ] as const) {
      const wired = connect(schematic, terminalsOf, a, b);
      if (!wired.ok) throw new Error(wired.error.kind);
      schematic = wired.schematic;
    }
    const loaded = setNodeLoad(schematic, 'n3', spec);
    if (!loaded.ok) throw new Error(loaded.error.kind);
    return cableWarnings(findRuleWarnings({ panel, schematic: loaded.schematic }, resolve));
  }

  it('is quiet when load, breaker and cable fit each other', () => {
    expect(circuit({ powerW: 2300, crossSectionMm2: 2.5 })).toEqual([]);
    expect(circuit({ powerW: 2300 })).toEqual([]);
  });

  it('reports a load that draws more than its breaker allows', () => {
    expect(circuit({ powerW: 4600 })).toEqual(['Oven [n3]: it draws 20 A but its breaker is rated 16 A']);
  });

  it('reports a cable that carries less than the breaker rating', () => {
    expect(circuit({ powerW: 2300, crossSectionMm2: 1.5 }, 'mcb1x25')).toEqual([
      'Oven [n3]: a 1.5 mm2 cable carries 19.5 A, below the breaker rating of 25 A',
    ]);
  });

  it('accepts a cable that carries exactly the breaker rating or a little more', () => {
    expect(circuit({ powerW: 2300, crossSectionMm2: 1.5, method: 'B2' })).toEqual([]);
  });

  it('reports a cable that carries less than the load current when there is no breaker above it', () => {
    const panel = panelOf([]);
    let schematic = addNode(emptySchematic(), { kind: 'source', label: SOURCE, x: 0, y: 0, conductors: ['L', 'N', 'PE'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 300, conductors: ['L', 'N', 'PE'], load: { powerW: 4600, crossSectionMm2: 1.5 } }).schematic;
    const wired = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n1', terminal: 'bottom:L' }, { node: 'n2', terminal: 'top:L' });
    if (!wired.ok) throw new Error(wired.error.kind);
    expect(cableWarnings(findRuleWarnings({ panel, schematic: wired.schematic }, resolve))).toEqual([
      'Oven [n2]: a 1.5 mm2 cable carries 19.5 A, below the load current of 20 A',
    ]);
  });
});
