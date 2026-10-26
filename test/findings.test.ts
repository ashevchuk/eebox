import { describe, expect, it } from 'vitest';
import { findFindings, findGlue, markedBy, type Finding } from '../src/electrical/problems';
import { findRuleWarnings } from '../src/electrical/rules';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { projectWarnings } from '../src/project/file';
import { addNode, connect, emptySchematic, setWireRoute, type Schematic } from '../src/schematic/model';
import { panelOf, resolve } from './fixtures';

/** A source and a load of two phases, with a wire for each, drawn by hand with the lanes given. */
function twoWires(lanes: [number, number]): Project {
  const panel = panelOf([]);
  let schematic: Schematic = emptySchematic();
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L1', 'L2'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Motor', x: 100, y: 400, conductors: ['L1', 'L2', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  for (const c of ['L1', 'L2']) {
    const joined = connect(schematic, terminalsOf, { node: 'n1', terminal: `bottom:${c}` }, { node: 'n2', terminal: `top:${c}` });
    if (!joined.ok) throw new Error(joined.error.kind);
    schematic = joined.schematic;
  }
  lanes.forEach((lane, i) => {
    const routed = setWireRoute(schematic, `w${i + 1}`, [lane]);
    if (!routed.ok) throw new Error(routed.error.kind);
    schematic = routed.schematic;
  });
  return { panel, schematic };
}

describe('wires that are stuck together', () => {
  it('are advice naming both wires, with what to do about it', () => {
    const [glue] = findGlue(twoWires([200, 202]), resolve);
    expect(glue).toMatchObject({ severity: 'advice', wires: ['w1', 'w2'], nodes: [], placements: [] });
    expect(glue?.message).toMatch(/^wires w1 \(Mains .*→ Motor .*\) and w2 \(.*\) run on top of each other; Nodes > Separate overlapping wires/);
  });

  it('are not reported once the wires are apart, even when the router would have put them close', () => {
    expect(findGlue(twoWires([200, 220]), resolve)).toEqual([]);
  });

  it('are in the Check text, so a project with them says so on opening', () => {
    expect(projectWarnings(twoWires([200, 202]), resolve).some((w) => w.includes('run on top of each other'))).toBe(true);
    expect(projectWarnings(twoWires([200, 220]), resolve).some((w) => w.includes('run on top of each other'))).toBe(false);
  });
});

describe('advice of the rules', () => {
  it('is marked with the node it is about, and says the same as the Check text', () => {
    const project = twoWires([200, 220]);
    const findings = findFindings(project, resolve);
    const earth = findings.find((f) => f.message.includes('protective earth'));
    expect(earth).toMatchObject({ severity: 'advice', nodes: ['n2'], wires: [] });
    expect(findRuleWarnings(project, resolve)).toContain(earth?.message);
  });
});

describe('markedBy', () => {
  const finding = (severity: Finding['severity'], wires: string[]): Finding => ({ message: 'x', severity, wires, nodes: [], placements: [] });

  it('gives each id the heaviest of its findings, in either order', () => {
    expect([...markedBy([finding('advice', ['w1', 'w2']), finding('error', ['w1'])], 'wires')]).toEqual([['w1', 'error'], ['w2', 'advice']]);
    expect([...markedBy([finding('error', ['w1']), finding('advice', ['w1'])], 'wires')]).toEqual([['w1', 'error']]);
  });

  it('is empty when nothing is wrong', () => {
    expect(markedBy([], 'nodes').size).toBe(0);
  });
});
