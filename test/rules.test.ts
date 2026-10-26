import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { findRuleWarnings } from '../src/electrical/rules';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { projectWarnings } from '../src/project/file';
import { addNode, connect, connectAll, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { defs, panelOf, place } from './fixtures';

const local: Record<string, ModuleDef> = {
  ...defs,
  main32: { id: 'main32', kind: 'switch', name: 'Main 32 A', widthUnits: 3, poles: 3, ratedCurrentA: 32 },
  mcb3x40: { id: 'mcb3x40', kind: 'breaker', name: 'MCB 3P 40 A', widthUnits: 3, poles: 3, ratedCurrentA: 40 },
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
