import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { terminalSchedule } from '../src/electrical/schedule';
import { terminalsOf } from '../src/electrical/terminals';
import type { Library, ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { panelOf, place } from './fixtures';

const library = JSON.parse(raw) as Library;
const terminalModules = library.modules.filter((m) => m.kind === 'terminal');
const blocks = terminalModules.filter((m) => /^terminal-\d/.test(m.id));
const strips = terminalModules.filter((m) => m.id.startsWith('terminal-strip-'));
const distribution = terminalModules.filter((m) => m.id.startsWith('distribution-block-'));
const byId = (id: string) => terminalModules.find((m) => m.id === id)!;
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

describe('the bundled terminal strips and distribution blocks', () => {
  it('are strips of 6 and of 12 ways for N, PE and a generic control way, and a block each for L, N and PE', () => {
    expect(strips.map((m) => m.id).sort()).toEqual(['terminal-strip-12-c', 'terminal-strip-12-n', 'terminal-strip-12-pe', 'terminal-strip-6-c', 'terminal-strip-6-n', 'terminal-strip-6-pe']);
    expect(distribution.map((m) => m.id).sort()).toEqual(['distribution-block-l', 'distribution-block-n', 'distribution-block-pe']);
  });

  it('have a way of a strip on top and one below, joined, numbered along the strip', () => {
    for (const def of strips) {
      const ways = Number(def.id.split('-')[2]);
      const terminals = terminalsOf(def);
      expect(terminals, def.id).toHaveLength(2 * ways);
      const nets = new Map<string, number>();
      for (const t of terminals) nets.set(t.net!, (nets.get(t.net!) ?? 0) + 1);
      expect([...nets.values()].every((n) => n === 2), def.id).toBe(true);
      expect(nets.size, def.id).toBe(ways);
      const top = terminals.filter((t) => t.side === 'top');
      expect(top.map((t) => t.unit), def.id).toEqual([...top.map((t) => t.unit)].sort((a, b) => a - b));
    }
    expect(terminalsOf(byId('terminal-strip-6-pe'))[0]!.name).toBe('PE1');
    expect(terminalsOf(byId('terminal-strip-6-c'))[0]!.name).toBe('1');
  });

  it('join the two inputs and the six outputs of a distribution block into one point', () => {
    for (const def of distribution) {
      const terminals = terminalsOf(def);
      expect(terminals.filter((t) => t.side === 'top'), def.id).toHaveLength(2);
      expect(terminals.filter((t) => t.side === 'bottom'), def.id).toHaveLength(6);
      expect(new Set(terminals.map((t) => t.net)).size, def.id).toBe(1);
    }
  });
});

describe('the bundled contactors', () => {
  const contactors = library.modules.filter((m) => m.kind === 'contactor');

  it('are one to four poles, with the coil on top and a contact for every pole', () => {
    expect(contactors).toHaveLength(2 + 4 + 4 + 4);
    for (const def of contactors) {
      expect(def.logic!.contacts, def.id).toHaveLength(def.poles);
      const terminals = terminalsOf(def);
      expect(terminals.filter((t) => t.name.startsWith('T')), def.id).toHaveLength(def.poles);
      expect(terminals.filter((t) => t.side === 'top' && t.name.startsWith('A')).map((t) => t.name), def.id).toEqual(['A1', 'A2']);
    }
    expect(contactors.find((m) => m.id === 'contactor-2p-25-230')).toMatchObject({ name: 'Contactor 2P 25A, 230V coil', widthUnits: 2 });
    expect(contactors.find((m) => m.id === 'contactor-4p-63-230')!.widthUnits).toBe(5);
    expect(terminalsOf(contactors.find((m) => m.id === 'contactor-4p-25-230')!).filter((t) => t.name === 'T4')[0]!.conductor).toBe('N');
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
