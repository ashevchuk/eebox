import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { terminalSchedule } from '../src/electrical/schedule';
import { terminalsOf } from '../src/electrical/terminals';
import type { Library, ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { panelOf, place } from './fixtures';

const library = JSON.parse(raw) as Library;
const blocks = library.modules.filter((m) => m.kind === 'terminal');
const byId = (id: string) => blocks.find((m) => m.id === id)!;
const rcbos3pn = library.modules.filter((m) => m.id.startsWith('rcbo-3pn-'));

describe('the bundled feed-through terminals', () => {
  it('are five conductor sizes for each of L, N, PE and a generic control way', () => {
    expect(blocks).toHaveLength(5 * 4);
    expect(new Set(blocks.map((m) => m.id)).size).toBe(blocks.length);
    expect(byId('terminal-2-5-pe')).toMatchObject({ name: 'Feed-through terminal 2.5 mm2 PE', ratedCurrentA: 24 });
    expect(byId('terminal-16-c')).toMatchObject({ name: 'Feed-through terminal 16 mm2 control', ratedCurrentA: 76 });
  });

  it('are as wide as the block, in units, and lower than a protective device', () => {
    expect(byId('terminal-2-5-l').widthUnits).toBeCloseTo(5.2 / 17.5, 4);
    expect(byId('terminal-16-n').widthUnits).toBeCloseTo(12.2 / 17.5, 4);
    for (const def of blocks) expect(def.heightMm, def.id).toBe(60);
  });

  it('have one terminal on top and one below, joined inside, of the conductor of the block', () => {
    const conductors: Record<string, string> = { l: 'L', n: 'N', pe: 'PE', c: 'C' };
    for (const def of blocks) {
      const terminals = terminalsOf(def);
      expect(terminals.map((t) => t.side), def.id).toEqual(['top', 'bottom']);
      expect(new Set(terminals.map((t) => t.net)).size, def.id).toBe(1);
      expect(terminals[0]!.net, def.id).toBeDefined();
      expect(terminals.map((t) => t.conductor), def.id).toEqual(Array(2).fill(conductors[def.id.split('-').pop()!]));
    }
  });

  it('are listed as one way each by the terminal schedule', () => {
    const defs: Record<string, ModuleDef> = { pe: byId('terminal-4-pe') };
    const resolve = (ref: { moduleId: string }) => defs[ref.moduleId];
    const panel = panelOf([place('p1', 'pe', 0, 0)]);
    const project: Project = { panel, schematic: syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId) };
    const rows = terminalSchedule(project, resolve);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ conductor: 'PE', terminal: 'PE' });
  });
});

describe('the bundled RCBOs with three phases and a neutral', () => {
  it('are the same ratings, curves and sensitivities as the single-phase ones, four modules wide', () => {
    expect(rcbos3pn).toHaveLength(2 * 8 * 2);
    for (const def of rcbos3pn) {
      expect(def.kind, def.id).toBe('rcbo');
      expect(def.poles, def.id).toBe(4);
      expect(def.widthUnits, def.id).toBe(4);
      expect(def.residualCurrentMa, def.id).toBeDefined();
    }
    expect(rcbos3pn.find((m) => m.id === 'rcbo-3pn-c16-30')).toMatchObject({ name: 'RCBO 3P+N C16 30mA', ratedCurrentA: 16, curve: 'C' });
  });

  it('have the four lines on top and below', () => {
    const terminals = terminalsOf(rcbos3pn[0]!);
    for (const side of ['top', 'bottom']) expect(terminals.filter((t) => t.side === side).map((t) => t.conductor)).toEqual(['L1', 'L2', 'L3', 'N']);
  });
});
