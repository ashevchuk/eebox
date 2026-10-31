import { describe, expect, it } from 'vitest';
import { findConnectionProblems } from '../src/electrical/problems';
import { buildNets, findNetProblems } from '../src/electrical/nets';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { TERMINAL_HEADER, terminalCells, terminalSchedule, terminalScheduleToCsv } from '../src/electrical/schedule';
import { conductorsForSystem } from '../src/electrical/earthing';
import { fillTerminalLabels, setPlacementLabel, type Panel } from '../src/layout/placement';
import { CONDUCTORS, canJoin, familyOf, type ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { TERMINAL_PRESETS } from '../src/ui/moduleDesigner';
import { BUILT_IN_SCHEMES } from '../src/view/colourScheme';
import { terminalTable } from '../src/ui/tables';
import { createPanel } from '../src/layout/panel';
import { place } from './fixtures';

const HEIGHT = { heightMm: 90, mounting: 'rail' as const };
const PLC: ModuleDef = {
  id: 'plc-ai',
  kind: 'plc',
  name: 'Controller',
  widthUnits: 4,
  ...HEIGHT,
  poles: 1,
  terminals: [
    { name: 'AI1', conductor: 'SP', side: 'top', unit: 0 },
    { name: 'AI1N', conductor: 'SN', side: 'top', unit: 1 },
    { name: 'AI2', conductor: 'SP', side: 'top', unit: 2 },
    { name: 'L', conductor: 'L', side: 'bottom', unit: 0 },
  ],
};
const STRIP: ModuleDef = {
  id: 'strip',
  kind: 'terminal',
  name: 'Terminal strip',
  widthUnits: 3,
  ...HEIGHT,
  poles: 1,
  terminals: [
    { name: '1', conductor: 'SP', side: 'top', unit: 0, net: 'w1' },
    { name: '1b', conductor: 'SP', side: 'bottom', unit: 0, net: 'w1' },
    { name: '2', conductor: 'SN', side: 'top', unit: 1, net: 'w2' },
    { name: '2b', conductor: 'SN', side: 'bottom', unit: 1, net: 'w2' },
    { name: '3', conductor: 'SH', side: 'top', unit: 2, net: 'w3' },
    { name: '3b', conductor: 'SH', side: 'bottom', unit: 2, net: 'w3' },
  ],
};
const MCB: ModuleDef = { id: 'mcb', kind: 'breaker', name: 'MCB', widthUnits: 1, ...HEIGHT, poles: 1 };
const defs: Record<string, ModuleDef> = { 'plc-ai': PLC, strip: STRIP, mcb: MCB };
const resolve = (r: { libraryId: string; moduleId: string }) => (r.libraryId === 'lib' ? defs[r.moduleId] : undefined);
const ref = (moduleId: string) => ({ libraryId: 'lib', moduleId });

/** A controller and a strip on one rail, a field device as a load node with a signal pair, nothing wired yet. */
function start(): { project: Project; ids: { plc: string; strip: string; field: string } } {
  const panel: Panel = { ...createPanel([12]), placements: [{ id: 'p1', module: ref('plc-ai'), rail: 0, slot: 0 }, { id: 'p2', module: ref('strip'), rail: 0, slot: 5 }] };
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => defs[r.moduleId]!.name);
  const field = addNode(schematic, { kind: 'load', label: 'Pressure sensor', x: 400, y: 0, conductors: ['SP', 'SN'] });
  schematic = field.schematic;
  return { project: { panel, schematic }, ids: { plc: 'n1', strip: 'n2', field: field.node.id } };
}

function wire(project: Project, a: [string, string], b: [string, string]): Project {
  const result = connect(project.schematic, nodeTerminalsLookup(project.panel, resolve), { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
  if (!result.ok) throw new Error(result.error.kind);
  return { ...project, schematic: result.schematic };
}

describe('the signal conductors', () => {
  it('are a family of their own, which no other conductor is in', () => {
    for (const c of ['SP', 'SN', 'SH', 'RA', 'RB'] as const) expect(familyOf(c)).toBe('signal');
    for (const c of CONDUCTORS.filter((x) => !['SP', 'SN', 'SH', 'RA', 'RB'].includes(x))) expect(familyOf(c)).not.toBe('signal');
  });

  it('are joined by a wire to each other, and to a contact, but not to mains or 24 V', () => {
    expect(canJoin('SP', 'SN')).toBe(true);
    expect(canJoin('RA', 'RB')).toBe(true);
    expect(canJoin('SP', 'C')).toBe(true);
    for (const other of ['L', 'L1', 'N', 'PE', 'PEN', 'DCP', 'DCN'] as const) expect(canJoin('SP', other)).toBe(false);
  });

  it('are kept, with phases and control conductors, when the earthing of a source changes', () => {
    expect(conductorsForSystem('TN-S', ['L1', 'SP', 'SN', 'DCP'])).toEqual(expect.arrayContaining(['L1', 'SP', 'SN', 'DCP']));
  });

  it('have a colour in every scheme', () => {
    for (const scheme of BUILT_IN_SCHEMES) for (const c of ['SP', 'SN', 'SH', 'RA', 'RB'] as const) expect(scheme.colours[c].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('are offered by the module designer as a signal, a shield and a bus', () => {
    expect(TERMINAL_PRESETS.map((p) => p.id)).toEqual(expect.arrayContaining(['analog', 'shield', 'bus']));
  });
});

describe('wiring a controller to a field device through a terminal strip', () => {
  it('goes through, wire after wire, with no problem', () => {
    const { project, ids } = start();
    let p = wire(project, [ids.plc, 'top:AI1'], [ids.strip, 'top:1']);
    p = wire(p, [ids.plc, 'top:AI1N'], [ids.strip, 'top:2']);
    p = wire(p, [ids.strip, 'bottom:1b'], [ids.field, 'top:SP']);
    p = wire(p, [ids.strip, 'bottom:2b'], [ids.field, 'top:SN']);
    expect(findConnectionProblems(p, resolve)).toEqual([]);
  });

  it('refuses a signal terminal wired to a phase or to 24 V, and says why', () => {
    const { project, ids } = start();
    const toPhase = connect(project.schematic, nodeTerminalsLookup(project.panel, resolve), { node: ids.plc, terminal: 'top:AI1' }, { node: ids.plc, terminal: 'bottom:L' });
    expect(toPhase.ok).toBe(false);
    expect(!toPhase.ok && toPhase.error.kind).toBe('incompatible-conductors');
  });

  it('reports two different signal lines on one net as an error, through the terminal that joins them', () => {
    const { project, ids } = start();
    let p = wire(project, [ids.plc, 'top:AI1'], [ids.strip, 'top:1']);
    p = wire(p, [ids.plc, 'top:AI1N'], [ids.strip, 'top:1']);
    const kinds = findNetProblems(buildNets(p, resolve)).map((n) => n.kind);
    expect(kinds).toEqual(['mixed-lines']);
    const messages = findConnectionProblems(p, resolve).map((f) => `${f.severity}: ${f.message}`);
    expect(messages[0]).toMatch(/^error: different signal lines or a shield joined/);
  });

  it('reports a shield joined to a line, and two inputs of one line as no problem', () => {
    const { project, ids } = start();
    const shield = wire(wire(project, [ids.plc, 'top:AI1'], [ids.strip, 'top:3']), [ids.strip, 'top:3'], [ids.plc, 'top:AI2']);
    expect(findNetProblems(buildNets(shield, resolve)).map((n) => n.kind)).toEqual(['mixed-lines']);
    const same = wire(wire(project, [ids.plc, 'top:AI1'], [ids.strip, 'top:1']), [ids.strip, 'top:1'], [ids.plc, 'top:AI2']);
    expect(findNetProblems(buildNets(same, resolve))).toEqual([]);
  });
});

describe('the terminal schedule', () => {
  const wired = (): Project => {
    const { project, ids } = start();
    let p = wire(project, [ids.plc, 'top:AI1'], [ids.strip, 'top:1']);
    p = wire(p, [ids.strip, 'bottom:1b'], [ids.field, 'top:SP']);
    p = wire(p, [ids.plc, 'top:AI1N'], [ids.strip, 'top:2']);
    return p;
  };

  it('has a row for each way of a block, in the order along it, with the other ends on each side', () => {
    const rows = terminalSchedule(wired(), resolve);
    expect(rows.map((r) => [r.strip, r.terminal, r.conductor])).toEqual([['Terminal strip', '1', 'SP'], ['Terminal strip', '2', 'SN'], ['Terminal strip', '3', 'SH']]);
    expect(rows[0]).toMatchObject({ top: ['Controller AI1 (top)'], bottom: ['Pressure sensor SP (top)'] });
    expect(rows[1]).toMatchObject({ top: ['Controller AI1N (top)'], bottom: [] });
    expect(rows[2]).toMatchObject({ top: [], bottom: [] });
  });

  it('names the block by its label and a terminal by its own label, which the fitter reads on the block', () => {
    const labelled = setPlacementLabel(wired().panel, 'p2', 'X1');
    if (!labelled.ok) throw new Error(labelled.error.kind);
    const filled = fillTerminalLabels(labelled.panel, 'p2', ['top:1', 'top:2', 'top:3'], 'X1:{n}');
    if (!filled.ok) throw new Error(filled.error.kind);
    const rows = terminalSchedule({ ...wired(), panel: filled.panel }, resolve);
    expect(rows.map((r) => `${r.strip} ${r.terminal}`)).toEqual(['X1 X1:1', 'X1 X1:2', 'X1 X1:3']);
  });

  it('leaves out every module that is not a terminal block', () => {
    const only = { panel: { ...createPanel([12]), placements: [place('p1', 'mcb', 0, 0)] }, schematic: emptySchematic() };
    expect(terminalSchedule(only, resolve)).toEqual([]);
  });

  it('is written as a CSV with a header, and a label that looks like a formula is made safe', () => {
    const panel = setPlacementLabel(wired().panel, 'p2', '=SUM(1)');
    if (!panel.ok) throw new Error(panel.error.kind);
    const csv = terminalScheduleToCsv(terminalSchedule({ ...wired(), panel: panel.panel }, resolve));
    expect(csv.split('\r\n')[0]).toBe(TERMINAL_HEADER.join(','));
    expect(csv).toContain("'=SUM(1)");
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('shows as a table whose cells are the same as the row of the CSV', () => {
    const table = terminalTable(wired(), resolve);
    expect(table.columns.map((c) => c.label)).toEqual([...TERMINAL_HEADER]);
    expect(table.rows[0]).toEqual(terminalCells(terminalSchedule(wired(), resolve)[0]!));
    expect(terminalTable({ ...wired(), panel: createPanel([12]) }, resolve).rows).toEqual([]);
  });

  it('joins the ends of several wires on one side', () => {
    const { project, ids } = start();
    let p = wire(project, [ids.plc, 'top:AI1'], [ids.strip, 'top:1']);
    p = wire(p, [ids.plc, 'top:AI2'], [ids.strip, 'top:1']);
    expect(terminalSchedule(p, resolve)[0]!.top).toEqual(['Controller AI1 (top)', 'Controller AI2 (top)']);
    expect(terminalCells(terminalSchedule(p, resolve)[0]!)[3]).toBe('Controller AI1 (top); Controller AI2 (top)');
  });
});

describe('labelling a row of terminals from a pattern', () => {
  const panel = (): Panel => start().project.panel;
  const topIds = ['top:1', 'top:2', 'top:3'];

  it('numbers them in the order given, and an empty pattern takes the labels off those terminals only', () => {
    const filled = fillTerminalLabels(panel(), 'p2', topIds, 'DI{n}');
    if (!filled.ok) throw new Error(filled.error.kind);
    expect(filled.panel.placements.find((p) => p.id === 'p2')?.terminalLabels).toEqual({ 'top:1': 'DI1', 'top:2': 'DI2', 'top:3': 'DI3' });
    const more = fillTerminalLabels(filled.panel, 'p2', ['bottom:1b'], 'B{n}');
    if (!more.ok) throw new Error(more.error.kind);
    const cleared = fillTerminalLabels(more.panel, 'p2', topIds, '');
    expect(cleared.ok && cleared.panel.placements.find((p) => p.id === 'p2')?.terminalLabels).toEqual({ 'bottom:1b': 'B1' });
    const none = fillTerminalLabels(filled.panel, 'p2', topIds, '  ');
    expect(none.ok && 'terminalLabels' in none.panel.placements.find((p) => p.id === 'p2')!).toBe(false);
  });

  it('refuses a pattern without a number, a label that is too long, too many labels and a module that is not there', () => {
    expect(fillTerminalLabels(panel(), 'p2', topIds, 'DI')).toEqual({ ok: false, error: { kind: 'invalid-label' } });
    expect(fillTerminalLabels(panel(), 'p2', topIds, `${'x'.repeat(60)}{n}`)).toEqual({ ok: false, error: { kind: 'invalid-label' } });
    const many = Array.from({ length: 65 }, (_, i) => `top:${i}`);
    expect(fillTerminalLabels(panel(), 'p2', many, 'T{n}')).toEqual({ ok: false, error: { kind: 'invalid-label' } });
    expect(fillTerminalLabels(panel(), 'p9', topIds, 'T{n}')).toEqual({ ok: false, error: { kind: 'unknown-placement' } });
  });

  const ctx = (selection: InspectContext['selection']): InspectContext => ({ project: start().project, selection, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });

  it('is offered by the inspector for each side of a module that has several terminals there', () => {
    const keys = (id: string) => inspect(ctx({ placementId: id }))!.fields.map((f) => f.key);
    expect(keys('p1')).toContain('fillTop');
    expect(keys('p1')).not.toContain('fillBottom');
    expect(keys('p2')).toEqual(expect.arrayContaining(['fillTop', 'fillBottom']));
  });

  it('labels the terminals of a side in order along the module when the pattern is typed', () => {
    const result = applyEdit(ctx({ placementId: 'p2' }), 'fillTop', 'X1:{n}');
    expect(result.ok && result.project.panel.placements.find((p) => p.id === 'p2')?.terminalLabels).toEqual({ 'top:1': 'X1:1', 'top:2': 'X1:2', 'top:3': 'X1:3' });
    const refused = applyEdit(ctx({ placementId: 'p2' }), 'fillBottom', 'no number');
    expect(refused.ok).toBe(false);
  });
});
