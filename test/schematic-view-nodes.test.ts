import { describe, expect, it } from 'vitest';
import { addNode, emptySchematic } from '../src/schematic/model';
import { SchematicView } from '../src/ui/schematicView';
import { Session, emptyProject } from '../src/ui/session';

const plain = {} as PointerEvent;
const ctrl = { ctrlKey: true } as PointerEvent;

/** Three loads in a row of different widths, and a source above them. */
function scene() {
  const project = emptyProject();
  let schematic = emptySchematic();
  schematic = addNode(schematic, { kind: 'source', label: 'S', x: 200, y: -300, conductors: ['L'] }).schematic;
  for (const [x, y] of [[0, 0], [300, 40], [700, 90]] as const) schematic = addNode(schematic, { kind: 'load', label: `Q${x}`, x, y, conductors: ['L'] }).schematic;
  const session = new Session();
  session.reset({ ...project, schematic });
  const view = new SchematicView(session);
  const at = (id: string) => {
    const node = session.project.schematic.nodes.find((n) => n.id === id)!;
    return { x: node.x + 20, y: node.y + 20 };
  };
  const nodes = () => session.project.schematic.nodes.map((n) => [n.id, n.x, n.y]);
  return { session, view, at, nodes };
}

describe('several nodes selected together', () => {
  it('are added one by one with Ctrl, and a second Ctrl+click takes one out again', () => {
    const { session, view, at } = scene();
    for (const id of ['n2', 'n3']) {
      view.pointerDown(ctrl, at(id));
      view.pointerUp(ctrl, at(id));
    }
    expect(session.selection.nodeIds).toEqual(['n2', 'n3']);
    view.pointerDown(ctrl, at('n2'));
    view.pointerUp(ctrl, at('n2'));
    expect(session.selection).toEqual({ nodeId: 'n3' });
  });

  it('are all selected by selectAll', () => {
    const { session, view } = scene();
    view.selectAll();
    expect(session.selection.nodeIds).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('are selected by a Ctrl rubber band over empty space, those it touches', () => {
    const { session, view } = scene();
    view.pointerDown(ctrl, { x: -50, y: -50 });
    view.pointerMove(plain, { x: 100, y: 100 });
    view.pointerMove(plain, { x: 400, y: 200 });
    view.pointerUp(plain, { x: 400, y: 200 });
    expect(session.selection.nodeIds).toEqual(['n2', 'n3']);
  });

  it('move together by the same amount when one of them is dragged, in one step of history', () => {
    const { session, view, at, nodes } = scene();
    for (const id of ['n2', 'n3']) {
      view.pointerDown(ctrl, at(id));
      view.pointerUp(ctrl, at(id));
    }
    const before = nodes();
    const grab = at('n2');
    view.pointerDown(plain, grab);
    view.pointerMove(plain, { x: grab.x + 60, y: grab.y + 30 });
    view.pointerUp(plain, { x: grab.x + 60, y: grab.y + 30 });
    const after = nodes();
    expect(after[1]).toEqual(['n2', (before[1]![1] as number) + 60, (before[1]![2] as number) + 30]);
    expect(after[2]).toEqual(['n3', (before[2]![1] as number) + 60, (before[2]![2] as number) + 30]);
    expect(after[0]).toEqual(before[0]);
    expect(after[3]).toEqual(before[3]);
    session.undo();
    expect(nodes()).toEqual(before);
  });

  it('are all deleted by Delete, in one step', () => {
    const { session, view, at } = scene();
    for (const id of ['n2', 'n3']) {
      view.pointerDown(ctrl, at(id));
      view.pointerUp(ctrl, at(id));
    }
    view.deleteSelection();
    expect(session.project.schematic.nodes.map((n) => n.id)).toEqual(['n1', 'n4']);
    session.undo();
    expect(session.project.schematic.nodes).toHaveLength(4);
  });
});

describe('aligning, spreading and arranging from the view', () => {
  it('lines the selected nodes up, in one step, and says so when they already are', () => {
    const { session, view, nodes } = scene();
    view.selectAll();
    view.alignSelected('top');
    const tops = new Set(session.project.schematic.nodes.map((n) => n.y));
    expect(tops.size).toBe(1);
    const messages: string[] = [];
    session.notify = (m) => messages.push(m);
    view.alignSelected('top');
    expect(messages).toEqual(['The nodes are already in line.']);
    session.undo();
    expect(nodes()[2]).toEqual(['n3', 300, 40]);
  });

  it('asks for a selection when there is not one, and for three to spread', () => {
    const { session, view, at } = scene();
    const messages: string[] = [];
    session.notify = (m) => messages.push(m);
    view.alignSelected('left');
    view.pointerDown(plain, at('n2'));
    view.pointerUp(plain, at('n2'));
    view.distributeSelected('horizontal');
    expect(messages[0]).toMatch(/^Select two or more nodes first/);
    expect(messages[1]).toBe('Select three or more nodes first.');
  });

  it('puts the source above the loads when everything is arranged, in one step', () => {
    const { session, view } = scene();
    view.arrangeAll();
    const y = (id: string) => session.project.schematic.nodes.find((n) => n.id === id)!.y;
    expect(y('n1')).toBeLessThan(y('n2'));
    session.undo();
    expect(y('n1')).toBe(-300);
  });
});
