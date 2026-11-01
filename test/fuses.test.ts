import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { DEFAULT_CABLE_SETTINGS } from '../src/electrical/cables';
import { SWITCHING_KINDS, positionsOf } from '../src/electrical/energy';
import { PROTECTIVE_KINDS, loadReports } from '../src/electrical/loads';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { terminalsOf } from '../src/electrical/terminals';
import type { Library, ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, setNodeLoad, syncModuleNodes } from '../src/schematic/model';
import { panelOf, place } from './fixtures';

const fuses = (JSON.parse(raw) as Library).modules.filter((m) => m.kind === 'fuse');
const byId = (id: string) => fuses.find((m) => m.id === id)!;

describe('the bundled fuse disconnectors', () => {
  it('are a series of three sizes, four pole counts and the ratings of the links', () => {
    expect(fuses).toHaveLength((8 + 7 + 7) * 4);
    expect(new Set(fuses.map((m) => m.id)).size).toBe(fuses.length);
    expect(byId('fuse-10x38-3p-16')).toMatchObject({ name: 'Fuse disconnector 10x38 3P gG 16A', poles: 3, ratedCurrentA: 16 });
  });

  it('take their width from the pole width of the holder', () => {
    expect(byId('fuse-10x38-3p-16').widthUnits).toBe(3);
    expect(byId('fuse-14x51-1p-32').widthUnits).toBeCloseTo(22.5 / 17.5, 4);
    expect(byId('fuse-22x58-1p-100').widthUnits).toBeCloseTo(36 / 17.5, 4);
  });

  it('have the same lines on top and below, so the fuse sits in each line', () => {
    for (const def of fuses) {
      const terminals = terminalsOf(def);
      const names = (side: string) => terminals.filter((t) => t.side === side).map((t) => t.name);
      expect(names('top'), def.id).toEqual(names('bottom'));
      expect(names('top'), def.id).toHaveLength(def.poles);
    }
  });

  it('may be open, which is how a pulled or blown fuse is shown, and protect the cable behind them', () => {
    expect(SWITCHING_KINDS).toContain('fuse');
    expect(positionsOf(byId('fuse-10x38-1p-16'))).toContain('open');
    expect(PROTECTIVE_KINDS).toContain('fuse');
  });

  it('give the cable of a load the rating of the link, as a breaker does', () => {
    const defs: Record<string, ModuleDef> = { fuse16: { ...byId('fuse-10x38-1p-16'), id: 'fuse16', terminals: [{ name: 'L', conductor: 'L', side: 'top' }, { name: 'L', conductor: 'L', side: 'bottom' }] } };
    const resolve = (ref: { moduleId: string }) => defs[ref.moduleId];
    const panel = panelOf([place('p1', 'fuse16', 0, 0)]);
    let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Load', x: 0, y: 100, conductors: ['L'] }).schematic;
    const terminalsOfNode = nodeTerminalsLookup(panel, resolve);
    for (const [a, b] of [
      [['n2', 'bottom:L'], ['n1', 'top:L']],
      [['n1', 'bottom:L'], ['n3', 'top:L']],
    ] as const) {
      const joined = connect(schematic, terminalsOfNode, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
      if (!joined.ok) throw new Error(joined.error.kind);
      schematic = joined.schematic;
    }
    const loaded = setNodeLoad(schematic, 'n3', { powerW: 2300 });
    if (!loaded.ok) throw new Error(loaded.error.kind);
    const project: Project = { panel, schematic: loaded.schematic };
    const [report] = loadReports(project, resolve, DEFAULT_CABLE_SETTINGS);
    expect(report!.currentA).toBeCloseTo(10);
    expect(report!.breakerA).toBe(16);
    expect(report!.requiredA).toBe(16);
  });
});
