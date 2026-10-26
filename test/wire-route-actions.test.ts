import { describe, expect, it } from 'vitest';
import { clearWireRoutes, emptySchematic } from '../src/schematic/model';
import { applyAction, inspect } from '../src/ui/inspector';
import { panelOf, resolve } from './fixtures';

const wire = (id: string, route?: number[]) => ({ id, a: { node: 'n1', terminal: 'bottom:L' }, b: { node: 'n2', terminal: 'top:L' }, ...(route ? { route } : {}) });
const schematic = () => ({
  ...emptySchematic(),
  nodes: [
    { id: 'n1', kind: 'source' as const, label: 'S', x: 0, y: 0, conductors: ['L' as const] },
    { id: 'n2', kind: 'load' as const, label: 'Q', x: 0, y: 200, conductors: ['L' as const] },
  ],
  wires: [wire('w1', [120]), wire('w2'), wire('w3', [100, 50, 150])],
});
const context = (wireId: string) => ({
  project: { panel: panelOf([]), schematic: schematic() },
  selection: { wireId },
  mode: 'schematic' as const,
  resolve,
  snapshot: {},
  fromLibraries: resolve,
});

describe('clearWireRoutes', () => {
  it('takes the route off every wire and says how many had one', () => {
    const { schematic: cleared, cleared: count } = clearWireRoutes(schematic());
    expect(count).toBe(2);
    expect(cleared.wires.some((w) => 'route' in w)).toBe(false);
    expect(cleared.wires.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
  });

  it('gives back the very same schematic when no wire has a route', () => {
    const plain = { ...schematic(), wires: [wire('w2')] };
    expect(clearWireRoutes(plain).schematic).toBe(plain);
  });
});

describe('the wire in the inspector', () => {
  const fields = (id: string) => Object.fromEntries(inspect(context(id)).fields.map((f) => [f.key, f.value]));

  it('says whether the route is automatic or by hand', () => {
    expect(fields('w2').route).toBe('automatic');
    expect(fields('w1').route).toBe('by hand, 2 bends');
    expect(fields('w3').route).toBe('by hand, 4 bends');
  });

  it('offers to route a wire automatically only when it has a route', () => {
    expect(inspect(context('w1')).actions.map((a) => a.key)).toEqual(['routeAutomatically']);
    expect(inspect(context('w2')).actions).toEqual([]);
  });

  it('takes the route off that wire and leaves the others alone', () => {
    const result = applyAction(context('w1'), 'routeAutomatically');
    if (!result.ok) throw new Error(result.message);
    expect(result.project.schematic.wires.map((w) => w.route)).toEqual([undefined, undefined, [100, 50, 150]]);
  });
});
