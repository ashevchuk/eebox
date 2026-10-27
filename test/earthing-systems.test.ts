import { describe, expect, it } from 'vitest';
import { EARTHING_SYSTEM_IDS, earthingProblem } from '../src/electrical/earthing';
import { conflictingConductors } from '../src/electrical/energy';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { findConnectionProblems } from '../src/electrical/problems';
import { findRuleWarnings } from '../src/electrical/rules';
import { createPanel } from '../src/layout/panel';
import type { ModuleDef } from '../src/library/types';
import { familiesMayShareNet } from '../src/library/types';
import type { Project } from '../src/project';
import { buildProjectFile, parseProjectFile } from '../src/project/file';
import { addNode, connect, emptySchematic, setSourceEarthing, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { place } from './fixtures';

const splitter: ModuleDef = {
  id: 'split',
  kind: 'busbar',
  name: 'PEN splitting block',
  widthUnits: 6,
  poles: 1,
  terminals: [
    { name: 'PEN', conductor: 'PEN', side: 'top', net: 'PEN', count: 2 },
    { name: 'N', conductor: 'N', side: 'bottom', net: 'PEN', count: 2 },
    { name: 'PE', conductor: 'PE', side: 'bottom', net: 'PEN', count: 2 },
  ],
};
const bond: ModuleDef = {
  id: 'bond',
  kind: 'busbar',
  name: 'N-PE bond',
  widthUnits: 2,
  poles: 1,
  terminals: [
    { name: 'N', conductor: 'N', side: 'top', net: 'B' },
    { name: 'PE', conductor: 'PE', side: 'top', net: 'B' },
  ],
};
const penBreaker: ModuleDef = {
  id: 'penbreaker',
  kind: 'breaker',
  name: 'Breaker with PEN',
  widthUnits: 2,
  poles: 2,
  terminals: [
    { name: 'PEN', conductor: 'PEN', side: 'top' },
    { name: 'PENb', conductor: 'PEN', side: 'bottom' },
  ],
};
const defs: Record<string, ModuleDef> = { split: splitter, bond, penbreaker: penBreaker };
const resolve = (r: { libraryId: string; moduleId: string }) => (r.libraryId === 'lib' ? defs[r.moduleId] : undefined);

interface Scene {
  project: Project;
  node: (label: string) => string;
}

/** A TN-C-S source feeding `splitters` splitting blocks, and a load that takes N and PE from the first. */
function scene(options: { splitters?: number; extra?: string[]; source?: string[]; section?: number } = {}): Scene {
  const splitters = options.splitters ?? 1;
  const placements = [...Array.from({ length: splitters }, (_, i) => place(`p${i + 1}`, 'split', 0, i * 6)), ...(options.extra ?? []).map((id, i) => place(`q${i + 1}`, id, 1, i * 3))];
  const panel = { ...createPanel([24, 24]), placements };
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const source = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -200, conductors: (options.source ?? ['L1', 'L2', 'L3', 'PEN']) as never, earthing: 'TN-C-S' });
  schematic = source.schematic;
  const load = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 300, conductors: ['L1', 'N', 'PE'] });
  schematic = load.schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const nodeOf = (placement: string) => schematic.nodes.find((n) => n.placementId === placement)!.id;
  const join = (a: { node: string; terminal: string }, b: { node: string; terminal: string }) => {
    const result = connect(schematic, terminalsOf, a, b);
    if (!result.ok) throw new Error(`${a.terminal} ${b.terminal}: ${result.error.kind}`);
    schematic = result.schematic;
  };
  for (let i = 1; i <= splitters; i++) join({ node: source.node.id, terminal: 'bottom:PEN' }, { node: nodeOf(`p${i}`), terminal: 'top:PEN1' });
  join({ node: nodeOf('p1'), terminal: 'bottom:N1' }, { node: load.node.id, terminal: 'top:N' });
  join({ node: nodeOf('p1'), terminal: 'bottom:PE1' }, { node: load.node.id, terminal: 'top:PE' });
  if (options.section !== undefined) schematic = { ...schematic, wires: schematic.wires.map((w, i) => (i === 0 ? { ...w, crossSectionMm2: options.section } : w)) };
  return { project: { panel, schematic }, node: (label) => schematic.nodes.find((n) => n.label === label)!.id };
}

describe('earthing systems', () => {
  it('lists the five systems and checks the conductors of a source against each', () => {
    expect(EARTHING_SYSTEM_IDS).toEqual(['TN-S', 'TN-C-S', 'TN-C', 'TT', 'IT']);
    expect(earthingProblem('TN-S', ['L1', 'L2', 'L3', 'N', 'PE'])).toBeNull();
    expect(earthingProblem('TN-C-S', ['L1', 'L2', 'L3', 'PEN'])).toBeNull();
    expect(earthingProblem('TN-C', ['L', 'PEN'])).toBeNull();
    expect(earthingProblem('TT', ['L', 'N', 'PE'])).toBeNull();
    expect(earthingProblem('IT', ['L1', 'L2', 'L3', 'PE'])).toBeNull();
    expect(earthingProblem('IT', ['L1', 'L2', 'L3', 'N', 'PE'])).toBeNull();
  });

  it('says what a source lacks and what it has that the system does not give', () => {
    expect(earthingProblem('TN-S', ['L1', 'N'])).toBe('TN-S supply lacks PE');
    expect(earthingProblem('TN-C-S', ['L1', 'N', 'PE'])).toBe('TN-C-S supply lacks PEN and has N, PE, which TN-C-S does not give');
    expect(earthingProblem('TT', ['L', 'N', 'PE', 'PEN'])).toBe('TT supply has PEN, which TT does not give');
  });

  it('lets a PEN share a net with N and PE, and nothing else with them', () => {
    const families = (...f: Array<'phase' | 'N' | 'PE' | 'PEN' | 'control'>) => new Set(f);
    expect(familiesMayShareNet(families('PEN', 'N', 'PE'))).toBe(true);
    expect(familiesMayShareNet(families('PEN', 'N'))).toBe(true);
    expect(familiesMayShareNet(families('N', 'PE'))).toBe(false);
    expect(familiesMayShareNet(families('PEN', 'phase'))).toBe(false);
    expect(conflictingConductors(['PEN', 'N', 'PE'])).toBe(false);
    expect(conflictingConductors(['N', 'PE'])).toBe(true);
    expect(conflictingConductors(['PEN', 'L1'])).toBe(true);
  });
});

describe('a PEN conductor split into N and PE', () => {
  it('has nothing wrong in a TN-C-S installation with one splitting block', () => {
    const { project } = scene();
    expect(findConnectionProblems(project, resolve)).toEqual([]);
    expect(findRuleWarnings(project, resolve).filter((w) => /PEN|supply/.test(w))).toEqual([]);
  });

  it('is an error where a second block splits it again on the same net', () => {
    const problems = findConnectionProblems(scene({ splitters: 2 }).project, resolve);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.message).toMatch(/^neutral and protective earth joined at more than one point: /);
  });

  it('is an error where N and PE are joined without a PEN', () => {
    const problems = findConnectionProblems(scene({ extra: ['bond'] }).project, resolve);
    expect(problems.map((p) => p.message.split(':')[0])).toEqual(['phase, neutral, earth or control conductors joined']);
  });
});

describe('earthing advice', () => {
  it('warns that the conductors of a source do not fit its system', () => {
    const added = addNode(emptySchematic(), { kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L1', 'L2', 'L3', 'N', 'PE'], earthing: 'TN-C-S' });
    const project: Project = { panel: createPanel([24]), schematic: added.schematic };
    expect(findRuleWarnings(project, resolve).some((w) => w.includes('Mains [n1]: TN-C-S supply lacks PEN'))).toBe(true);
  });

  it('warns of a PEN conductor below 10 mm2, and not of one at 10 mm2', () => {
    const small = findRuleWarnings(scene({ section: 6 }).project, resolve);
    expect(small.some((w) => w.includes('a PEN conductor of 6 mm2 is below the minimum of 10 mm2'))).toBe(true);
    const enough = findRuleWarnings(scene({ section: 10 }).project, resolve);
    expect(enough.some((w) => w.includes('PEN conductor of'))).toBe(false);
  });

  it('warns of a PEN conductor that passes through a switching device', () => {
    const warnings = findRuleWarnings(scene({ extra: ['penbreaker'] }).project, resolve);
    expect(warnings.some((w) => w.includes('a PEN conductor must not pass through a switching device'))).toBe(true);
  });
});

describe('the earthing system of a source in the schematic and the file', () => {
  it('is set and cleared on a source only', () => {
    const { project } = scene();
    const source = project.schematic.nodes.find((n) => n.kind === 'source')!.id;
    const load = project.schematic.nodes.find((n) => n.kind === 'load')!.id;
    const set = setSourceEarthing(project.schematic, source, 'TT');
    expect(set.ok && set.schematic.nodes.find((n) => n.id === source)?.earthing).toBe('TT');
    const cleared = set.ok && setSourceEarthing(set.schematic, source, undefined);
    expect(cleared && cleared.ok && 'earthing' in cleared.schematic.nodes.find((n) => n.id === source)!).toBe(false);
    expect(setSourceEarthing(project.schematic, load, 'TT')).toEqual({ ok: false, error: { kind: 'not-a-source' } });
    expect(setSourceEarthing(project.schematic, source, 'TN' as never)).toEqual({ ok: false, error: { kind: 'invalid-earthing' } });
  });

  it('is read from a project file when it names a known system on a source, and refused otherwise', () => {
    const { project } = scene();
    const file = (mutate: (nodes: Array<Record<string, unknown>>) => void) => {
      const nodes = JSON.parse(JSON.stringify(project.schematic.nodes)) as Array<Record<string, unknown>>;
      mutate(nodes);
      const built = buildProjectFile({ ...project, schematic: { nodes: nodes as never, wires: project.schematic.wires } }, resolve);
      return parseProjectFile(JSON.parse(JSON.stringify(built)));
    };
    expect(file(() => undefined).ok).toBe(true);
    expect(file((nodes) => (nodes.find((n) => n.kind === 'source')!.earthing = 'TN')).ok).toBe(false);
    expect(file((nodes) => (nodes.find((n) => n.kind === 'load')!.earthing = 'TT')).ok).toBe(false);
  });
});
