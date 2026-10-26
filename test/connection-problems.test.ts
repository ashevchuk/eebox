import { describe, expect, it } from 'vitest';
import { conflictingConductors } from '../src/electrical/energy';
import { inspect } from '../src/ui/inspector';
import { findConnectionProblems } from '../src/electrical/problems';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { projectWarnings } from '../src/project/file';
import { addNode, connect, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

/** A 3-phase source and a 1-pole breaker, wired as the caller says; returns the project. */
function scene(wires: Array<[string, string]>, state?: string): Project {
  const placement = { ...place('p1', 'breaker16', 0, 0), ...(state ? { state } : {}) };
  const panel = panelOf([placement]);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -200, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  for (const [source, terminal] of wires) {
    const joined = connect(schematic, terminalsOf, { node: 'n2', terminal: source }, { node: 'n1', terminal });
    if (!joined.ok) throw new Error(`${source} ${terminal}: ${joined.error.kind}`);
    schematic = joined.schematic;
  }
  return { panel, schematic };
}

describe('conductors joined through a closed device', () => {
  const both: Array<[string, string]> = [['bottom:L1', 'top:L'], ['bottom:L2', 'bottom:L']];

  it('are found, with the wires, the source and the breaker to mark', () => {
    const [problem, ...rest] = findConnectionProblems(scene(both), resolve);
    expect(rest).toEqual([]);
    expect(problem?.message).toMatch(/^different phases joined through a closed device \(MCB 1P C16 \[p1\]\): /);
    expect(problem?.message).toContain('Mains [n2] bottom:L1');
    expect(problem?.message).toContain('Mains [n2] bottom:L2');
    expect([...problem!.wires].sort()).toEqual(['w1', 'w2']);
    expect([...problem!.nodes].sort()).toEqual(['n1', 'n2']);
    expect(problem?.placements).toEqual(['p1']);
  });

  it('are reported by Check, and go away when the breaker is open', () => {
    expect(projectWarnings(scene(both), resolve).filter((w) => w.includes('closed device'))).toHaveLength(1);
    expect(findConnectionProblems(scene(both, 'open'), resolve)).toEqual([]);
  });

  it('are not found when one phase goes in at both ends, or when the other end is wired to a different breaker pole', () => {
    expect(findConnectionProblems(scene([['bottom:L1', 'top:L'], ['bottom:L1', 'bottom:L']]), resolve)).toEqual([]);
    expect(findConnectionProblems(scene([['bottom:L1', 'top:L']]), resolve)).toEqual([]);
  });

  it('are not reported twice when a wire already joins them on one net', () => {
    const joined = scene([['bottom:L1', 'top:L'], ['bottom:L2', 'top:L']]);
    const problems = findConnectionProblems(joined, resolve);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).not.toContain('closed device');
  });
});

describe('conflictingConductors', () => {
  it('says two phases, a phase and neutral or earth, and DC plus and minus cannot be together', () => {
    expect(conflictingConductors(['L1', 'L2'])).toBe(true);
    expect(conflictingConductors(['L1', 'N'])).toBe(true);
    expect(conflictingConductors(['L', 'N'])).toBe(true);
    expect(conflictingConductors(['L2', 'PE'])).toBe(true);
    expect(conflictingConductors(['N', 'PE'])).toBe(true);
    expect(conflictingConductors(['DCP', 'DCN'])).toBe(true);
  });

  it('lets one phase, the undetermined phase with a fixed one, and a contact terminal be together', () => {
    expect(conflictingConductors(['L1', 'L1'])).toBe(false);
    expect(conflictingConductors(['L', 'L2'])).toBe(false);
    expect(conflictingConductors(['L', 'L'])).toBe(false);
    expect(conflictingConductors(['L3', 'C'])).toBe(false);
    expect(conflictingConductors(['N', 'C'])).toBe(false);
    expect(conflictingConductors([])).toBe(false);
  });
});

describe('the inspector explains a mark', () => {
  const both: Array<[string, string]> = [['bottom:L1', 'top:L'], ['bottom:L2', 'bottom:L']];
  const context = (selection: { wireId?: string; nodeId?: string }) => {
    const project = scene(both);
    return { project, selection, mode: 'schematic' as const, resolve, snapshot: {}, fromLibraries: resolve, findings: findConnectionProblems(project, resolve) };
  };
  const problemLines = (selection: { wireId?: string; nodeId?: string }) => inspect(context(selection)).fields.filter((f) => f.key.startsWith('problem')).map((f) => String(f.value));

  it('says why a wire, a node and a module are marked', () => {
    for (const selection of [{ wireId: 'w1' }, { nodeId: 'n2' }, { nodeId: 'n1' }] as Array<{ wireId?: string; nodeId?: string }>) {
      expect(problemLines(selection), JSON.stringify(selection)).toHaveLength(1);
      expect(problemLines(selection)[0]).toContain('different phases joined through a closed device');
    }
  });

  it('says nothing for what is fine', () => {
    const fine = scene([['bottom:L1', 'top:L']]);
    const view = inspect({ project: fine, selection: { wireId: 'w1' }, mode: 'schematic', resolve, snapshot: {}, fromLibraries: resolve, findings: findConnectionProblems(fine, resolve) });
    expect(view.fields.some((f) => f.key.startsWith('problem'))).toBe(false);
  });
});
