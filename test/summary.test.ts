import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { circuitSummaries, CHECK_IDS, type CircuitSummary } from '../src/electrical/summary';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, syncModuleNodes } from '../src/schematic/model';
import { summaryTable } from '../src/ui/tables';
import { panelOf, place, resolve } from './fixtures';

function project(load: Parameters<typeof setNodeLoad>[2], conductors: Array<'L' | 'N' | 'PE'> = ['L', 'N']): Project {
  const panel = panelOf([place('p1', 'breaker16', 0, 0)]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 300, conductors }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  for (const [a, b] of [
    [{ node: 'n2', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' }],
    [{ node: 'n1', terminal: 'bottom:L' }, { node: 'n3', terminal: 'top:L' }],
  ] as const) {
    const joined = connect(schematic, terminalsOf, a, b);
    if (!joined.ok) throw new Error(joined.error.kind);
    schematic = joined.schematic;
  }
  const loaded = setNodeLoad(schematic, 'n3', load);
  if (!loaded.ok) throw new Error(loaded.error.kind);
  return { panel, schematic: loaded.schematic };
}

const only = (p: Project): CircuitSummary => {
  const [first, ...rest] = circuitSummaries(p, resolve);
  expect(rest).toEqual([]);
  return first!;
};
const check = (s: CircuitSummary, id: (typeof CHECK_IDS)[number]) => s.checks.find((c) => c.id === id)!;

describe('the summary of a circuit', () => {
  it('has the five checks, in order, for each load that has a power', () => {
    expect(only(project({ powerW: 2300 })).checks.map((c) => c.id)).toEqual([...CHECK_IDS]);
    expect(circuitSummaries({ ...project({ powerW: 2300 }), schematic: emptySchematic() }, resolve)).toEqual([]);
  });

  it('is unknown, not ok, for what has not been given: the cable and its length', () => {
    const s = only(project({ powerW: 2300 }));
    expect(check(s, 'cable').status).toBe('unknown');
    expect(check(s, 'drop').status).toBe('unknown');
    expect(check(s, 'cable').detail).toContain('mm2');
  });

  it('finds a cable that is too small and a breaker that is too small, with the numbers', () => {
    const s = only(project({ powerW: 7000, crossSectionMm2: 1.5 }));
    expect(check(s, 'cable').status).toBe('warning');
    expect(check(s, 'breaker').status).toBe('warning');
    expect(check(s, 'breaker').detail).toContain('16 A');
    expect(s.result).toBe('attention');
  });

  it('finds a voltage drop above the limit', () => {
    const s = only(project({ powerW: 2300, crossSectionMm2: 1.5, lengthM: 400 }));
    expect(check(s, 'drop').status).toBe('warning');
    expect(check(s, 'drop').detail).toContain('limit');
  });

  it('says a load fed without an RCD is not protected, and that a load without a PE terminal has no earth to check', () => {
    const s = only(project({ powerW: 2300 }));
    expect(check(s, 'rcd').status).toBe('warning');
    expect(check(s, 'earth').status).toBe('unknown');
    expect(check(s, 'earth').text).toBe('no PE');
  });

  it('reports a PE terminal that is not wired as open', () => {
    expect(check(only(project({ powerW: 2300 }, ['L', 'N', 'PE'])), 'earth').status).toBe('warning');
  });
});

describe('the summary table', () => {
  it('has a row for each circuit with a mark and a reason for each check, and a note that counts them', () => {
    const table = summaryTable(project({ powerW: 7000, crossSectionMm2: 1.5 }), resolve);
    expect(table.id).toBe('checks');
    expect(table.rows).toHaveLength(1);
    expect(table.marks![0]).toHaveLength(table.columns.length);
    expect(table.titles![0]).toHaveLength(table.columns.length);
    expect(table.marks![0]![2]).toBe('warning');
    expect(table.rows[0]!.at(-1)).toBe('Needs attention');
    expect(table.note).toContain('1 circuit: 0 ok, 1 need attention');
    expect(table.note).toContain('not verified');
  });

  it('says what to do when there are no circuits', () => {
    expect(summaryTable({ panel: panelOf([]), schematic: emptySchematic() }, resolve).empty).toContain('power');
  });
});
