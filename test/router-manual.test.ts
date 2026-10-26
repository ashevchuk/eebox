import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { computeLayout } from '../src/schematic/geometry';
import { pathFromLanes } from '../src/schematic/manualRoute';
import { addNode, connect, emptySchematic, setWireRoute, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { routeWires } from '../src/schematic/router';
import type { Point } from '../src/view/Camera';
import { panelOf, place, resolve } from './fixtures';

/** A source above a load with three wires between neighbouring terminals, so they all want the same corridor. */
function scene(routeOf?: Record<string, number[]>) {
  const panel = panelOf([place('p1', 'mcb3', 0, 0)]);
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: -240, conductors: ['L1', 'L2', 'L3'] }).schematic;
  const source = schematic.nodes.find((n) => n.kind === 'source')!.id;
  for (const c of ['L1', 'L2', 'L3']) {
    const r = connect(schematic, terminalsOf, { node: source, terminal: `bottom:${c}` }, { node: 'n1', terminal: `top:${c}` });
    if (!r.ok) throw new Error(r.error.kind);
    schematic = r.schematic;
  }
  for (const [id, route] of Object.entries(routeOf ?? {})) {
    const r = setWireRoute(schematic, id, route);
    if (!r.ok) throw new Error(r.error.kind);
    schematic = r.schematic;
  }
  const layout = computeLayout(schematic, terminalsOf);
  return { schematic, layout, routes: routeWires(schematic, layout) };
}

const horizontals = (path: Point[]) => path.slice(1).flatMap((q, i) => (Math.abs(path[i]!.y - q.y) < 0.01 ? [{ y: q.y, x1: Math.min(path[i]!.x, q.x), x2: Math.max(path[i]!.x, q.x) }] : []));

describe('a wire with a route of its own', () => {
  it('is drawn exactly as its lanes say, whatever the router would have done', () => {
    const { schematic, layout, routes } = scene({ w1: [-60] });
    const wire = schematic.wires[0]!;
    const a = layout.get(wire.a.node)!.ports.find((p) => p.terminal.id === wire.a.terminal)!;
    const b = layout.get(wire.b.node)!.ports.find((p) => p.terminal.id === wire.b.terminal)!;
    expect(routes.get('w1')).toEqual(pathFromLanes({ point: a.point, side: a.terminal.side }, { point: b.point, side: b.terminal.side }, [-60]));
  });

  it('keeps the automatic wires out of its corridor', () => {
    const { routes } = scene({ w1: [-60] });
    const manualLane = horizontals(routes.get('w1')!).find((h) => Math.abs(h.y - -60) < 0.01)!;
    for (const id of ['w2', 'w3']) {
      for (const h of horizontals(routes.get(id)!)) {
        const overlapsInX = Math.min(h.x2, manualLane.x2) - Math.max(h.x1, manualLane.x1) > 1;
        expect(overlapsInX && Math.abs(h.y - manualLane.y) < 0.01, `${id} runs along the hand-drawn wire`).toBe(false);
      }
    }
  });

  it('moves with its terminals: the lane stays, the ends follow', () => {
    const before = scene({ w1: [-60] }).routes.get('w1')!;
    expect(before.some((p) => p.y === -60)).toBe(true);
    expect(before[0]!.y).toBeLessThan(-60);
  });

  it('is reread from the file: the route changes what the cache holds', () => {
    const plain = scene().routes.get('w1')!;
    const manual = scene({ w1: [-60] }).routes.get('w1')!;
    expect(manual).not.toEqual(plain);
  });
});
