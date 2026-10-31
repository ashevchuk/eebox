import { describe, expect, it } from 'vitest';
import { RESERVE_PERCENT, cutCells, cutList, cutListToCsv, CUT_HEADER } from '../src/electrical/cutList';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { wireRuns } from '../src/layout/wireLength';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setWireSection, syncModuleNodes } from '../src/schematic/model';
import { cutTable } from '../src/ui/tables';
import { panelOf, place, resolve } from './fixtures';

function build(): Project {
  const base = panelOf([place('p1', 'mcb3', 0, 0), place('p2', 'mcb3', 0, 6)], [], [24, 12]);
  const panel = {
    ...base,
    ducts: [
      { id: 'd1', plate: base.plates[0]!.id, x: 0, y: 200, widthMm: 400, heightMm: 60 },
      { id: 'd2', plate: base.plates[0]!.id, x: 0, y: 300, widthMm: 40, heightMm: 300 },
    ],
  };
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const terminals = nodeTerminalsLookup(panel, resolve);
  const source = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L1', 'L2', 'L3'] });
  schematic = source.schematic;
  const sourceId = schematic.nodes.find((n) => n.kind === 'source')!.id;
  const wire = (a: [string, string], b: [string, string]) => {
    const result = connect(schematic, terminals, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  };
  wire(['n1', 'bottom:L1'], ['n2', 'top:L1']);
  wire(['n1', 'bottom:L2'], ['n2', 'top:L2']);
  wire(['n1', 'bottom:L3'], ['n2', 'top:L3']);
  const sized = setWireSection(schematic, 'w1', 2.5);
  if (!sized.ok) throw new Error('section');
  schematic = sized.schematic;
  const sourceWire = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: sourceId, terminal: 'bottom:L1' }, { node: 'n1', terminal: 'top:L1' });
  if (!sourceWire.ok) throw new Error(sourceWire.error.kind);
  return { panel, schematic: sourceWire.schematic };
}

describe('cutList', () => {
  it('adds up the measured wires by cross-section with the reserve on top, the unknown section last', () => {
    const project = build();
    const runs = wireRuns(project, resolve);
    const rows = cutList(project, resolve).filter((r) => r.item === 'Wire' && r.lengthMm !== undefined);
    const own = runs.get('w1')!;
    const rest = runs.get('w2')! + runs.get('w3')!;
    expect(rows.map((r) => [r.size, r.count, r.lengthMm])).toEqual([['2.5 mm2', 1, own], ['cross-section not known', 2, rest]]);
    expect(rows[0]!.withReserveMm).toBe(Math.ceil((own * (100 + RESERVE_PERCENT)) / 100));
  });

  it('counts apart a wire that cannot be measured, without a length', () => {
    const row = cutList(build(), resolve).find((r) => r.size.startsWith('not measured'));
    expect(row).toEqual({ item: 'Wire', size: 'not measured: an end is not on the panel', count: 1 });
  });

  it('adds up the DIN rails and the ducts by width, a duct being as long as its longer side', () => {
    const rows = cutList(build(), resolve);
    expect(rows.find((r) => r.item === 'DIN rail')).toMatchObject({ size: '35 mm', count: 2, lengthMm: Math.round((24 + 12) * 17.5) });
    expect(rows.filter((r) => r.item === 'Cable duct').map((r) => [r.size, r.count, r.lengthMm])).toEqual([['40 mm wide', 1, 300], ['60 mm wide', 1, 400]]);
  });

  it('has a CSV and a table with the same columns', () => {
    const rows = cutList(build(), resolve);
    const csv = cutListToCsv(rows).split('\r\n');
    expect(csv[0]).toBe(CUT_HEADER.join(','));
    expect(csv[1]).toBe(cutCells(rows[0]!).join(','));
    expect(cutTable(build(), resolve).columns).toHaveLength(CUT_HEADER.length);
  });

  it('lists nothing for a project without rails, ducts or wires', () => {
    const empty: Project = { panel: panelOf([], [], []), schematic: emptySchematic() };
    expect(cutList(empty, resolve)).toEqual([]);
  });
});
