import { describe, expect, it } from 'vitest';
import { energy, positionOf, positionsOf } from '../src/electrical/energy';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { setPlacementState, type ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import type { Project } from '../src/project';
import { addNode, connect, connectAll, emptySchematic, setSourceOff, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { combAt, defs as fixtureDefs, panelOf, place } from './fixtures';

const defs: Record<string, ModuleDef> = {
  ...fixtureDefs,
  changeover: {
    id: 'changeover', kind: 'switch', name: 'Changeover', widthUnits: 4, poles: 2, ratedCurrentA: 40,
    terminals: [
      { name: 'La', conductor: 'L', side: 'top' }, { name: 'Na', conductor: 'N', side: 'top' },
      { name: 'Lb', conductor: 'L', side: 'top' }, { name: 'Nb', conductor: 'N', side: 'top' },
      { name: 'L', conductor: 'L', side: 'bottom' }, { name: 'N', conductor: 'N', side: 'bottom' },
    ],
  },
  meter: { id: 'meter', kind: 'meter', name: 'Meter', widthUnits: 2, poles: 2 },
};
const resolve = (r: ModuleRef): ModuleDef | undefined => defs[r.moduleId];

function sceneOf(moduleIds: string[], combs: Parameters<typeof panelOf>[1] = []) {
  let panel = panelOf(moduleIds.map((id, i) => place(`p${i + 1}`, id, 0, i * 4)), combs);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const wire = (a: [string, string], b: [string, string]) => {
    const result = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
    return schematic.wires[schematic.wires.length - 1]!.id;
  };
  const all = (a: string, b: string) => {
    const result = connectAll(schematic, nodeTerminalsLookup(panel, resolve), a, b);
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  };
  const add = (node: Parameters<typeof addNode>[1]) => {
    schematic = addNode(schematic, node).schematic;
    return schematic.nodes[schematic.nodes.length - 1]!.id;
  };
  const setState = (id: string, state: string | undefined) => {
    const def = resolve(panel.placements.find((p) => p.id === id)!.module)!;
    const result = setPlacementState(panel, id, state, positionsOf(def));
    if (!result.ok) throw new Error(result.error.kind);
    panel = result.panel;
  };
  const turnOff = (id: string, off: boolean) => {
    const result = setSourceOff(schematic, id, off);
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  };
  return { get project(): Project { return { panel, schematic }; }, wire, all, add, setState, turnOff };
}

const SOURCE = (label = 'Mains') => ({ kind: 'source' as const, label, x: 0, y: 0, conductors: ['L', 'N'] as Array<'L' | 'N'> });
const LOAD = (label = 'Load') => ({ kind: 'load' as const, label, x: 0, y: 0, conductors: ['L', 'N'] as Array<'L' | 'N'> });

describe('positions of a switching device', () => {
  it('are closed or open for a breaker and a switch, with closed as the default', () => {
    expect(positionsOf(defs.mcb1!)).toEqual(['closed', 'open']);
    expect(positionsOf(defs.contactor!)).toEqual(['closed', 'open']);
  });

  it('are the two inputs and open for a device with two supplies on its top side', () => {
    expect(positionsOf(defs.changeover!)).toEqual(['1', '2', 'open']);
  });

  it('are none for a device that does not switch', () => {
    expect(positionsOf(defs.meter!)).toEqual([]);
    expect(positionsOf(defs.nbar!)).toEqual([]);
  });

  it('give the default when nothing is set or the setting does not fit the device', () => {
    expect(positionOf({}, defs.mcb1!)).toBe('closed');
    expect(positionOf({ state: 'open' }, defs.mcb1!)).toBe('open');
    expect(positionOf({ state: '2' }, defs.mcb1!)).toBe('closed');
    expect(positionOf({ state: '2' }, defs.changeover!)).toBe('2');
    expect(positionOf({ state: 'open' }, defs.meter!)).toBeUndefined();
  });
});

describe('energy', () => {
  function chain() {
    const s = sceneOf(['mcb1']);
    const mains = s.add(SOURCE());
    const load = s.add(LOAD());
    const feed = s.wire([mains, 'bottom:L'], ['n1', 'top:L']);
    const branch = s.wire(['n1', 'bottom:L'], [load, 'top:L']);
    const neutral = s.wire([mains, 'bottom:N'], [load, 'top:N']);
    return { s, mains, load, feed, branch, neutral };
  }

  it('reaches everything behind a closed device', () => {
    const { s } = chain();
    const power = energy(s.project, resolve);
    expect(power.hasSource).toBe(true);
    expect([...power.deadWires]).toEqual([]);
    expect([...power.deadNodes]).toEqual([]);
  });

  it('stops at an open device: what is behind it is dead, what is before it is not', () => {
    const { s, load, feed, branch, neutral } = chain();
    s.setState('p1', 'open');
    const power = energy(s.project, resolve);
    expect([...power.deadWires]).toEqual([branch]);
    expect(power.deadWires.has(feed)).toBe(false);
    expect(power.deadWires.has(neutral)).toBe(false);
    expect([...power.deadNodes]).toEqual([load]);
    expect(power.placementLive('p1')).toBe(true);
  });

  it('leaves the device itself live when its input is, and dead when the source is off', () => {
    const { s, mains } = chain();
    s.turnOff(mains, true);
    const power = energy(s.project, resolve);
    expect(power.placementLive('p1')).toBe(false);
    expect(power.deadWires.size).toBe(2);
    s.turnOff(mains, false);
    expect(energy(s.project, resolve).deadWires.size).toBe(0);
  });

  it('reports nothing dead when there is no source at all, as there is nothing to feed anything', () => {
    const s = sceneOf(['mcb1']);
    const load = s.add(LOAD());
    s.wire(['n1', 'bottom:L'], [load, 'top:L']);
    const power = energy(s.project, resolve);
    expect(power.hasSource).toBe(false);
    expect(power.deadWires.size + power.deadNodes.size).toBe(0);
  });

  it('feeds the breakers under a comb from the one that is wired, whichever is open', () => {
    const s = sceneOf(['mcb1', 'mcb1'], [combAt('c1', 'comb1', 0, 0)]);
    const mains = s.add(SOURCE());
    const load = s.add(LOAD());
    s.wire([mains, 'bottom:L'], ['n1', 'top:L']);
    s.wire(['n2', 'bottom:L'], [load, 'top:L']);
    s.setState('p1', 'open');
    expect(energy(s.project, resolve).deadNodes.has(load)).toBe(false);
  });

  it('passes through a device that does not switch, like a meter', () => {
    const s = sceneOf(['meter']);
    const mains = s.add(SOURCE());
    const load = s.add(LOAD());
    s.wire([mains, 'bottom:L'], ['n1', 'top:L']);
    s.wire(['n1', 'bottom:L'], [load, 'top:L']);
    expect(energy(s.project, resolve).deadNodes.size).toBe(0);
  });
});

describe('a changeover switch', () => {
  function backup() {
    const s = sceneOf(['changeover']);
    const mains = s.add(SOURCE('Mains'));
    const generator = s.add(SOURCE('Generator'));
    const load = s.add(LOAD());
    s.wire([mains, 'bottom:L'], ['n1', 'top:La']);
    s.wire([generator, 'bottom:L'], ['n1', 'top:Lb']);
    s.wire(['n1', 'bottom:L'], [load, 'top:L']);
    return { s, mains, generator, load };
  }
  const loadIsDead = (s: ReturnType<typeof sceneOf>, load: string) => energy(s.project, resolve).deadNodes.has(load);

  it('takes input 1 by default, so the load follows the mains', () => {
    const { s, mains, load } = backup();
    expect(loadIsDead(s, load)).toBe(false);
    s.turnOff(mains, true);
    expect(loadIsDead(s, load)).toBe(true);
  });

  it('feeds the load from the generator when it is switched to input 2, and from nothing when it is open', () => {
    const { s, mains, load } = backup();
    s.turnOff(mains, true);
    s.setState('p1', '2');
    expect(loadIsDead(s, load)).toBe(false);
    s.setState('p1', 'open');
    expect(loadIsDead(s, load)).toBe(true);
  });

  it('does not feed the load from the generator on input 1 when the mains is off', () => {
    const { s, mains, generator, load } = backup();
    s.turnOff(mains, true);
    expect(loadIsDead(s, load)).toBe(true);
    s.turnOff(generator, true);
    s.setState('p1', '2');
    expect(loadIsDead(s, load)).toBe(true);
  });
});

describe('setPlacementState and setSourceOff', () => {
  it('set and clear a position, and refuse one the device has not or a module that is not there', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 0)]);
    const set = setPlacementState(panel, 'p1', 'open', ['closed', 'open']);
    if (!set.ok) throw new Error(set.error.kind);
    expect(set.panel.placements[0]!.state).toBe('open');
    const cleared = setPlacementState(set.panel, 'p1', undefined, ['closed', 'open']);
    if (!cleared.ok) throw new Error(cleared.error.kind);
    expect('state' in cleared.panel.placements[0]!).toBe(false);
    expect(setPlacementState(panel, 'p1', '2', ['closed', 'open'])).toEqual({ ok: false, error: { kind: 'invalid-state' } });
    expect(setPlacementState(panel, 'p9', 'open', ['open'])).toEqual({ ok: false, error: { kind: 'unknown-placement' } });
  });

  it('switch a source off and on again, and refuse a node that is not a source', () => {
    const node = addNode(emptySchematic(), SOURCE());
    const off = setSourceOff(node.schematic, 'n1', true);
    if (!off.ok) throw new Error(off.error.kind);
    expect(off.schematic.nodes[0]!.off).toBe(true);
    const on = setSourceOff(off.schematic, 'n1', false);
    if (!on.ok) throw new Error(on.error.kind);
    expect('off' in on.schematic.nodes[0]!).toBe(false);
    const load = addNode(emptySchematic(), LOAD());
    expect(setSourceOff(load.schematic, 'n1', true)).toEqual({ ok: false, error: { kind: 'not-a-source' } });
    expect(setSourceOff(node.schematic, 'n9', true)).toEqual({ ok: false, error: { kind: 'unknown-node' } });
  });
});

describe('positions in the project file', () => {
  const stored = () => {
    const s = sceneOf(['mcb1', 'changeover']);
    const mains = s.add(SOURCE());
    s.turnOff(mains, true);
    s.setState('p1', 'open');
    s.setState('p2', '2');
    return JSON.parse(JSON.stringify(buildProjectFile(s.project, resolve)));
  };

  it('survive saving and loading, together with a source that is off', () => {
    const parsed = parseProjectJson(JSON.stringify(stored()));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.file.project.panel.placements.map((p) => p.state)).toEqual(['open', '2']);
    expect(parsed.file.project.schematic.nodes.find((n) => n.kind === 'source')?.off).toBe(true);
  });

  it('are refused when they are not a known position, and off is refused on anything but a source', () => {
    const bad = stored();
    bad.project.panel.placements[0].state = 'half';
    expect(parseProjectJson(JSON.stringify(bad)).ok).toBe(false);
    const wrongNode = stored();
    wrongNode.project.schematic.nodes.find((n: { kind: string }) => n.kind === 'module').off = true;
    expect(parseProjectJson(JSON.stringify(wrongNode)).ok).toBe(false);
    const notTrue = stored();
    notTrue.project.schematic.nodes.find((n: { kind: string }) => n.kind === 'source').off = false;
    expect(parseProjectJson(JSON.stringify(notTrue)).ok).toBe(false);
  });
});

describe('inspector: position, supply and supplied', () => {
  function scene() {
    const s = sceneOf(['mcb1']);
    const mains = s.add(SOURCE());
    const load = s.add(LOAD());
    s.wire([mains, 'bottom:L'], ['n1', 'top:L']);
    s.wire(['n1', 'bottom:L'], [load, 'top:L']);
    return { s, mains, load };
  }
  const ctx = (project: Project, selection: InspectContext['selection'], mode: InspectContext['mode'] = 'schematic'): InspectContext => ({
    project, selection, mode, resolve, snapshot: {}, fromLibraries: resolve,
  });
  const field = (c: InspectContext, key: string) => inspect(c).fields.find((f) => f.key === key);

  it('offers the position of a switching device and nothing for one that does not switch', () => {
    const { s } = scene();
    expect(field(ctx(s.project, { placementId: 'p1' }, 'panel'), 'state')).toMatchObject({ kind: 'select', value: 'closed', options: ['closed', 'open'] });
    const meter = sceneOf(['meter']);
    expect(field(ctx(meter.project, { placementId: 'p1' }, 'panel'), 'state')).toBeUndefined();
  });

  it('sets the position through an edit, refuses a wrong one, and then reports the module and the load as unsupplied', () => {
    const { s, load } = scene();
    const edited = applyEdit(ctx(s.project, { placementId: 'p1' }, 'panel'), 'state', 'open');
    if (!edited.ok) throw new Error(edited.message);
    expect(edited.project.panel.placements[0]!.state).toBe('open');
    expect(applyEdit(ctx(s.project, { placementId: 'p1' }, 'panel'), 'state', 'half')).toMatchObject({ ok: false, message: 'That position is not one this device has.' });
    expect(field(ctx(edited.project, { nodeId: load }), 'supplied')?.value).toBe('no');
    expect(field(ctx(s.project, { nodeId: load }), 'supplied')?.value).toBe('yes');
  });

  it('switches a source off and shows that its load has lost power', () => {
    const { s, mains, load } = scene();
    expect(field(ctx(s.project, { nodeId: mains }), 'supply')).toMatchObject({ kind: 'select', value: 'on', options: ['on', 'off'] });
    const edited = applyEdit(ctx(s.project, { nodeId: mains }), 'supply', 'off');
    if (!edited.ok) throw new Error(edited.message);
    expect(field(ctx(edited.project, { nodeId: mains }), 'supply')?.value).toBe('off');
    expect(field(ctx(edited.project, { nodeId: load }), 'supplied')?.value).toBe('no');
    expect(field(ctx(edited.project, { placementId: 'p1' }, 'panel'), 'supplied')?.value).toBe('no');
  });

  it('says nothing about being supplied when the project has no source', () => {
    const s = sceneOf(['mcb1']);
    const load = s.add(LOAD());
    expect(field(ctx(s.project, { nodeId: load }), 'supplied')).toBeUndefined();
  });
});
