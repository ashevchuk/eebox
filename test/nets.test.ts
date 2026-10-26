import { describe, expect, it } from 'vitest';
import { buildNets, combContacts, findNetProblems, type Net } from '../src/electrical/nets';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { combAt, panelOf, place, resolve } from './fixtures';

const describeNet = (net: Net) => net.terminals.map((t) => t.key).sort();
const netsOf = (project: Project) => buildNets(project, resolve).map(describeNet);

const projectOf = (panel: Project['panel'], schematic: Schematic = emptySchematic()): Project => ({ panel, schematic });

describe('combContacts', () => {
  it('distributes the phases of a 3-phase comb over single-pole breakers', () => {
    const panel = panelOf(
      [0, 1, 2, 3, 4, 5].map((i) => place(`p${i}`, 'mcb1', 0, i)),
      [combAt('c1', 'comb3', 0, 0)],
    );
    expect(combContacts(panel, resolve).map((c) => `${c.placementId}:${c.pin}`)).toEqual([
      'p0:L1', 'p1:L2', 'p2:L3', 'p3:L1', 'p4:L2', 'p5:L3',
    ]);
  });

  it('feeds the three poles of 3-pole breakers with L1, L2, L3', () => {
    const panel = panelOf([place('p0', 'mcb3', 0, 0), place('p1', 'mcb3', 0, 3)], [combAt('c1', 'comb3', 0, 0)]);
    expect(combContacts(panel, resolve).map((c) => `${c.placementId}:${c.terminalId}:${c.pin}`)).toEqual([
      'p0:top:L1:L1', 'p0:top:L2:L2', 'p0:top:L3:L3',
      'p1:top:L1:L1', 'p1:top:L2:L2', 'p1:top:L3:L3',
    ]);
  });

  it('never lets a phase pin touch a neutral terminal', () => {
    const panel = panelOf([place('p0', 'rcbo', 0, 0)], [combAt('c1', 'comb3', 0, 0)]);
    expect(combContacts(panel, resolve).map((c) => c.terminalId)).toEqual(['top:L']);
  });

  it('lets an L+N comb feed phase and neutral of an RCBO', () => {
    const panel = panelOf([place('p0', 'rcbo', 0, 0), place('p1', 'rcbo', 0, 2)], [combAt('c1', 'combLN', 0, 0)]);
    expect(combContacts(panel, resolve).map((c) => `${c.placementId}:${c.terminalId}:${c.pin}`)).toEqual([
      'p0:top:L:L', 'p0:top:N:N', 'p1:top:L:L', 'p1:top:N:N',
    ]);
  });

  it('touches the first compatible terminal at a unit, not a coil terminal under it', () => {
    const panel = panelOf([place('p0', 'contactor', 0, 0)], [combAt('c1', 'comb3', 0, 0)]);
    expect(combContacts(panel, resolve).map((c) => c.terminalId)).toEqual(['top:L1', 'top:L2', 'top:L3']);
  });

  it('only reaches terminals on its own side and rail', () => {
    const modules = [place('p0', 'mcb3', 0, 0), place('p1', 'mcb3', 1, 0)];
    const top = panelOf(modules, [combAt('c1', 'comb3', 0, 0)]);
    expect(new Set(combContacts(top, resolve).map((c) => c.placementId))).toEqual(new Set(['p0']));
    const bottom = panelOf(modules, [combAt('c1', 'combBottom', 0, 0)]);
    expect(combContacts(bottom, resolve).every((c) => c.terminalId.startsWith('bottom:'))).toBe(true);
  });

  it('reaches only the units the comb covers', () => {
    const panel = panelOf([place('p0', 'mcb3', 0, 0), place('p1', 'mcb3', 0, 9)], [combAt('c1', 'comb3', 0, 0)]);
    expect(new Set(combContacts(panel, resolve).map((c) => c.placementId))).toEqual(new Set(['p0']));
  });

  it('ignores a comb whose definition is missing', () => {
    const panel = panelOf([place('p0', 'mcb3', 0, 0)], [combAt('c1', 'ghost', 0, 0)]);
    expect(combContacts(panel, resolve)).toEqual([]);
  });
});

describe('buildNets', () => {
  it('joins the terminals of a bar into one net', () => {
    const nets = netsOf(projectOf(panelOf([place('p0', 'nbar', 0, 0)])));
    expect(nets).toHaveLength(1);
    expect(nets[0]).toHaveLength(6);
  });

  it('leaves the poles of a breaker unconnected to each other', () => {
    expect(netsOf(projectOf(panelOf([place('p0', 'mcb3', 0, 0)])))).toEqual([]);
  });

  it('follows a wire from a source through the neutral bar to a breaker', () => {
    const panel = panelOf([place('p0', 'nbar', 0, 0), place('p1', 'rcd4', 0, 4)]);
    let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: 'S', x: 0, y: -100, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
    const lookup = nodeTerminalsLookup(panel, resolve);
    const wire = (a: [string, string], b: [string, string]) => {
      const r = connect(schematic, lookup, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
      if (!r.ok) throw new Error(r.error.kind);
      schematic = r.schematic;
    };
    wire(['n3', 'bottom:N'], ['n1', 'top:N1']);
    wire(['n1', 'bottom:Nb2'], ['n2', 'top:N']);
    const nets = netsOf(projectOf(panel, schematic));
    const neutral = nets.find((net) => net.includes('n:n3/bottom:N'))!;
    expect(neutral).toContain('p:p1/top:N');
    expect(neutral.filter((k) => k.startsWith('p:p0/'))).toHaveLength(6);
  });

  it('joins breakers fed by the same comb phase, and keeps the other phases apart', () => {
    const panel = panelOf(
      [0, 1, 2, 3, 4, 5].map((i) => place(`p${i}`, 'mcb1', 0, i)),
      [combAt('c1', 'comb3', 0, 0)],
    );
    expect(netsOf(projectOf(panel))).toEqual([
      ['p:p0/top:L', 'p:p3/top:L'],
      ['p:p1/top:L', 'p:p4/top:L'],
      ['p:p2/top:L', 'p:p5/top:L'],
    ]);
  });

  it('makes every breaker of a single-phase comb one net', () => {
    const panel = panelOf([0, 1, 2].map((i) => place(`p${i}`, 'mcb1', 0, i)), [combAt('c1', 'comb1', 0, 0)]);
    expect(netsOf(projectOf(panel))).toEqual([['p:p0/top:L', 'p:p1/top:L', 'p:p2/top:L']]);
  });

  it('ignores wires that reference missing nodes or terminals', () => {
    const panel = panelOf([place('p0', 'mcb3', 0, 0)]);
    const schematic: Schematic = {
      nodes: [],
      wires: [{ id: 'w1', a: { node: 'n1', terminal: 'top:L1' }, b: { node: 'n2', terminal: 'top:L1' } }],
    };
    expect(netsOf(projectOf(panel, schematic))).toEqual([]);
  });

  it('skips placements whose module is missing from the library', () => {
    expect(netsOf(projectOf(panelOf([place('p0', 'ghost', 0, 0)])))).toEqual([]);
  });
});

describe('findNetProblems', () => {
  const wired = (fromTerminal: string, toTerminal: string): Project => {
    const panel = panelOf([place('p0', 'rcd4', 0, 0), place('p1', 'rcd4', 0, 4)]);
    const schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    return {
      panel,
      schematic: { ...schematic, wires: [{ id: 'w1', a: { node: 'n1', terminal: fromTerminal }, b: { node: 'n2', terminal: toTerminal } }] },
    };
  };

  it('reports nothing for matching phases', () => {
    expect(findNetProblems(buildNets(wired('bottom:L1', 'top:L1'), resolve))).toEqual([]);
  });

  it('reports two different fixed phases on one net', () => {
    const problems = findNetProblems(buildNets(wired('bottom:L1', 'top:L2'), resolve));
    expect(problems.map((p) => p.kind)).toEqual(['mixed-phases']);
  });

  it('reports a phase joined to the neutral, as a short circuit', () => {
    const problems = findNetProblems(buildNets(wired('bottom:L1', 'top:N'), resolve));
    expect(problems.map((p) => p.kind)).toEqual(['mixed-families']);
  });

  it('does not flag a comb shifted by one unit: the phases rotate consistently', () => {
    const panel = panelOf([place('p0', 'mcb3', 0, 0), place('p1', 'mcb3', 0, 3)], [combAt('c1', 'comb3', 0, 1)]);
    expect(findNetProblems(buildNets({ panel, schematic: emptySchematic() }, resolve))).toEqual([]);
  });

  it('reports a wire that bridges two phases of a comb', () => {
    const panel = panelOf([place('p0', 'mcb3', 0, 0), place('p1', 'mcb3', 0, 3)], [combAt('c1', 'comb3', 0, 0)]);
    const nodes = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    const bridged: Schematic = {
      ...nodes,
      wires: [{ id: 'w1', a: { node: 'n1', terminal: 'top:L1' }, b: { node: 'n2', terminal: 'top:L2' } }],
    };
    expect(findNetProblems(buildNets({ panel, schematic: bridged }, resolve)).map((p) => p.kind)).toEqual(['mixed-phases']);
  });
});
