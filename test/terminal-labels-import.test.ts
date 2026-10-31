import { describe, expect, it } from 'vitest';
import { ioSchedule, ioScheduleToCsv } from '../src/electrical/schedule';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { MAX_TERMINAL_LABELS_PER_MODULE, importTerminalLabels } from '../src/project/terminalLabelsImport';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place } from './fixtures';

const controller: ModuleDef = {
  id: 'plc', kind: 'plc', name: 'Controller', widthUnits: 8, heightMm: 90, mounting: 'rail', poles: 1,
  terminals: [
    { name: 'DI0', conductor: 'C', side: 'top', unit: 1 },
    { name: 'DI1', conductor: 'C', side: 'top', unit: 2 },
    { name: 'DI1', conductor: 'C', side: 'bottom', unit: 2 },
    { name: 'DO0', conductor: 'C', side: 'bottom', unit: 1 },
  ],
};
const resolve = (r: ModuleRef): ModuleDef | undefined => (r.moduleId === 'plc' ? controller : undefined);

function project(labels: Record<string, string> = {}): Project {
  const base = panelOf([place('p1', 'plc', 0, 0), place('p2', 'plc', 0, 10)], [], [24]);
  const placements = base.placements.map((p) => (p.id === 'p1' ? { ...p, label: 'PLC 1', ...(Object.keys(labels).length > 0 ? { terminalLabels: labels } : {}) } : p));
  return { panel: { ...base, placements }, schematic: emptySchematic() };
}
const run = (text: string, p: Project = project()) => {
  const result = importTerminalLabels(text, p, resolve);
  if (!result.ok) throw new Error(result.error);
  return result;
};
const labelsOf = (panel: Project['panel'], id: string) => panel.placements.find((p) => p.id === id)?.terminalLabels;

describe('importTerminalLabels', () => {
  it('labels terminals by their name, on the module that has that label or name', () => {
    const result = run('Device,Terminal,Label\nPLC 1,DI0,Start\nPLC 1,DO0,Pump\n');
    expect(labelsOf(result.panel, 'p1')).toEqual({ 'top:DI0': 'Start', 'bottom:DO0': 'Pump' });
    expect(labelsOf(result.panel, 'p2')).toBeUndefined();
    expect(result).toMatchObject({ set: 2, cleared: 0, skipped: [] });
  });

  it('takes a module by its name when it has no label, and every module that has it', () => {
    const result = run('Device,Terminal,Label\nController,DI0,Spare\n');
    expect(labelsOf(result.panel, 'p2')).toEqual({ 'top:DI0': 'Spare' });
    expect(labelsOf(result.panel, 'p1')).toBeUndefined();
  });

  it('needs an id when the module has the same name on both sides, and says so', () => {
    const result = run('Device,Terminal,Label\nPLC 1,DI1,A\nPLC 1,top:DI1,Up\nPLC 1,bottom:DI1,Down\n');
    expect(result.skipped).toEqual(['row 2: PLC 1 has several terminals called DI1; write top:DI1 or bottom:DI1']);
    expect(labelsOf(result.panel, 'p1')).toEqual({ 'top:DI1': 'Up', 'bottom:DI1': 'Down' });
  });

  it('takes a label away with a blank one', () => {
    const result = run('Device,Terminal,Label\nPLC 1,DI0,\n', project({ 'top:DI0': 'Old', 'bottom:DO0': 'Keep' }));
    expect(labelsOf(result.panel, 'p1')).toEqual({ 'bottom:DO0': 'Keep' });
    expect(result).toMatchObject({ set: 0, cleared: 1 });
  });

  it('skips a row that does not fit, says why, and applies the others', () => {
    const result = run('Device,Terminal,Label\nNobody,DI0,x\nPLC 1,Nope,x\nPLC 1,DI0,\u0007bad\nPLC 1,DI0,Good\n,DI0,x\n');
    expect(result.skipped).toEqual([
      'row 2: there is no module called Nobody',
      'row 3: PLC 1 has no terminal Nope',
      'row 4: "\u0007bad" cannot be a label',
      'row 6: the device and the terminal must be given',
    ]);
    expect(labelsOf(result.panel, 'p1')).toEqual({ 'top:DI0': 'Good' });
  });

  it('finds its columns by name in any order, ignores the others and takes a semicolon as the delimiter', () => {
    const result = run('Side;Label;Device;Terminal\ntop;Start;PLC 1;DI0\n');
    expect(labelsOf(result.panel, 'p1')).toEqual({ 'top:DI0': 'Start' });
  });

  it('refuses a file without the three columns', () => {
    expect(importTerminalLabels('Name,Value\nx,y\n', project(), resolve)).toEqual({ ok: false, error: 'The first row must name the columns Device, Terminal and Label.' });
    expect(importTerminalLabels('', project(), resolve).ok).toBe(false);
  });

  it('stops at the number of labels a module may have, which the project file would refuse beyond', () => {
    const many: ModuleDef = { ...controller, terminals: Array.from({ length: MAX_TERMINAL_LABELS_PER_MODULE + 3 }, (_, i) => ({ name: `T${i}`, conductor: 'C' as const, side: 'top' as const, unit: 0.5 + i * 0.1 })), widthUnits: 40 };
    const p = project();
    const rows = ['Device,Terminal,Label', ...many.terminals!.map((t) => `PLC 1,${t.name},${t.name}x`)].join('\n');
    const result = importTerminalLabels(rows, p, (r) => (r.moduleId === 'plc' ? many : undefined));
    if (!result.ok) throw new Error(result.error);
    expect(Object.keys(labelsOf(result.panel, 'p1')!)).toHaveLength(MAX_TERMINAL_LABELS_PER_MODULE);
    expect(result.skipped).toHaveLength(3);
  });

  it('reads back the file that Inputs and outputs (CSV) writes, once the Label column is filled in', () => {
    const p = project();
    const exported = ioScheduleToCsv(ioSchedule(p, resolve)).split('\r\n');
    const filled = exported.map((line, i) => (i === 0 || line === '' ? line : line.replace(/^PLC 1,(DI0),,/, 'PLC 1,$1,Start,'))).join('\r\n');
    const result = run(filled, p);
    expect(labelsOf(result.panel, 'p1')).toEqual({ 'top:DI0': 'Start' });
    expect(result.skipped).toEqual([]);
  });
});
