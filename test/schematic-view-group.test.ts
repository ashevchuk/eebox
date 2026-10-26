import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { computeLayout } from '../src/schematic/geometry';
import { addNode, connect, emptySchematic } from '../src/schematic/model';
import { routeWires } from '../src/schematic/router';
import { segmentsOf } from '../src/schematic/wireEditing';
import { applyAction, inspect } from '../src/ui/inspector';
import { SchematicView } from '../src/ui/schematicView';
import { Session, emptyProject } from '../src/ui/session';
import type { Point } from '../src/view/Camera';

const plain = {} as PointerEvent;
const shift = { shiftKey: true } as PointerEvent;

/** A 3-phase source and a 3-phase load, apart sideways, with a wire for each phase. */
function scene() {
  const project = emptyProject();
  let schematic = emptySchematic();
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: 0, conductors: ['L1', 'L2', 'L3'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Q', x: 400, y: 500, conductors: ['L1', 'L2', 'L3'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(project.panel, () => undefined);
  for (const c of ['L1', 'L2', 'L3']) {
    const joined = connect(schematic, terminalsOf, { node: 'n1', terminal: `bottom:${c}` }, { node: 'n2', terminal: `top:${c}` });
    if (!joined.ok) throw new Error(joined.error.kind);
    schematic = joined.schematic;
  }
  const session = new Session();
  session.reset({ ...project, schematic });
  const view = new SchematicView(session);
  const paths = () => {
    const current = session.project.schematic;
    return routeWires(current, computeLayout(current, nodeTerminalsLookup(session.project.panel, () => undefined)));
  };
  /** The middle of the first horizontal piece of a wire, which is where a person would take hold of it. */
  const grip = (id: string): Point => {
    const piece = segmentsOf(paths().get(id)!).find((s) => !s.vertical)!;
    return { x: (piece.a.x + piece.b.x) / 2, y: piece.a.y };
  };
  return { session, view, paths, grip };
}

const routes = (session: Session) => session.project.schematic.wires.map((w) => w.route?.[0]);

describe('several wires selected together', () => {
  it('are selected one by one with Shift, and a second Shift-click takes one out again', () => {
    const { session, view, grip } = scene();
    for (const id of ['w1', 'w2', 'w3']) {
      view.pointerDown(shift, grip(id));
      view.pointerUp(shift, grip(id));
    }
    expect(session.selection.wireIds).toEqual(['w1', 'w2', 'w3']);
    view.pointerDown(shift, grip('w2'));
    view.pointerUp(shift, grip('w2'));
    expect(session.selection.wireIds).toEqual(['w1', 'w3']);
  });

  it('move together by the same amount when one of them is pulled, in one step of history; a wire that is not alongside stays', () => {
    const { session, view, paths, grip } = scene();
    const before = ['w1', 'w2', 'w3'].map((id) => segmentsOf(paths().get(id)!).find((s) => !s.vertical)!.a.y);
    for (const id of ['w1', 'w2', 'w3']) {
      view.pointerDown(shift, grip(id));
      view.pointerUp(shift, grip(id));
    }
    const from = grip('w2');
    view.pointerDown(plain, from);
    for (let i = 1; i <= 4; i++) view.pointerMove(plain, { x: from.x, y: from.y - 15 * i });
    view.pointerUp(plain, { x: from.x, y: from.y - 60 });
    const [first, second, third] = routes(session);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first! - before[0]!).toBeCloseTo(second! - before[1]!, 6);
    expect(second! - before[1]!).toBeLessThan(-20);
    expect(third).toBeUndefined();
    session.undo();
    expect(routes(session)).toEqual([undefined, undefined, undefined]);
  });

  it('are taken in a rubber band drawn with Shift over empty space', () => {
    const { session, view } = scene();
    view.pointerDown(shift, { x: -500, y: -500 });
    view.pointerMove(plain, { x: 100, y: 200 });
    view.pointerMove(plain, { x: 700, y: 700 });
    view.pointerUp(plain, { x: 700, y: 700 });
    expect(session.selection.wireIds).toEqual(['w1', 'w2', 'w3']);
  });

  it('are all deleted by Delete', () => {
    const { session, view, grip } = scene();
    for (const id of ['w1', 'w3']) {
      view.pointerDown(shift, grip(id));
      view.pointerUp(shift, grip(id));
    }
    view.deleteSelection();
    expect(session.project.schematic.wires.map((w) => w.id)).toEqual(['w2']);
  });

  it('show in the inspector how many there are and take their hand-drawn routes off together', () => {
    const { session, view, grip } = scene();
    for (const id of ['w1', 'w2']) {
      view.pointerDown(shift, grip(id));
      view.pointerUp(shift, grip(id));
    }
    const from = grip('w1');
    view.pointerDown(plain, from);
    for (let i = 1; i <= 4; i++) view.pointerMove(plain, { x: from.x, y: from.y - 12 * i });
    view.pointerUp(plain, { x: from.x, y: from.y - 48 });
    const context = { project: session.project, selection: session.selection, mode: 'schematic' as const, resolve: () => undefined, snapshot: {}, fromLibraries: () => undefined };
    const view2 = inspect(context);
    expect(view2.title).toBe('2 wires selected');
    expect(view2.actions.map((a) => a.key)).toEqual(['routeAutomatically']);
    const cleared = applyAction(context, 'routeAutomatically');
    if (!cleared.ok) throw new Error(cleared.message);
    expect(cleared.project.schematic.wires.some((w) => w.route)).toBe(false);
  });
});

describe('a new source or load', () => {
  it('goes above everything for a source, below everything for a load, and in the middle sideways', () => {
    const { session, view } = scene();
    view.addFreeNode('source1');
    view.addFreeNode('load1');
    const nodes = session.project.schematic.nodes;
    const source = nodes.find((n) => n.id === 'n3')!;
    const load = nodes.find((n) => n.id === 'n4')!;
    expect(source.y).toBeLessThan(0);
    expect(load.y).toBeGreaterThan(500 + 44);
    expect(source.x).toBe(load.x);
    expect(source.x).toBeGreaterThan(0);
    expect(source.x).toBeLessThan(400);
  });

  it('keeps going where the camera is when the schematic is empty', () => {
    const session = new Session();
    const view = new SchematicView(session);
    view.addFreeNode('source1');
    expect(session.project.schematic.nodes).toHaveLength(1);
  });
});
