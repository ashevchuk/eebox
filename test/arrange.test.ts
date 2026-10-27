import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { alignNodes, arrangeNodes, distributeNodes, levelsOf } from '../src/schematic/arrange';
import { computeLayout, type Layout, type Rect } from '../src/schematic/geometry';
import { addNode, connect, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

/** A source feeding two breakers, each feeding a load, and a node nothing is wired to. */
function scene(): { schematic: Schematic; layout: () => Layout } {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)]);
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  for (const [label, kind, x, y] of [['Mains', 'source', 500, 400], ['Lamp A', 'load', 10, 10], ['Lamp B', 'load', 300, 30], ['Spare', 'load', 600, 700]] as const) {
    schematic = addNode(schematic, { kind, label, x, y, conductors: ['L'] }).schematic;
  }
  const wire = (a: string, ta: string, b: string, tb: string) => {
    const joined = connect(schematic, terminalsOf, { node: a, terminal: ta }, { node: b, terminal: tb });
    if (!joined.ok) throw new Error(joined.error.kind);
    schematic = joined.schematic;
  };
  wire('n3', 'bottom:L', 'n1', 'top:L');
  wire('n3', 'bottom:L', 'n2', 'top:L');
  wire('n1', 'bottom:L', 'n4', 'top:L');
  wire('n2', 'bottom:L', 'n5', 'top:L');
  return { schematic, layout: () => computeLayout(schematic, terminalsOf) };
}

const rectOf = (schematic: Schematic, id: string): Rect => {
  const node = schematic.nodes.find((n) => n.id === id)!;
  return { x: node.x, y: node.y, width: 0, height: 0 };
};

describe('the rows of a schematic', () => {
  it('put the sources first, the loads last, what is wired to nothing under them, and the rest by distance from a source', () => {
    const { schematic } = scene();
    expect(levelsOf(schematic)).toEqual([['n3'], ['n1', 'n2'], ['n4', 'n5'], ['n6']]);
  });

  it('put a load that is close to a source in the last row all the same', () => {
    const { schematic } = scene();
    const direct = connectDirect(schematic);
    expect(levelsOf(direct).at(-1)).toContain('n6');
  });

  it('are one row for a drawing with no sources, in the order of the nodes', () => {
    const { schematic } = scene();
    const none = { ...schematic, nodes: schematic.nodes.filter((n) => n.kind !== 'source'), wires: [] };
    expect(levelsOf(none)).toEqual([['n1', 'n2', 'n4', 'n5', 'n6']].map((r) => r));
  });
});

function connectDirect(schematic: Schematic): Schematic {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)]);
  const joined = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n3', terminal: 'bottom:L' }, { node: 'n6', terminal: 'top:L' });
  if (!joined.ok) throw new Error(joined.error.kind);
  return joined.schematic;
}

describe('arranging the nodes', () => {
  it('puts the rows one under another, each lower than the one above, with the source on top and the loads at the bottom', () => {
    const { schematic, layout } = scene();
    const arranged = arrangeNodes(schematic, layout());
    const y = (id: string) => rectOf(arranged, id).y;
    expect(y('n3')).toBeLessThan(y('n1'));
    expect(y('n1')).toBe(y('n2'));
    expect(y('n1')).toBeLessThan(y('n4'));
    expect(y('n4')).toBe(y('n5'));
    expect(y('n5')).toBeLessThan(y('n6'));
  });

  it('leaves no two nodes on top of each other', () => {
    const { schematic, layout } = scene();
    const arranged = arrangeNodes(schematic, layout());
    const after = computeLayout(arranged, nodeTerminalsLookup(panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)]), resolve));
    const rects = [...after.values()].map((n) => n.rect);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('keeps the wires crossing as little as it can: each node under what it is wired to, in the same order', () => {
    const { schematic, layout } = scene();
    const arranged = arrangeNodes(schematic, layout());
    const x = (id: string) => rectOf(arranged, id).x;
    expect(x('n1') < x('n2')).toBe(x('n4') < x('n5'));
  });

  it('changes only the places of the nodes, on the grid, and is the same when done again', () => {
    const { schematic, layout } = scene();
    const once = arrangeNodes(schematic, layout());
    expect(once.wires).toEqual(schematic.wires);
    expect(once.nodes.map((n) => ({ ...n, x: 0, y: 0 }))).toEqual(schematic.nodes.map((n) => ({ ...n, x: 0, y: 0 })));
    for (const node of once.nodes) {
      expect(node.x % 10).toBe(0);
      expect(node.y % 10).toBe(0);
    }
    const terminalsOf = nodeTerminalsLookup(panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)]), resolve);
    expect(arrangeNodes(once, computeLayout(once, terminalsOf))).toEqual(once);
  });

  it('does nothing to an empty schematic', () => {
    expect(arrangeNodes(emptySchematic(), new Map())).toEqual(emptySchematic());
  });
});

describe('aligning nodes', () => {
  it('lines them up on an edge or a middle of the box that covers them', () => {
    const { schematic, layout } = scene();
    const ids = ['n4', 'n5', 'n6'];
    const lay = layout();
    const edge = (how: Parameters<typeof alignNodes>[3], pick: (r: Rect) => number) => {
      const out = alignNodes(schematic, lay, ids, how);
      const after = computeLayout(out, nodeTerminalsLookup(panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)]), resolve));
      return new Set(ids.map((id) => pick(after.get(id)!.rect))).size;
    };
    expect(edge('left', (r) => r.x)).toBe(1);
    expect(edge('right', (r) => r.x + r.width)).toBe(1);
    expect(edge('top', (r) => r.y)).toBe(1);
    expect(edge('bottom', (r) => r.y + r.height)).toBe(1);
  });

  it('changes nothing for fewer than two nodes', () => {
    const { schematic, layout } = scene();
    expect(alignNodes(schematic, layout(), ['n4'], 'left')).toBe(schematic);
  });
});

describe('distributing nodes', () => {
  it('spaces three so the gaps are equal, the outer two staying', () => {
    const { schematic, layout } = scene();
    const lay = layout();
    const ids = ['n4', 'n5', 'n6'];
    const out = distributeNodes(schematic, lay, ids, 'vertical');
    const ys = ids.map((id) => rectOf(out, id).y).sort((a, b) => a - b);
    const before = ids.map((id) => lay.get(id)!.rect);
    const sorted = [...before].sort((a, b) => a.y - b.y);
    expect(ys[0]).toBe(Math.round(sorted[0]!.y / 10) * 10);
    const gap1 = ys[1]! - (ys[0]! + sorted[0]!.height);
    const gap2 = ys[2]! - (ys[1]! + sorted[1]!.height);
    expect(Math.abs(gap1 - gap2)).toBeLessThanOrEqual(10);
  });

  it('changes nothing for fewer than three', () => {
    const { schematic, layout } = scene();
    expect(distributeNodes(schematic, layout(), ['n4', 'n5'], 'horizontal')).toBe(schematic);
  });
});
