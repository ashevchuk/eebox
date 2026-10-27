import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Finding } from '../src/electrical/problems';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { focusOf, problemEntries } from '../src/ui/problems';
import { moduleRect } from '../src/view/geometry';
import { panelOf, place, resolve } from './fixtures';

const finding = (change: Partial<Finding>): Finding => ({ message: 'm', severity: 'advice', wires: [], nodes: [], placements: [], ...change });

function scene(): Project {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  const joined = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n3', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' });
  if (!joined.ok) throw new Error(joined.error.kind);
  return { panel, schematic: joined.schematic };
}

describe('the entries of the problems list', () => {
  it('put faults before advice, and keep the order of the others', () => {
    const entries = problemEntries([finding({ message: 'a', severity: 'advice' }), finding({ message: 'b', severity: 'error' }), finding({ message: 'c', severity: 'advice' })], []);
    expect(entries.map((e) => [e.message, e.severity])).toEqual([['b', 'error'], ['a', 'advice'], ['c', 'advice']]);
  });

  it('add the remarks that point at nothing, once, after the findings', () => {
    const entries = problemEntries([finding({ message: 'x', severity: 'error', nodes: ['n1'] })], ['x', 'placement p9: overlap with p1']);
    expect(entries.map((e) => [e.message, e.severity, e.finding !== undefined])).toEqual([['x', 'error', true], ['placement p9: overlap with p1', 'note', false]]);
  });

  it('are none when nothing was found', () => {
    expect(problemEntries([], [])).toEqual([]);
  });
});

describe('where to look at a finding', () => {
  it('shows a placed module on the panel, selected, and takes its box as the thing to show', () => {
    const project = scene();
    const focus = focusOf(project, resolve, finding({ placements: ['p2'] }), 'schematic');
    const r = moduleRect(project.panel, 0, 4, 1);
    expect(focus).toMatchObject({ mode: 'panel', selection: { placementId: 'p2' }, bounds: { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height } });
  });

  it('selects several modules together, and covers all of them', () => {
    const project = scene();
    const focus = focusOf(project, resolve, finding({ placements: ['p1', 'p2'] }), 'panel')!;
    expect(focus.selection).toEqual({ placementIds: ['p1', 'p2'] });
    expect(focus.bounds.maxX).toBeGreaterThan(moduleRect(project.panel, 0, 4, 1).x);
  });

  it('shows a wire on the schematic, selected, with the box of its route', () => {
    const project = scene();
    const focus = focusOf(project, resolve, finding({ wires: ['w1'] }), 'panel')!;
    expect(focus.mode).toBe('schematic');
    expect(focus.selection).toEqual({ wireId: 'w1' });
    expect(focus.bounds.maxY).toBeGreaterThan(focus.bounds.minY);
  });

  it('shows a node when there is no wire, and keeps to the view that is on when it has something of the finding', () => {
    const project = scene();
    expect(focusOf(project, resolve, finding({ nodes: ['n3'] }), 'schematic')).toMatchObject({ mode: 'schematic', selection: { nodeId: 'n3' } });
    expect(focusOf(project, resolve, finding({ nodes: ['n1'], placements: ['p1'] }), 'schematic')?.mode).toBe('schematic');
    expect(focusOf(project, resolve, finding({ nodes: ['n1'], placements: ['p1'] }), 'panel')?.mode).toBe('panel');
  });

  it('is nothing for what is not in the project any more', () => {
    expect(focusOf(scene(), resolve, finding({ placements: ['p9'], nodes: ['n9'], wires: ['w9'] }), 'panel')).toBeUndefined();
    expect(focusOf(scene(), resolve, finding({}), 'panel')).toBeUndefined();
  });
});
