import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { computeLayout } from '../src/schematic/geometry';
import { addNode, connect, emptySchematic } from '../src/schematic/model';
import { routeWires } from '../src/schematic/router';
import { segmentsOf } from '../src/schematic/wireEditing';
import { Session, emptyProject } from '../src/ui/session';
import { SchematicView } from '../src/ui/schematicView';
import type { Point } from '../src/view/Camera';

const event = {} as PointerEvent;

/** A source and a load, side by side and apart, with one wire between them. */
function scene() {
  const project = emptyProject();
  let schematic = emptySchematic();
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: 0, conductors: ['L'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Q', x: 300, y: 400, conductors: ['L'] }).schematic;
  const joined = connect(schematic, nodeTerminalsLookup(project.panel, () => undefined), { node: 'n1', terminal: 'bottom:L' }, { node: 'n2', terminal: 'top:L' });
  if (!joined.ok) throw new Error(joined.error.kind);
  const session = new Session();
  session.reset({ ...project, schematic: joined.schematic });
  const view = new SchematicView(session);
  const path = () => {
    const { schematic: current } = session.project;
    const layout = computeLayout(current, nodeTerminalsLookup(session.project.panel, () => undefined));
    return routeWires(current, layout).get('w1')!;
  };
  return { session, view, path };
}

const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const route = (session: Session) => session.project.schematic.wires[0]!.route;

/** Presses on a piece of the wire, pulls it to `to` in a few steps and lets go. */
function pull(view: SchematicView, from: Point, to: Point, finish = true) {
  view.pointerDown(event, from);
  for (let i = 1; i <= 5; i++) view.pointerMove(event, { x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5 });
  if (finish) view.pointerUp(event, to);
}

describe('pulling a wire in the schematic', () => {
  it('moves a horizontal piece and stores one route, as one step of history', () => {
    const { session, view, path } = scene();
    const piece = segmentsOf(path())[1]!;
    const grab = middle(piece.a, piece.b);
    pull(view, grab, { x: grab.x, y: grab.y - 60 });
    const lanes = route(session)!;
    expect(lanes).toHaveLength(1);
    expect(Math.abs(lanes[0]! - (piece.a.y - 60))).toBeLessThanOrEqual(10);
    expect(session.canUndo).toBe(true);
    session.undo();
    expect(route(session)).toBeUndefined();
    expect(session.canUndo).toBe(false);
  });

  it('leaves the wire automatic after a click that did not move', () => {
    const { session, view, path } = scene();
    const grab = middle(...(([s]) => [s!.a, s!.b] as const)(segmentsOf(path()).slice(1)));
    view.pointerDown(event, grab);
    view.pointerUp(event, grab);
    expect(route(session)).toBeUndefined();
    expect(session.selection.wireId).toBe('w1');
  });

  it('puts everything back when the drag is cancelled', () => {
    const { session, view, path } = scene();
    const piece = segmentsOf(path())[1]!;
    const grab = middle(piece.a, piece.b);
    pull(view, grab, { x: grab.x, y: grab.y - 50 }, false);
    expect(view.cancel()).toBe(true);
    view.pointerUp(event, { x: grab.x, y: grab.y - 50 });
    expect(route(session)).toBeUndefined();
    expect(view.cancel()).toBe(false);
  });

  it('makes a jog when the piece at a terminal is pulled sideways, at the height it was taken', () => {
    const { session, view, path } = scene();
    const stub = segmentsOf(path())[0]!;
    const grab = { x: stub.a.x, y: stub.a.y + (stub.b.y - stub.a.y) / 2 };
    pull(view, grab, { x: grab.x + 80, y: grab.y });
    expect(route(session)).toHaveLength(3);
  });

  it('shows the cursor of the piece under the pointer, and nothing away from the wire', () => {
    const { session, view, path } = scene();
    const horizontal = segmentsOf(path())[1]!;
    const at = middle(horizontal.a, horizontal.b);
    view.pointerMove(event, at);
    expect(view.cursorAt(at)).toBe('ns-resize');
    expect(session.hoverWireId).toBe('w1');
    const stub = segmentsOf(path())[0]!;
    const onStub = { x: stub.a.x, y: stub.a.y + (stub.b.y - stub.a.y) / 2 };
    view.pointerMove(event, onStub);
    expect(view.cursorAt(onStub)).toBe('ew-resize');
    const away = { x: -400, y: -400 };
    view.pointerMove(event, away);
    expect(view.cursorAt(away)).toBeUndefined();
    expect(session.hoverWireId).toBeNull();
  });

  it('does not let a piece be pulled below the load, as the wire has to come into its terminal from above', () => {
    const { session, view, path } = scene();
    const piece = segmentsOf(path())[1]!;
    const grab = middle(piece.a, piece.b);
    pull(view, grab, { x: grab.x, y: grab.y + 80 });
    expect(route(session)).toBeUndefined();
  });

  it('keeps the route of a wire when a node is moved: the lane stays, the ends follow', () => {
    const { session, view, path } = scene();
    const piece = segmentsOf(path())[1]!;
    const grab = middle(piece.a, piece.b);
    pull(view, grab, { x: grab.x, y: grab.y - 40 });
    const before = route(session)!;
    const { schematic } = session.project;
    session.commit({ ...session.project, schematic: { ...schematic, nodes: schematic.nodes.map((n) => (n.id === 'n2' ? { ...n, x: n.x + 100 } : n)) } });
    expect(route(session)).toEqual(before);
    const after = path();
    expect(after[after.length - 1]!.x).toBeGreaterThan(path()[0]!.x);
  });
});
