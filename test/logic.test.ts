import { describe, expect, it } from 'vitest';
import { energy } from '../src/electrical/energy';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { ModuleRef } from '../src/layout/placement';
import { evaluateExpression, parseExpression } from '../src/library/logicExpression';
import type { ModuleDef } from '../src/library/types';
import { validateLibrary } from '../src/library/validate';
import { addNode, connect, emptySchematic, setSourceOff, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place } from './fixtures';

const relay: ModuleDef = {
  id: 'relay', kind: 'relay', name: 'Voltage relay', widthUnits: 1, poles: 2,
  terminals: [
    { name: 'L', conductor: 'L', side: 'top' }, { name: 'N', conductor: 'N', side: 'top' },
    { name: '11', conductor: 'C', side: 'bottom' }, { name: '12', conductor: 'C', side: 'bottom' }, { name: '14', conductor: 'C', side: 'bottom' },
  ],
  logic: {
    inputs: { V: { terminals: ['top:L', 'top:N'], when: 'all' } },
    contacts: [
      { between: ['bottom:11', 'bottom:14'], closedWhen: 'V' },
      { between: ['bottom:11', 'bottom:12'], closedWhen: '!V' },
    ],
  },
};
const contactor: ModuleDef = {
  id: 'contactor', kind: 'contactor', name: 'Contactor', widthUnits: 1, poles: 1,
  terminals: [
    { name: 'A1', conductor: 'L', side: 'top' }, { name: 'A2', conductor: 'N', side: 'top' },
    { name: 'P1', conductor: 'L', side: 'top' }, { name: 'T1', conductor: 'L', side: 'bottom' },
  ],
  logic: { inputs: { coil: { terminals: ['top:A1', 'top:A2'], when: 'all' } }, contacts: [{ between: ['top:P1', 'bottom:T1'], closedWhen: 'coil' }] },
};
const defs: Record<string, ModuleDef> = { relay, contactor };
const resolve = (r: ModuleRef): ModuleDef | undefined => defs[r.moduleId];

function sceneOf(moduleIds: string[]) {
  const panel = panelOf(moduleIds.map((id, i) => place(`p${i + 1}`, id, 0, i * 2)));
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const add = (kind: 'source' | 'load', label: string, conductors: Array<'L' | 'N'>) => {
    schematic = addNode(schematic, { kind, label, x: 0, y: 0, conductors }).schematic;
    return schematic.nodes[schematic.nodes.length - 1]!.id;
  };
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const wire = (a: [string, string], b: [string, string]) => {
    const result = connect(schematic, terminalsOf, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  };
  const off = (id: string) => {
    const result = setSourceOff(schematic, id, true);
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  };
  return {
    panel,
    add,
    wire,
    off,
    power: (placed = panel) => energy({ panel: placed, schematic }, resolve),
  };
}

describe('a voltage relay switching an auxiliary supply', () => {
  function build() {
    const s = sceneOf(['relay']);
    const mains = s.add('source', 'Mains', ['L', 'N']);
    const aux = s.add('source', 'Aux', ['L']);
    const lamp = s.add('load', 'Lamp', ['L']);
    s.wire([mains, 'bottom:L'], ['n1', 'top:L']);
    s.wire([mains, 'bottom:N'], ['n1', 'top:N']);
    s.wire([aux, 'bottom:L'], ['n1', 'bottom:11']);
    s.wire(['n1', 'bottom:14'], [lamp, 'top:L']);
    return { ...s, mains, lamp };
  }

  it('closes the normally open contact while the relay senses voltage', () => {
    const s = build();
    expect(s.power().deadNodes.has(s.lamp)).toBe(false);
    expect(s.power().inputsOf('p1')).toEqual({ V: true });
    expect(s.power().contactsOf('p1')).toEqual({ closed: 1, total: 2 });
  });

  it('opens it when the mains go away, and the lamp goes dead', () => {
    const s = build();
    s.off(s.mains);
    expect(s.power().deadNodes.has(s.lamp)).toBe(true);
    expect(s.power().inputsOf('p1')).toEqual({ V: false });
  });

  it('does not count a coil as energised when only one of its terminals is fed', () => {
    const s = sceneOf(['relay']);
    const mains = s.add('source', 'Mains', ['L', 'N']);
    s.wire([mains, 'bottom:L'], ['n1', 'top:L']);
    expect(s.power().inputsOf('p1')).toEqual({ V: false });
  });
});

describe('a contactor', () => {
  function build() {
    const s = sceneOf(['relay', 'contactor']);
    const mains = s.add('source', 'Mains', ['L', 'N']);
    const motor = s.add('load', 'Motor', ['L']);
    s.wire([mains, 'bottom:L'], ['n2', 'top:P1']);
    s.wire(['n2', 'bottom:T1'], [motor, 'top:L']);
    s.wire([mains, 'bottom:N'], ['n2', 'top:A2']);
    return { ...s, mains, motor };
  }

  it('is open without a coil supply, and follows its coil once the coil is fed through a relay contact', () => {
    const s = build();
    expect(s.power().deadNodes.has(s.motor)).toBe(true);
    s.wire([s.mains, 'bottom:L'], ['n1', 'top:L']);
    s.wire([s.mains, 'bottom:N'], ['n1', 'top:N']);
    s.wire([s.mains, 'bottom:L'], ['n1', 'bottom:11']);
    s.wire(['n1', 'bottom:14'], ['n2', 'top:A1']);
    expect(s.power().inputsOf('p2')).toEqual({ coil: true });
    expect(s.power().deadNodes.has(s.motor)).toBe(false);
  });

  it('can be forced closed or open by hand', () => {
    const s = build();
    const forced = (state: string) =>
      s.power({ ...s.panel, placements: s.panel.placements.map((p) => (p.id === 'p2' ? { ...p, state } : p)) });
    expect(forced('closed').deadNodes.has(s.motor)).toBe(false);
    expect(forced('open').deadNodes.has(s.motor)).toBe(true);
  });
});

describe('logic expressions', () => {
  const value = (text: string, on: string[]) => {
    const parsed = parseExpression(text);
    if (!parsed.ok) throw new Error(parsed.message);
    return evaluateExpression(parsed.expression, (name) => on.includes(name));
  };

  it('bind ! tighter than & and & tighter than |', () => {
    expect(value('!A & B | C', ['C'])).toBe(true);
    expect(value('!A & B | C', ['A', 'B'])).toBe(false);
    expect(value('A & (B | C)', ['A', 'C'])).toBe(true);
    expect(value('!!A', ['A'])).toBe(true);
  });

  it('report where they are wrong', () => {
    for (const bad of ['', 'A &', '(A', 'A B', 'A $ B', ')']) expect(parseExpression(bad).ok).toBe(false);
  });
});

describe('logic in a library', () => {
  const library = (logic: unknown, extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1, id: 'lib', name: 'Lib',
    modules: [{ ...relay, logic, ...extra }],
  });
  const paths = (raw: unknown) => {
    const result = validateLibrary(raw);
    return result.ok ? [] : result.errors.map((e) => e.path);
  };

  it('accepts the logic of a relay', () => {
    expect(validateLibrary(library(relay.logic)).ok).toBe(true);
  });

  it('refuses unknown terminals, unknown inputs in an expression, bad expressions and unknown fields', () => {
    expect(paths(library({ inputs: { V: { terminals: ['top:Q'], when: 'all' } }, contacts: [] }))).toEqual(['modules[0].logic.inputs.V.terminals[0]']);
    expect(paths(library({ inputs: { V: relay.logic!.inputs.V }, contacts: [{ between: ['bottom:11', 'bottom:14'], closedWhen: 'W' }] }))).toEqual([
      'modules[0].logic.contacts[0].closedWhen',
    ]);
    expect(paths(library({ inputs: { V: relay.logic!.inputs.V }, contacts: [{ between: ['bottom:11', 'bottom:14'], closedWhen: 'V &' }] }))).toEqual([
      'modules[0].logic.contacts[0].closedWhen',
    ]);
    expect(paths(library({ inputs: {}, contacts: [], surprise: 1 }))).toEqual(['modules[0].logic.surprise']);
  });

  it('needs explicit terminals', () => {
    const { terminals: _t, ...bare } = relay;
    expect(paths({ schemaVersion: 1, id: 'lib', name: 'Lib', modules: [bare] })).toEqual(['modules[0].logic']);
  });
});
