import { describe, expect, it } from 'vitest';
import { netContextOf } from '../src/electrical/context';
import { directionOf } from '../src/electrical/direction';
import { energy } from '../src/electrical/energy';
import { loadReports, wireCurrents } from '../src/electrical/loads';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { findRuleWarnings } from '../src/electrical/rules';
import { terminalsOf } from '../src/electrical/terminals';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import { validateLibrary } from '../src/library/validate';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { AUTOMATION_TEMPLATES } from '../src/ui/automationTemplates';
import { panelOf, place } from './fixtures';

const rail = { heightMm: 90, mounting: 'rail', poles: 1, widthUnits: 1 } as const;
const local: Record<string, ModuleDef> = {
  b6: { id: 'b6', kind: 'breaker', name: 'B6', ratedCurrentA: 6, ...rail },
  b10: { id: 'b10', kind: 'breaker', name: 'B10', ratedCurrentA: 10, ...rail },
  b16: { id: 'b16', kind: 'breaker', name: 'B16', ratedCurrentA: 16, ...rail },
  rcdTop: { id: 'rcdTop', kind: 'rcd', name: 'RCD top', feed: 'top', ...rail },
};
const resolve = (r: ModuleRef): ModuleDef | undefined => local[r.moduleId];

type End = [placement: string | 'source' | 'load', terminal: 'top:L' | 'bottom:L'];

/** Modules p1, p2, ... on one rail, a source and a load, wired terminal to terminal as given. */
function scene(moduleIds: string[], wires: Array<[End, End]>) {
  const placements = moduleIds.map((id, i) => place(`p${i + 1}`, id, 0, i));
  const panel = panelOf(placements);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -300, conductors: ['L', 'N', 'PE'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Load', x: 0, y: 600, conductors: ['L', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const nodeOf = (name: string) =>
    name === 'source' ? schematic.nodes.find((n) => n.kind === 'source')!.id : name === 'load' ? schematic.nodes.find((n) => n.kind === 'load')!.id : schematic.nodes.find((n) => n.placementId === name)!.id;
  for (const [a, b] of wires) {
    const result = connect(schematic, terminalsOf, { node: nodeOf(a[0]), terminal: a[1] }, { node: nodeOf(b[0]), terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  }
  const project: Project = { panel, schematic };
  return { project, warnings: () => findRuleWarnings(project, resolve), direction: () => directionOf(netContextOf(project, resolve)) };
}

const about = (warnings: string[], text: string) => warnings.filter((w) => w.includes(text));
const FED_FROM_THE_BOTTOM: Array<[End, End]> = [
  [['source', 'bottom:L'], ['p1', 'bottom:L']],
  [['p1', 'top:L'], ['p2', 'bottom:L']],
  [['p2', 'top:L'], ['load', 'top:L']],
];

describe('a device fed from the bottom, which its maker allows when it names no input', () => {
  it('is not blamed for an output that is not wired: its top is the output', () => {
    const lonely = scene(['b16'], [[['source', 'bottom:L'], ['p1', 'bottom:L']]]);
    expect(about(lonely.warnings(), 'input is not fed')).toEqual([]);
  });

  it('is checked against what its top feeds, so the breaker ahead of a bigger one is the one reported', () => {
    const chain = scene(['b6', 'b10'], FED_FROM_THE_BOTTOM);
    expect(about(chain.warnings(), 'add up to')).toEqual(['B6 [p1]: the modules it feeds add up to 10 A on one phase, above its rating of 6 A']);
  });

  it('passes when the breaker ahead is the bigger one', () => {
    expect(about(scene(['b16', 'b10'], FED_FROM_THE_BOTTOM).warnings(), 'add up to')).toEqual([]);
  });

  it('keeps working from the top, as before', () => {
    const fromTop = scene(['b6', 'b10'], [
      [['source', 'bottom:L'], ['p1', 'top:L']],
      [['p1', 'bottom:L'], ['p2', 'top:L']],
    ]);
    expect(about(fromTop.warnings(), 'add up to')).toEqual(['B6 [p1]: the modules it feeds add up to 10 A on one phase, above its rating of 6 A']);
  });
});

describe('the direction of a device that nothing reaches', () => {
  it('is the usual one: the top is the input and the bottom the output', () => {
    const direction = scene(['b6'], []).direction();
    expect(direction.isInput('p:p1/top:L')).toBe(true);
    expect(direction.isOutput('p:p1/bottom:L')).toBe(true);
    expect(direction.isInput('p:p1/bottom:L')).toBe(false);
  });

  it('turns round when the source is wired to the bottom', () => {
    const direction = scene(['b6'], [[['source', 'bottom:L'], ['p1', 'bottom:L']]]).direction();
    expect(direction.isInput('p:p1/bottom:L')).toBe(true);
    expect(direction.isOutput('p:p1/top:L')).toBe(true);
  });
});

describe('a device whose maker fixes the input at the top', () => {
  it('is fine when fed at the top', () => {
    const fed = scene(['rcdTop'], [[['source', 'bottom:L'], ['p1', 'top:L']]]);
    expect(about(fed.warnings(), 'marks as an output')).toEqual([]);
  });

  it('is reported when it is fed at the bottom, and its direction does not turn round', () => {
    const wrong = scene(['rcdTop'], [[['source', 'bottom:L'], ['p1', 'bottom:L']]]);
    expect(about(wrong.warnings(), 'marks as an output')).toEqual(['RCD top [p1]: it is fed through a terminal that its maker marks as an output']);
    expect(wrong.direction().isInput('p:p1/top:L')).toBe(true);
  });

  it('gets its terminal roles from the side its maker names', () => {
    const roles = terminalsOf(local.rcdTop!).map((t) => `${t.id}=${t.role}`);
    expect(roles).toEqual(['top:L=input', 'bottom:L=output']);
    expect(terminalsOf(local.b6!).every((t) => t.role === undefined)).toBe(true);
  });
});

describe('a device that is fed from both of its sides', () => {
  it('is reported, because something goes round it', () => {
    const bypassed = scene(['b6'], [
      [['source', 'bottom:L'], ['p1', 'top:L']],
      [['source', 'bottom:L'], ['p1', 'bottom:L']],
    ]);
    expect(about(bypassed.warnings(), 'both of its sides')).toEqual(['B6 [p1]: it is fed from both of its sides, so something goes round it']);
    expect(about(bypassed.warnings(), 'add up to')).toEqual([]);
  });
});

describe('the roles in a library', () => {
  const library = (module: object) => ({
    schemaVersion: 1,
    id: 'mine',
    name: 'Mine',
    modules: [{ id: 'm1', kind: 'rcd', name: 'M1', widthUnits: 2, heightMm: 90, mounting: 'rail', poles: 2, ...module }],
  });
  const terminal = (role: unknown) => ({ name: 'L', conductor: 'L', side: 'top', role });
  const errors = (raw: unknown) => {
    const result = validateLibrary(raw);
    return result.ok ? [] : result.errors.map((e) => e.path);
  };

  it('accepts a feed side, and a role on explicit terminals', () => {
    expect(validateLibrary(library({ feed: 'top' })).ok).toBe(true);
    expect(validateLibrary(library({ terminals: [terminal('input')] })).ok).toBe(true);
  });

  it('refuses a feed side that is not a side, and a role that is not a role', () => {
    expect(errors(library({ feed: 'left' }))).toContain('modules[0].feed');
    expect(errors(library({ terminals: [terminal('source')] }))).toContain('modules[0].terminals[0].role');
  });

  it('refuses a feed side next to explicit terminals, which carry their own roles', () => {
    expect(errors(library({ feed: 'top', terminals: [terminal('input')] }))).toContain('modules[0].feed');
  });
});

describe('the templates of devices that have an input and an output by design', () => {
  const built = (id: string): ModuleDef => AUTOMATION_TEMPLATES.find((t) => t.id === id)!.build('made');

  it.each(['soft-starter', 'frequency-drive', 'transformer-1p', 'power-supply-24v-large'])('%s takes its input on top and gives its output below', (id) => {
    const module = built(id);
    expect(module.terminals!.filter((t) => t.side === 'top').every((t) => t.role === 'input')).toBe(true);
    expect(module.terminals!.filter((t) => t.side === 'bottom').every((t) => t.role === 'output')).toBe(true);
    expect(validateLibrary({ schemaVersion: 1, id: 'mine', name: 'Mine', modules: [module] }).ok).toBe(true);
  });

  it('leaves the others without roles, such as a controller whose terminals are not a feed', () => {
    expect(built('plc').terminals!.every((t) => t.role === undefined)).toBe(true);
  });
});

describe('the calculations for a circuit fed from the bottom of its breaker', () => {
  const circuit = (wires: Array<[End, End]>): Project => {
    const { project } = scene(['b16'], wires);
    const load = project.schematic.nodes.find((n) => n.kind === 'load')!;
    const loaded = setNodeLoad(project.schematic, load.id, { powerW: 2300 });
    if (!loaded.ok) throw new Error(loaded.error.kind);
    return { ...project, schematic: loaded.schematic };
  };
  const fromBottom = circuit([
    [['source', 'bottom:L'], ['p1', 'bottom:L']],
    [['p1', 'top:L'], ['load', 'top:L']],
  ]);
  const fromTop = circuit([
    [['source', 'bottom:L'], ['p1', 'top:L']],
    [['p1', 'bottom:L'], ['load', 'top:L']],
  ]);

  it('finds the breaker of the load, as it does when fed from the top', () => {
    for (const project of [fromTop, fromBottom]) {
      const [report] = loadReports(project, resolve);
      expect(report?.breakerA).toBe(16);
      expect(report?.breakerPlacementId).toBe('p1');
    }
  });

  it('shows the same current in the wires, and no dead part', () => {
    expect([...wireCurrents(fromBottom, resolve).values()]).toEqual([...wireCurrents(fromTop, resolve).values()]);
    expect(energy(fromBottom, resolve).deadWires.size).toBe(0);
    expect(energy(fromBottom, resolve).deadNodes.size).toBe(0);
  });
});
