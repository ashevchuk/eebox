import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { parseProjectJson } from '../src/project/file';
import { computeLayout } from '../src/schematic/geometry';
import { routeWires } from '../src/schematic/router';
import { segmentsOf } from '../src/schematic/wireEditing';
import { SchematicView } from '../src/ui/schematicView';
import { Session } from '../src/ui/session';
import scene from './fixtures/three-contactors.eebox.json?raw';

const plain = {} as PointerEvent;

const same = (a: { x: number; y: number }[] | undefined, b: { x: number; y: number }[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-6 && Math.abs(p.y - b[i]!.y) < 1e-6);

/** Three contactors wired phase to phase; some automatic paths run closer to a terminal than a pulled lane may. */
function open() {
  const parsed = parseProjectJson(scene);
  if (!parsed.ok) throw new Error('fixture does not load');
  const session = new Session();
  session.load(parsed.file);
  const paths = () => {
    const schematic = session.project.schematic;
    return routeWires(schematic, computeLayout(schematic, nodeTerminalsLookup(session.project.panel, session.resolve)));
  };
  return { session, view: new SchematicView(session), paths };
}

describe('pulling one wire of a dense scene', () => {
  it('leaves every other wire drawn where it was, whichever piece is pulled and whichever way', () => {
    const { session, view, paths } = open();
    const base = paths();
    let pulls = 0;
    for (const wire of session.project.schematic.wires) {
      const segments = segmentsOf(base.get(wire.id)!);
      segments.forEach((segment, index) => {
        if (index === 0 || index === segments.length - 1) return;
        const middle = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
        const across = segment.vertical ? { x: 1, y: 0 } : { x: 0, y: 1 };
        for (const direction of [1, -1]) {
          const before = paths();
          view.pointerDown(plain, middle);
          for (let i = 1; i <= 5; i++) view.pointerMove(plain, { x: middle.x + across.x * 14 * i * direction, y: middle.y + across.y * 14 * i * direction });
          view.pointerUp(plain, { x: middle.x + across.x * 70 * direction, y: middle.y + across.y * 70 * direction });
          const after = paths();
          const picked = session.selection.wireId;
          const moved = session.project.schematic.wires.filter((w) => w.id !== picked && !same(before.get(w.id), after.get(w.id))).map((w) => w.id);
          expect(moved, `wire ${wire.id} piece ${index} direction ${direction}`).toEqual([]);
          pulls++;
          session.undo();
        }
      });
    }
    expect(pulls).toBeGreaterThan(30);
  });
});
