import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { findRuleWarnings } from '../src/electrical/rules';
import type { Library, ModuleDef } from '../src/library/types';
import { addNode, connect, emptySchematic, setNodeLoad, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place } from './fixtures';

const bundled = (JSON.parse(raw) as Library).modules;
const pick = (id: string): ModuleDef => bundled.find((m) => m.id === id)!;

/** Modules on one rail in the given order, a source with L, N and PE, wired by hand. */
function scene(moduleIds: string[]) {
  const defs: Record<string, ModuleDef> = Object.fromEntries(moduleIds.map((id) => [id, pick(id)]));
  const resolve = (ref: { moduleId: string }) => defs[ref.moduleId];
  let slot = 0;
  const placements = moduleIds.map((id, i) => {
    const p = place(`p${i + 1}`, id, 0, slot);
    slot += Math.ceil(defs[id]!.widthUnits);
    return p;
  });
  const panel = panelOf(placements);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -200, conductors: ['L', 'N', 'PE'] }).schematic;
  const source = schematic.nodes.find((n) => n.kind === 'source')!.id;
  const node = (placementId: string) => schematic.nodes.find((n) => n.placementId === placementId)!.id;
  const wire = (a: [string, string], b: [string, string]) => {
    const result = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  };
  return {
    source,
    node,
    wire,
    addLoad: (powerW: number, crossSectionMm2: number) => {
      schematic = addNode(schematic, { kind: 'load', label: 'Load', x: 0, y: 300, conductors: ['L', 'N', 'PE'] }).schematic;
      const id = schematic.nodes[schematic.nodes.length - 1]!.id;
      const loaded = setNodeLoad(schematic, id, { powerW, crossSectionMm2 });
      if (!loaded.ok) throw new Error(loaded.error.kind);
      schematic = loaded.schematic;
      return id;
    },
    warnings: () => findRuleWarnings({ panel, schematic }, resolve),
  };
}

describe('a surge protector', () => {
  it('whose lines are connected and whose earth terminal is not is advised about', () => {
    const s = scene(['spd-t2-1p']);
    s.wire([s.source, 'bottom:L'], [s.node('p1'), 'top:L']);
    expect(s.warnings().some((w) => /protects nothing/.test(w))).toBe(true);
  });

  it('is left alone once its earth terminal is connected, and while nothing is connected at all', () => {
    const s = scene(['spd-t2-1p']);
    expect(s.warnings().some((w) => /protects nothing/.test(w))).toBe(false);
    s.wire([s.source, 'bottom:L'], [s.node('p1'), 'top:L']);
    s.wire([s.source, 'bottom:PE'], [s.node('p1'), 'bottom:PE']);
    expect(s.warnings().some((w) => /protects nothing/.test(w))).toBe(false);
  });

  it('of type 1 fed from the output of an RCD is advised about, and one of type 2 is not', () => {
    for (const [id, expected] of [['spd-t1-1p', true], ['spd-t12-1p', true], ['spd-t2-1p', false]] as const) {
      const s = scene(['rcd-2p-25-30', id]);
      s.wire([s.source, 'bottom:L'], [s.node('p1'), 'top:L']);
      s.wire([s.node('p1'), 'bottom:L'], [s.node('p2'), 'top:L']);
      s.wire([s.source, 'bottom:PE'], [s.node('p2'), 'bottom:PE']);
      expect(s.warnings().some((w) => /ahead of the RCD/.test(w)), id).toBe(expected);
    }
  });

  it('of type 1 fed straight from the source is fine', () => {
    const s = scene(['spd-t1-1p']);
    s.wire([s.source, 'bottom:L'], [s.node('p1'), 'top:L']);
    s.wire([s.source, 'bottom:PE'], [s.node('p1'), 'bottom:PE']);
    expect(s.warnings()).toEqual([]);
  });
});

describe('a fuse in front of a cable', () => {
  it('is called a fuse in the advice when it is stronger than the cable behind it', () => {
    const s = scene(['fuse-10x38-1p-32']);
    const load = s.addLoad(2300, 1.5);
    s.wire([s.source, 'bottom:L'], [s.node('p1'), 'top:L']);
    s.wire([s.node('p1'), 'bottom:L'], [load, 'top:L']);
    const found = s.warnings().filter((w) => /fuse rating of 32 A/.test(w));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/1\.5 mm2 cable carries/);
  });

  it('is not mentioned when the cable carries what the fuse is rated for', () => {
    const s = scene(['fuse-10x38-1p-16']);
    const load = s.addLoad(2300, 4);
    s.wire([s.source, 'bottom:L'], [s.node('p1'), 'top:L']);
    s.wire([s.node('p1'), 'bottom:L'], [load, 'top:L']);
    expect(s.warnings().filter((w) => /fuse|cable carries/.test(w))).toEqual([]);
  });
});
