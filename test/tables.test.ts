import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, syncModuleNodes } from '../src/schematic/model';
import { sortRows, tablesOf, type Table } from '../src/ui/tables';
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

describe('the tables of a project', () => {
  it('are the parts, the circuits, the wires and the ferrules, in that order', () => {
    expect(tablesOf(project(), resolve).map((t) => t.id)).toEqual(['parts', 'circuits', 'wires', 'ferrules']);
  });

  it('count the parts by module and width, with the quantity and the labels', () => {
    const parts = byId(tablesOf(project(), resolve), 'parts');
    expect(parts.rows.map((r) => [r[0], r[4]])).toEqual([['MCB 1P', 1], ['MCB 1P C16', 2]]);
    expect(parts.columns).toHaveLength(parts.rows[0]!.length);
  });

  it('say what the parts cost, and how many have no price', () => {
    const parts = byId(tablesOf(project(), resolve), 'parts');
    expect(parts.note).toBe('No prices are given; 2 rows have no price.');
  });

  it('list a circuit for each load that has a power', () => {
    const circuits = byId(tablesOf(project(), resolve), 'circuits');
    expect(circuits.rows).toHaveLength(1);
    expect(circuits.rows[0]![0]).toBe('Oven');
    expect(circuits.rows[0]![1]).toBe(2300);
  });

  it('list a row for each wire, with both ends named, and two ferrules for each wire', () => {
    const tables = tablesOf(project(), resolve);
    expect(byId(tables, 'wires').rows).toHaveLength(2);
    expect(byId(tables, 'wires').rows[0]![0]).toBe('w1');
    expect(byId(tables, 'ferrules').rows.reduce((sum, r) => sum + (r[1] as number), 0)).toBe(4);
  });

  it('are empty, with a word to say so, for a project with nothing in it', () => {
    const empty: Project = { panel: panelOf([]), schematic: emptySchematic() };
    for (const table of tablesOf(empty, resolve)) {
      expect(table.rows).toEqual([]);
      expect(table.empty).not.toBe('');
    }
  });

  it('have as many cells in a row as the table has columns', () => {
    for (const table of tablesOf(project(), resolve)) for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
  });
});

describe('sorting a table', () => {
  const table: Table = {
    id: 'parts',
    title: 'T',
    columns: [{ label: 'Name' }, { label: 'Amount', numeric: true }],
    rows: [['b', 10], ['a', 9], ['c', ''], ['d', 100]],
    empty: '',
  };

  it('orders numbers by value, not by their digits, and keeps empty cells last whichever way it goes', () => {
    expect(sortRows(table, 1, false).map((r) => r[1])).toEqual([9, 10, 100, '']);
    expect(sortRows(table, 1, true).map((r) => r[1])).toEqual([100, 10, 9, '']);
  });

  it('orders text by its letters, with the numbers in it by value', () => {
    expect(sortRows(table, 0, false).map((r) => r[0])).toEqual(['a', 'b', 'c', 'd']);
    const wires: Table = { ...table, rows: [['w10', 1], ['w2', 2], ['w1', 3]] };
    expect(sortRows(wires, 0, false).map((r) => r[0])).toEqual(['w1', 'w2', 'w10']);
  });

  it('does not change the table it is given', () => {
    const before = JSON.stringify(table.rows);
    sortRows(table, 1, true);
    expect(JSON.stringify(table.rows)).toBe(before);
  });
});
