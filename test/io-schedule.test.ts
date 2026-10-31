import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { ioCells, ioSchedule, ioScheduleToCsv, IO_HEADER } from '../src/electrical/schedule';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { connect, emptySchematic, setWireLabel, syncModuleNodes } from '../src/schematic/model';
import { ioTable } from '../src/ui/tables';
import { panelOf, place } from './fixtures';

const controller: ModuleDef = {
  id: 'plc', kind: 'plc', name: 'Controller', widthUnits: 8, heightMm: 90, mounting: 'rail', poles: 1,
  terminals: [
    { name: 'DI0', conductor: 'C', side: 'top', unit: 1 },
    { name: 'DI1', conductor: 'C', side: 'top', unit: 2 },
    { name: 'DO0', conductor: 'C', side: 'bottom', unit: 1 },
  ],
};
const button: ModuleDef = { id: 'button', kind: 'meter', name: 'Button', widthUnits: 2, heightMm: 90, mounting: 'rail', poles: 1, terminals: [{ name: 'C1', conductor: 'C', side: 'bottom', unit: 0.5 }] };
const resolve = (r: ModuleRef): ModuleDef | undefined => (r.moduleId === 'plc' ? controller : r.moduleId === 'button' ? button : undefined);

function build(): Project {
  const panel = panelOf([place('p1', 'plc', 0, 0), place('p2', 'button', 0, 10)], [], [24]);
  const labelled = { ...panel, placements: panel.placements.map((p) => (p.id === 'p1' ? { ...p, label: 'PLC 1', terminalLabels: { 'top:DI0': 'Start' } } : p)) };
  let schematic = syncModuleNodes(emptySchematic(), labelled, (r) => r.moduleId);
  const wired = connect(schematic, nodeTerminalsLookup(labelled, resolve), { node: 'n1', terminal: 'top:DI0' }, { node: 'n2', terminal: 'bottom:C1' });
  if (!wired.ok) throw new Error(wired.error.kind);
  const named = setWireLabel(wired.schematic, 'w1', 'Start button');
  if (!named.ok) throw new Error('label');
  schematic = named.schematic;
  return { panel: labelled, schematic };
}

describe('ioSchedule', () => {
  it('lists every terminal of a controller by its name, with the label it was given beside it', () => {
    const rows = ioSchedule(build(), resolve);
    expect(rows.map((r) => `${r.device}/${r.terminal}/${r.label}/${r.side}`)).toEqual(['PLC 1/DI0/Start/top', 'PLC 1/DI1//top', 'PLC 1/DO0//bottom']);
  });

  it('names a terminal by its id when the module has the same name on both sides', () => {
    const twice: ModuleDef = { ...controller, terminals: [...controller.terminals!, { name: 'DI1', conductor: 'C', side: 'bottom', unit: 3 }] };
    const rows = ioSchedule(build(), (r) => (r.moduleId === 'plc' ? twice : resolve(r)));
    expect(rows.filter((r) => r.device === 'PLC 1').map((r) => r.terminal)).toEqual(['DI0', 'top:DI1', 'DO0', 'bottom:DI1']);
  });

  it('says where the wire on a channel goes and what the wire is called, and nothing for a channel that is not wired', () => {
    const [start, free] = ioSchedule(build(), resolve);
    expect(start).toMatchObject({ connectedTo: ['button C1 (bottom)'], wires: ['Start button'] });
    expect(free).toMatchObject({ connectedTo: [], wires: [] });
  });

  it('leaves out modules that are not controllers', () => {
    expect(ioSchedule(build(), resolve).some((r) => r.device === 'Button')).toBe(false);
  });

  it('has a table and a CSV with the same columns', () => {
    const rows = ioSchedule(build(), resolve);
    expect(ioTable(build(), resolve).columns.map((c) => c.label)).toEqual([...IO_HEADER]);
    const csv = ioScheduleToCsv(rows).split('\r\n');
    expect(csv[0]).toBe('Device,Terminal,Label,Side,Conductor,Connected to,Wire');
    expect(csv[1]).toBe(ioCells(rows[0]!).join(','));
    expect(csv).toHaveLength(rows.length + 2);
  });

  it('is empty for a panel without a controller', () => {
    const panel = panelOf([place('p2', 'button', 0, 0)], [], [12]);
    expect(ioSchedule({ panel, schematic: syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId) }, resolve)).toEqual([]);
  });
});
