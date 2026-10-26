import { describe, expect, it } from 'vitest';
import { findConnectionProblems } from '../src/electrical/problems';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setSourceOff, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

/** Two sources, each behind its own breaker, with both breakers feeding one terminal of a load. */
function scene(options: { second?: string; secondOff?: boolean; neutralOnly?: boolean } = {}): Project {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), { ...place('p2', 'breaker16', 0, 2), ...(options.second ? { state: options.second } : {}) }]);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const add = (kind: 'source' | 'load', label: string, conductors: Array<'L1' | 'N'>) => {
    schematic = addNode(schematic, { kind, label, x: 0, y: 0, conductors }).schematic;
    return schematic.nodes[schematic.nodes.length - 1]!.id;
  };
  const mains = add('source', 'Mains', ['L1', 'N']);
  const generator = add('source', 'Generator', ['L1', 'N']);
  const load = add('load', 'Machines', ['L1', 'N']);
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const wire = (a: [string, string], b: [string, string]) => {
    const r = connect(schematic, terminalsOf, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!r.ok) throw new Error(`${a} ${b}: ${r.error.kind}`);
    schematic = r.schematic;
  };
  if (options.neutralOnly) {
    wire([mains, 'bottom:N'], [load, 'top:N']);
    wire([generator, 'bottom:N'], [load, 'top:N']);
  } else {
    wire([mains, 'bottom:L1'], ['n1', 'top:L']);
    wire([generator, 'bottom:L1'], ['n2', 'top:L']);
    wire(['n1', 'bottom:L'], [load, 'top:L1']);
    wire(['n2', 'bottom:L'], [load, 'top:L1']);
  }
  if (options.secondOff) {
    const off = setSourceOff(schematic, generator, true);
    if (off.ok) schematic = off.schematic;
  }
  return { panel, schematic };
}

describe('sources that are on and joined in parallel', () => {
  it('are a fault, with both sources, both breakers and the wires to mark', () => {
    const [problem, ...rest] = findConnectionProblems(scene(), resolve);
    expect(rest).toEqual([]);
    expect(problem?.message).toMatch(/^sources that are on are joined in parallel through .*MCB 1P C16 \[p1\].*: Mains \[n3\], Generator \[n4\]$/);
    expect(problem?.nodes).toEqual(expect.arrayContaining(['n3', 'n4', 'n1', 'n2']));
    expect(problem?.placements).toEqual(expect.arrayContaining(['p1', 'p2']));
    expect(problem?.wires).toHaveLength(4);
  });

  it('are fine while one of the breakers is open, or one of the sources is off', () => {
    expect(findConnectionProblems(scene({ second: 'open' }), resolve)).toEqual([]);
    expect(findConnectionProblems(scene({ secondOff: true }), resolve)).toEqual([]);
  });

  it('are fine when only their neutrals meet, as a common neutral is normal', () => {
    expect(findConnectionProblems(scene({ neutralOnly: true }), resolve)).toEqual([]);
  });
});
