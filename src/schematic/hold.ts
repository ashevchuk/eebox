import type { Point } from '../view/Camera';
import { portOf, type Layout } from './geometry';
import { lanesFromPath, pathFromLanes, type Lanes } from './manualRoute';
import type { Schematic } from './model';
import { setWireRoute } from './model';
import { routeWires } from './router';

/** How many times the wires are laid out again while the ones that move are held; each round holds more, so it ends quickly. */
const MAX_ROUNDS = 8;

const same = (a: readonly Point[], b: readonly Point[]): boolean =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-6 && Math.abs(p.y - b[i]!.y) < 1e-6);

/**
 * The route that holds a wire on `path`, or undefined when the path is not of the shape a route has or a route
 * would not draw it exactly the same: a wire that is held must not look different from what it was.
 */
export function holdingRoute(path: readonly Point[] | undefined, schematic: Schematic, layout: Layout, wireId: string): Lanes | undefined {
  const wire = schematic.wires.find((w) => w.id === wireId);
  const a = wire && portOf(layout, wire.a);
  const b = wire && portOf(layout, wire.b);
  const lanes = path ? lanesFromPath([...path]) : undefined;
  if (!path || !lanes || !a || !b) return undefined;
  const drawn = pathFromLanes({ point: a.point, side: a.terminal.side }, { point: b.point, side: b.terminal.side }, lanes);
  return same(drawn, path) ? lanes : undefined;
}

/**
 * Keeps the wires that nobody touched where they were. The router lays the wires that have no route out again
 * whenever anything changes, so pulling one wire can make others jump; each automatic wire that would now be
 * drawn somewhere else is given the route it was drawn on, `before`, and the rest are laid out again, until
 * every one of them is where it was. A wire that has a route, or is in `moved`, is left as it is, and so is one
 * whose path a route could not draw exactly as it was.
 */
export function holdOthersStill(schematic: Schematic, layout: Layout, before: ReadonlyMap<string, readonly Point[]>, moved: ReadonlySet<string>): Schematic {
  let held = schematic;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const now = routeWires(held, layout);
    let changed = false;
    for (const wire of held.wires) {
      if (wire.route || moved.has(wire.id)) continue;
      const was = before.get(wire.id);
      const is = now.get(wire.id);
      if (!was || !is || same(was, is)) continue;
      const route = holdingRoute(was, held, layout, wire.id);
      if (!route) continue;
      const result = setWireRoute(held, wire.id, route);
      if (!result.ok) continue;
      held = result.schematic;
      changed = true;
    }
    if (!changed) break;
  }
  return held;
}
