import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, syncModuleNodes } from '../src/schematic/model';
import { applyEdit, type InspectContext } from '../src/ui/inspector';
import { sortRows, sortedIndices, tablesOf, type Table } from '../src/ui/tables';
import { panelOf, place, resolve } from './fixtures';

function project(): Project {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 2), place('p3', 'mcb1', 0, 4)]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 300, conductors: ['L', 'N'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  for (const [a, b] of [
    [{ node: 'n4', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' }],
    [{ node: 'n1', terminal: 'bottom:L' }, { node: 'n5', terminal: 'top:L' }],
  ] as const) {
    const joined = connect(schematic, terminalsOf, a, b);
    if (!joined.ok) throw new Error(joined.error.kind);
    schematic = joined.schematic;
  }
  const loaded = setNodeLoad(schematic, 'n5', { powerW: 2300 });
  if (!loaded.ok) throw new Error(loaded.error.kind);
  return { panel, schematic: loaded.schematic };
}

const byId = (tables: Table[], id: string) => tables.find((t) => t.id === id)!;
const context = (p: Project, selection: InspectContext['selection']): InspectContext => ({ project: p, selection, mode: 'schematic', resolve, snapshot: {}, fromLibraries: resolve });

describe('editable cells', () => {
  it('give every row of an editable table the selection of its object, and the others none', () => {
    const tables = tablesOf(project(), resolve);
    for (const id of ['wires', 'circuits'] as const) {
      const table = byId(tables, id);
      expect(table.selections).toHaveLength(table.rows.length);
      expect(table.columns.some((c) => c.edit)).toBe(true);
    }
    expect(byId(tables, 'parts').selections).toBeUndefined();
    expect(byId(tables, 'ferrules').selections).toBeUndefined();
  });

  it('point at the wire of the row, and a typed label or cross-section reaches that wire', () => {
    const p = project();
    const wires = byId(tablesOf(p, resolve), 'wires');
    const labelColumn = wires.columns.findIndex((c) => c.edit === 'label');
    const row = 1;
    expect(wires.rows[row]![0]).toBe(wires.selections![row]!.wireId);
    const labelled = applyEdit(context(p, wires.selections![row]!), wires.columns[labelColumn]!.edit!, '3x2.5');
    expect(labelled.ok && labelled.project.schematic.wires.find((w) => w.id === wires.selections![row]!.wireId)?.label).toBe('3x2.5');
    const sized = applyEdit(context(p, wires.selections![row]!), 'section', '4');
    expect(sized.ok && sized.project.schematic.wires.find((w) => w.id === wires.selections![row]!.wireId)?.crossSectionMm2).toBe(4);
  });

  it('point at the load of the row, and a typed power, cable and length reach that load', () => {
    const p = project();
    const circuits = byId(tablesOf(p, resolve), 'circuits');
    const selection = circuits.selections![0]!;
    const keys = circuits.columns.filter((c) => c.edit).map((c) => c.edit);
    expect(keys).toEqual(['powerW', 'crossSection', 'lengthM']);
    const power = applyEdit(context(p, selection), 'powerW', '3000');
    expect(power.ok && power.project.schematic.nodes.find((n) => n.id === selection.nodeId)?.load?.powerW).toBe(3000);
    const length = applyEdit(context(p, selection), 'lengthM', '25');
    expect(length.ok && length.project.schematic.nodes.find((n) => n.id === selection.nodeId)?.load?.lengthM).toBe(25);
  });

  it('say why a value is refused, and change nothing', () => {
    const p = project();
    const selection = byId(tablesOf(p, resolve), 'circuits').selections![0]!;
    const refused = applyEdit(context(p, selection), 'powerW', 'plenty');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message.length).toBeGreaterThan(0);
  });

  it('are traced back to their rows when the table is sorted', () => {
    const wires = byId(tablesOf(project(), resolve), 'wires');
    const order = sortedIndices(wires, 0, true);
    expect(order.map((i) => wires.rows[i])).toEqual(sortRows(wires, 0, true));
    expect([...order].sort((a, b) => a - b)).toEqual(wires.rows.map((_, i) => i));
  });
});
