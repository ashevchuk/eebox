import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { insertSnippet, makeSnippet, MAX_SNIPPETS, type Snippet } from '../src/layout/snippets';
import type { Project } from '../src/project';
import { parseProjectJson } from '../src/project/file';
import { addNode, connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { defs, panelOf, place, resolve } from './fixtures';

function project(): Project {
  const panel = panelOf([place('p1', 'breaker16', 1, 3), place('p2', 'breaker16', 1, 5), place('p3', 'mcb1', 0, 9)]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const nodeOf = (placementId: string) => schematic.nodes.find((n) => n.placementId === placementId)!.id;
  const joined = connect(schematic, terminalsOf, { node: nodeOf('p1'), terminal: 'bottom:L' }, { node: nodeOf('p2'), terminal: 'top:L' });
  if (!joined.ok) throw new Error('fixture wire');
  schematic = joined.schematic;
  const outside = connect(schematic, terminalsOf, { node: nodeOf('p3'), terminal: 'bottom:L' }, { node: nodeOf('p1'), terminal: 'top:L' });
  if (!outside.ok) throw new Error('fixture wire 2');
  return { panel, schematic: outside.schematic };
}

const made = (p = project(), ids = ['p1', 'p2']): Snippet => {
  const result = makeSnippet(p, resolve, { placementIds: ids, combIds: [] }, '  Light group ', 7, []);
  if (!result.ok) throw new Error(result.error);
  return result.snippet;
};

describe('making a snippet', () => {
  it('moves the group to the corner and names it', () => {
    const snippet = made();
    const { panel } = snippet.file.project;
    expect(snippet.name).toBe('Light group');
    expect(panel.placements.map((p) => [p.rail, p.slot])).toEqual([[0, 0], [0, 2]]);
    expect(panel.railLengthsUnits).toHaveLength(1);
    expect(Object.keys(snippet.file.modules)).toEqual(['lib/breaker16']);
  });

  it('keeps the wires between the chosen modules and leaves out those that lead elsewhere', () => {
    const { schematic } = made().file.project;
    expect(schematic.nodes).toHaveLength(2);
    expect(schematic.wires).toHaveLength(1);
    expect(schematic.nodes.every((n) => n.kind === 'module')).toBe(true);
    expect(Math.min(...schematic.nodes.map((n) => n.x))).toBe(0);
  });

  it('refuses an empty choice, a name that is not a label and too many snippets', () => {
    const base = project();
    expect(makeSnippet(base, resolve, { placementIds: [], combIds: [] }, 'x', 1, [])).toEqual({ ok: false, error: 'empty' });
    expect(makeSnippet(base, resolve, { placementIds: ['p1'], combIds: [] }, '   ', 1, [])).toEqual({ ok: false, error: 'bad-name' });
    const many = Array.from({ length: MAX_SNIPPETS }, (_, i) => ({ ...made(), id: `snippet-${i}` }));
    expect(makeSnippet(base, resolve, { placementIds: ['p1'], combIds: [] }, 'x', 1, many)).toEqual({ ok: false, error: 'too-many' });
  });

  it('gives each snippet an id that is free', () => {
    const first = made();
    const second = makeSnippet(project(), resolve, { placementIds: ['p1'], combIds: [] }, 'b', 1, [first]);
    expect(first.id).toBe('snippet-1');
    expect(second.ok && second.snippet.id).toBe('snippet-2');
  });

  it('is a project file that the file validator reads', () => {
    const parsed = parseProjectJson(JSON.stringify(made().file));
    expect(parsed.ok).toBe(true);
  });
});

describe('inserting a snippet', () => {
  it('puts the modules at the place asked for with new ids, and wires the new nodes to the new modules', () => {
    const base = project();
    const result = insertSnippet(base, {}, resolve, made(), { rail: 0, slot: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.panel.placements).toHaveLength(5);
    const ids = result.project.panel.placements.map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
    const added = result.project.panel.placements.filter((p) => result.placementIds.includes(p.id));
    expect(added.map((p) => [p.rail, p.slot])).toEqual([[0, 0], [0, 2]]);
    const newNodes = result.project.schematic.nodes.slice(base.schematic.nodes.length);
    expect(newNodes.map((n) => n.placementId)).toEqual(result.placementIds);
    expect(new Set(result.project.schematic.nodes.map((n) => n.id)).size).toBe(result.project.schematic.nodes.length);
    const newWire = result.project.schematic.wires.at(-1)!;
    expect(newNodes.map((n) => n.id)).toContain(newWire.a.node);
    expect(newNodes.map((n) => n.id)).toContain(newWire.b.node);
  });

  it('puts the new nodes to the right of the old ones, not on top of them', () => {
    const base = project();
    const result = insertSnippet(base, {}, resolve, made(), { rail: 0, slot: 0 });
    if (!result.ok) throw new Error('no room');
    const oldRight = Math.max(...base.schematic.nodes.map((n) => n.x));
    for (const node of result.project.schematic.nodes.slice(base.schematic.nodes.length)) expect(node.x).toBeGreaterThan(oldRight);
  });

  it('moves along the rail to the nearest free place when the spot is taken', () => {
    const result = insertSnippet(project(), {}, resolve, made(), { rail: 1, slot: 3 });
    if (!result.ok) throw new Error('no room');
    const added = result.project.panel.placements.filter((p) => result.placementIds.includes(p.id));
    expect(added.every((p) => p.rail === 1)).toBe(true);
    expect(added[0]!.slot).not.toBe(3);
  });

  it('takes a module the project does not know from the snippet and keeps it in the snapshot', () => {
    const snippet = made();
    const blind = () => undefined;
    const result = insertSnippet({ panel: panelOf([]), schematic: emptySchematic() }, {}, blind, snippet, { rail: 0, slot: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.snapshot)).toEqual(['lib/breaker16']);
  });

  it('does not copy a module definition the project already has', () => {
    const result = insertSnippet(project(), { }, resolve, made(), { rail: 0, slot: 0 });
    if (result.ok) expect(result.snapshot).toEqual({});
  });

  it('fails without changing anything when there is no room', () => {
    const full = panelOf([place('p1', 'breaker16', 0, 0)], [], [defs.breaker16!.widthUnits]);
    const result = insertSnippet({ panel: full, schematic: emptySchematic() }, {}, resolve, made(), { rail: 0, slot: 0 });
    expect(result).toEqual({ ok: false, error: 'no-room' });
  });
});
