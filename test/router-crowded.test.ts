import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { computeLayout, type Rect } from '../src/schematic/geometry';
import { addNode, connect, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { routeWires } from '../src/schematic/router';
import type { Point } from '../src/view/Camera';
import { panelOf, place, resolve } from './fixtures';

const insideStrictly = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;

/** True when a segment of the path goes through the interior of the rectangle. */
function crossesInterior(path: Point[], rect: Rect): boolean {
  return path.slice(1).some((b, i) => {
    const a = path[i]!;
    const steps = 50;
    return Array.from({ length: steps + 1 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps })).some((p) => insideStrictly(p, rect));
  });
}

describe('wires between nodes that stand close together', () => {
  function crowded() {
    const panel = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)]);
    const terminalsOf = nodeTerminalsLookup(panel, resolve);
    let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 200, y: 210, conductors: ['L', 'N', 'PE'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Load', x: 200, y: 330, conductors: ['L', 'N', 'PE'] }).schematic;
    const join = (a: string, ta: string, b: string, tb: string) => {
      const r = connect(schematic, terminalsOf, { node: a, terminal: ta }, { node: b, terminal: tb });
      if (!r.ok) throw new Error(r.error.kind);
      schematic = r.schematic;
    };
    join('n3', 'bottom:L', 'n2', 'top:L');
    join('n2', 'bottom:L', 'n4', 'top:L');
    const layout = computeLayout(schematic, terminalsOf);
    return { schematic, layout, routes: routeWires(schematic, layout) };
  }

  it('does not run through a node that is only a few millimetres from the terminal it leaves', () => {
    const { schematic, layout, routes } = crowded();
    const source = layout.get('n3')!.rect;
    for (const wire of schematic.wires) {
      expect(crossesInterior(routes.get(wire.id)!, source), `${wire.id} passes through the source`).toBe(false);
    }
  });
});
