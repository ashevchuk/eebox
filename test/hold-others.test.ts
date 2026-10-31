import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Panel, ModuleRef } from '../src/layout/placement';
import { createPanel } from '../src/layout/panel';
import { computeLayout } from '../src/schematic/geometry';
import { holdOthersStill } from '../src/schematic/hold';
import { lanesFromPath } from '../src/schematic/manualRoute';
import { setWireRoute, type Schematic, type Wire } from '../src/schematic/model';
import { routeWires } from '../src/schematic/router';
import { parseLibraryJson } from '../src/library/validate';
import genericIecText from '../libraries/generic-iec.json?raw';

const parsed = parseLibraryJson(genericIecText);
if (!parsed.ok) throw new Error('the bundled library must be valid');
const modules = new Map(parsed.library.modules.map((m) => [m.id, m]));
const resolve = (ref: ModuleRef) => modules.get(ref.moduleId);
const lib = (moduleId: string): ModuleRef => ({ libraryId: parsed.library.id, moduleId });

/** Three contactors, each pole of each wired to the next and to the third: nine wires that the router lays out. */
function scene() {
  const panel: Panel = {
    ...createPanel([24]),
    placements: [
      { id: 'p1', module: lib('contactor-3p-20-230'), rail: 0, slot: 0 },
      { id: 'p2', module: lib('contactor-3p-25-230'), rail: 0, slot: 4 },
      { id: 'p3', module: lib('contactor-3p-20-230'), rail: 0, slot: 8 },
    ],
  };
  const wires: Wire[] = [];
  for (const k of ['1', '2', '3']) {
    for (const [a, b] of [['n1', 'n2'], ['n2', 'n3'], ['n1', 'n3']] as const) {
      wires.push({ id: `w${wires.length + 1}`, a: { node: a, terminal: `bottom:T${k}` }, b: { node: b, terminal: `top:L${k}` } });
    }
  }
  const schematic: Schematic = {
    nodes: [
      { id: 'n1', kind: 'module', label: 'K1', x: 0, y: 0, placementId: 'p1' },
      { id: 'n2', kind: 'module', label: 'K2', x: 420, y: 0, placementId: 'p2' },
      { id: 'n3', kind: 'module', label: 'K3', x: 840, y: 0, placementId: 'p3' },
    ],
    wires,
  };
  const layout = computeLayout(schematic, nodeTerminalsLookup(panel, resolve));
  return { schematic, layout };
}

const samePath = (a: readonly { x: number; y: number }[] | undefined, b: readonly { x: number; y: number }[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-6 && Math.abs(p.y - b[i]!.y) < 1e-6);

describe('holdOthersStill', () => {
  /** w3 is pulled: its route is the one it had with one lane moved. */
  function pulled() {
    const { schematic, layout } = scene();
    const before = routeWires(schematic, layout);
    const lanes = lanesFromPath(before.get('w3')!)!;
    const moved = [...lanes];
    moved[0] = moved[0]! + 80;
    const result = setWireRoute(schematic, 'w3', moved);
    if (!result.ok) throw new Error('route refused');
    return { before, layout, after: result.schematic };
  }

  it('is needed: left to the router, pulling one wire lays the others out somewhere else', () => {
    const { before, layout, after } = pulled();
    const now = routeWires(after, layout);
    const moved = after.wires.filter((w) => w.id !== 'w3' && !samePath(before.get(w.id), now.get(w.id)));
    expect(moved.length).toBeGreaterThan(0);
  });

  it('keeps every other wire where it was, and moves the pulled one', () => {
    const { before, layout, after } = pulled();
    const unmoved = (schematic: Schematic) => {
      const now = routeWires(schematic, layout);
      return schematic.wires.filter((w) => w.id !== 'w3' && samePath(before.get(w.id), now.get(w.id))).length;
    };
    const held = holdOthersStill(after, layout, before, new Set(['w3']));
    // Before holding, few stay; after it, every other wire stays, because a route can draw each of them as the router did.
    expect(unmoved(after)).toBeLessThan(unmoved(held));
    expect(unmoved(held)).toBe(after.wires.length - 1);
    expect(samePath(before.get('w3'), routeWires(held, layout).get('w3'))).toBe(false);
  });

  it('gives a route only to the wires that would have moved', () => {
    const { before, layout, after } = pulled();
    const now = routeWires(after, layout);
    const wouldMove = after.wires.filter((w) => w.id !== 'w3' && !samePath(before.get(w.id), now.get(w.id))).length;
    const held = holdOthersStill(after, layout, before, new Set(['w3']));
    const withRoute = held.wires.filter((w) => w.id !== 'w3' && w.route !== undefined).length;
    expect(withRoute).toBeGreaterThan(0);
    expect(withRoute).toBeGreaterThanOrEqual(wouldMove);
    expect(withRoute).toBeLessThanOrEqual(held.wires.length - 1);
  });

  it('leaves a wire that has a route of its own, and one that was moved, as they are', () => {
    const { before, layout, after } = pulled();
    const own = setWireRoute(after, 'w5', lanesFromPath(before.get('w5')!)!.map((v) => v + 10));
    if (!own.ok) throw new Error('route refused');
    const held = holdOthersStill(own.schematic, layout, before, new Set(['w3']));
    expect(held.wires.find((w) => w.id === 'w5')!.route).toEqual(own.schematic.wires.find((w) => w.id === 'w5')!.route);
    expect(held.wires.find((w) => w.id === 'w3')!.route).toEqual(after.wires.find((w) => w.id === 'w3')!.route);
  });

  it('changes nothing when nothing would move', () => {
    const { schematic, layout } = scene();
    const before = routeWires(schematic, layout);
    expect(holdOthersStill(schematic, layout, before, new Set())).toEqual(schematic);
  });
});
