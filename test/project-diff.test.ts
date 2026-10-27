import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { setInfoField } from '../src/layout/info';
import type { Panel } from '../src/layout/placement';
import { diffProjects, summarize } from '../src/project/diff';
import { buildProjectFile, type ProjectFile } from '../src/project/file';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, setWireLabel, syncModuleNodes } from '../src/schematic/model';
import { combAt, defs, panelOf, place, resolve } from './fixtures';

function project(): Project {
  const panel = { ...panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 2)], [combAt('c1', 'comb3', 0, 0)]), title: 'House', railLabels: ['Incoming', ''] };
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 300, conductors: ['L', 'N'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const joined = connect(schematic, terminalsOf, { node: 'n3', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' });
  if (!joined.ok) throw new Error('wire');
  const loaded = setNodeLoad(joined.schematic, 'n4', { powerW: 2300 });
  if (!loaded.ok) throw new Error('load');
  return { panel, schematic: loaded.schematic };
}
const file = (p: Project): ProjectFile => buildProjectFile(p, resolve);
const texts = (a: Project, b: Project) => diffProjects(file(a), file(b)).map((c) => `${c.area}/${c.kind}: ${c.text}`);

describe('comparing two projects', () => {
  it('finds nothing between a project and itself, or its copy', () => {
    expect(diffProjects(file(project()), file(project()))).toEqual([]);
    expect(summarize([])).toEqual({ total: 0, added: 0, removed: 0, changed: 0 });
  });

  it('reports the title, the info and the rows', () => {
    const a = project();
    let panel: Panel = { ...a.panel, title: 'House, second floor', railLengthsUnits: [24, 12], railLabels: ['Mains', ''] };
    const stated = setInfoField(panel, 'status', 'approved');
    if (!stated.ok) throw new Error('info');
    panel = stated.panel;
    const lines = texts(a, { ...a, panel });
    expect(lines).toContain('project/changed: title "House" → "House, second floor"');
    expect(lines).toContain('project/changed: status none → "approved"');
    expect(lines).toContain('rows/changed: row 2: length 24 → 12 units');
    expect(lines).toContain('rows/changed: row 1: label "Incoming" → "Mains"');
  });

  it('reports a module that was added, removed and moved, with its row and position', () => {
    const a = project();
    const panel = { ...a.panel, placements: [{ ...a.panel.placements[0]!, slot: 5 }, place('p9', 'mcb1', 1, 3)] };
    const lines = texts(a, { ...a, panel });
    expect(lines.some((l) => l.startsWith('modules/added:') && l.includes('(p9)') && l.includes('row 2, position 3'))).toBe(true);
    expect(lines.some((l) => l.startsWith('modules/removed:') && l.includes('(p2)'))).toBe(true);
    expect(lines.some((l) => l.startsWith('modules/changed:') && l.includes('moved from row 1, position 0 to row 1, position 5'))).toBe(true);
  });

  it('reports a label, a width and a module that was swapped', () => {
    const a = project();
    const placements = [{ ...a.panel.placements[0]!, label: 'Kitchen', widthUnits: 2 }, { ...a.panel.placements[1]!, module: { libraryId: 'lib', moduleId: 'mcb1' } }];
    const changed = texts(a, { ...a, panel: { ...a.panel, placements } }).filter((l) => l.startsWith('modules/changed'));
    expect(changed).toHaveLength(2);
    expect(changed[0]).toContain('label none → "Kitchen"');
    expect(changed[0]).toContain('width none \u2192 2 units');
    expect(changed[1]).toMatch(/module .* → /);
  });

  it('reports a shelved module as moved to the shelf', () => {
    const a = project();
    const [first, ...rest] = a.panel.placements;
    const { rail: _r, slot: _s, ...item } = first!;
    const lines = texts(a, { ...a, panel: { ...a.panel, placements: rest, shelf: [item] } });
    expect(lines.some((l) => l.includes('moved from row 1, position 0 to on the shelf'))).toBe(true);
  });

  it('reports a comb that was removed', () => {
    const a = project();
    expect(texts(a, { ...a, panel: { ...a.panel, combs: [] } }).some((l) => l.startsWith('combs/removed:') && l.includes('(c1)'))).toBe(true);
  });

  it('reports a load whose power changed, with both values and the unit', () => {
    const a = project();
    const loaded = setNodeLoad(a.schematic, 'n4', { powerW: 3500, lengthM: 20 });
    if (!loaded.ok) throw new Error('load');
    const line = texts(a, { ...a, schematic: loaded.schematic }).find((l) => l.startsWith('nodes/changed'))!;
    expect(line).toContain('Oven');
    expect(line).toContain('load power 2300 W → 3500 W');
    expect(line).toContain('load cable length none → 20 m');
  });

  it('does not count a node that was only moved on the schematic', () => {
    const a = project();
    expect(texts(a, { ...a, schematic: { ...a.schematic, nodes: a.schematic.nodes.map((n) => ({ ...n, x: n.x + 50 })) } })).toEqual([]);
  });

  it('reports a wire that was added, labelled, rewired and removed, by the names of its ends', () => {
    const a = project();
    const labelled = setWireLabel(a.schematic, 'w1', '3x2.5');
    if (!labelled.ok) throw new Error('label');
    expect(texts(a, { ...a, schematic: labelled.schematic }).filter((l) => l.startsWith('wires/changed')).join()).toContain('label none → "3x2.5"');
    const rewired = { ...a.schematic, wires: a.schematic.wires.map((w) => ({ ...w, b: { node: 'n2', terminal: 'top:L' } })) };
    expect(texts(a, { ...a, schematic: rewired }).find((l) => l.startsWith('wires/changed'))).toContain('rewired from Mains bottom:L –');
    expect(texts(a, { ...a, schematic: { ...a.schematic, wires: [] } }).find((l) => l.startsWith('wires/removed'))).toContain('w1: Mains');
  });

  it('is the reverse when the projects are swapped: what was added was removed', () => {
    const a = project();
    const b = { ...a, panel: { ...a.panel, placements: a.panel.placements.slice(0, 1) } };
    expect(summarize(diffProjects(file(a), file(b)))).toMatchObject({ added: 0, removed: 1 });
    expect(summarize(diffProjects(file(b), file(a)))).toMatchObject({ added: 1, removed: 0 });
  });

  it('notes a module definition that differs, and puts the areas in a fixed order', () => {
    const a = project();
    const after = file(a);
    after.modules['lib/breaker16'] = { ...defs.breaker16!, name: 'Renamed breaker' };
    const changes = diffProjects(file(a), { ...after, project: { ...a, panel: { ...a.panel, title: 'Other' } } });
    expect(changes.some((c) => c.text.includes('definition of Renamed breaker'))).toBe(true);
    expect(changes[0]!.area).toBe('project');
  });
});
