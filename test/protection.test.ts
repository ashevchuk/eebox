import { describe, expect, it } from 'vitest';
import { DEFAULT_CABLE_SETTINGS, cableSettingsToText, parseCableSettings } from '../src/electrical/cables';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { findRuleWarnings } from '../src/electrical/rules';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import { addNode, connectAll, emptySchematic, setNodeLoad, setSourceProtection, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { panelOf, place } from './fixtures';

const breaker: ModuleDef = {
  id: 'c16', kind: 'breaker', name: 'MCB C16', widthUnits: 1, poles: 1, ratedCurrentA: 16, curve: 'C', breakingCapacityKA: 6,
};
const defs: Record<string, ModuleDef> = { c16: breaker, rcbo: { ...breaker, id: 'rcbo', kind: 'rcbo', residualCurrentMa: 30 } };
const resolve = (r: ModuleRef): ModuleDef | undefined => defs[r.moduleId];

interface Supply {
  shortCircuitKA?: number;
  loopImpedanceMOhm?: number;
}

function warnings(moduleId: string, supply: Supply, lengthM: number, sectionMm2 = 1.5, settings = DEFAULT_CABLE_SETTINGS): string[] {
  const panel = panelOf([place('p1', moduleId, 0, 0)]);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -300, conductors: ['L', 'N'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Heater', x: 0, y: 300, conductors: ['L', 'N'] }).schematic;
  const id = (label: string) => schematic.nodes.find((n) => n.label === label)!.id;
  const source = id('Mains');
  const load = id('Heater');
  for (const [key, value] of Object.entries(supply)) {
    const result = setSourceProtection(schematic, source, key as keyof Supply, value);
    if (!result.ok) throw new Error(result.error.kind);
    schematic = result.schematic;
  }
  const loaded = setNodeLoad(schematic, load, { powerW: 1000, lengthM, crossSectionMm2: sectionMm2 as 1.5 });
  if (!loaded.ok) throw new Error(loaded.error.kind);
  schematic = loaded.schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const module = schematic.nodes.find((n) => n.placementId === 'p1')!.id;
  for (const [a, b] of [[source, module], [module, load]]) {
    const wired = connectAll(schematic, terminalsOf, a!, b!);
    if (!wired.ok) throw new Error(wired.error.kind);
    schematic = wired.schematic;
  }
  return findRuleWarnings({ panel, schematic }, resolve, settings).filter((w) => w.includes('kA') || w.includes('trips'));
}

describe('breaking capacity against the short-circuit current', () => {
  it('warns when a wired breaker cannot break what the source can deliver', () => {
    expect(warnings('c16', { shortCircuitKA: 10 }, 5)).toEqual([
      'MCB C16 [p1]: its breaking capacity of 6 kA is below the prospective short-circuit current of 10 kA',
    ]);
  });

  it('is quiet at the rating and when the source does not say', () => {
    expect(warnings('c16', { shortCircuitKA: 6 }, 5)).toEqual([]);
    expect(warnings('c16', {}, 5)).toEqual([]);
  });
});

describe('fault loop', () => {
  it('warns when the fault current at the end of the cable is below what trips the breaker', () => {
    const [warning] = warnings('c16', { loopImpedanceMOhm: 200 }, 100);
    expect(warning).toContain('Heater');
    expect(warning).toContain('160 A');
    expect(warning).toContain('C16');
  });

  it('is quiet for a short cable, without the impedance of the source, and behind an RCBO', () => {
    expect(warnings('c16', { loopImpedanceMOhm: 200 }, 10)).toEqual([]);
    expect(warnings('c16', {}, 100)).toEqual([]);
    expect(warnings('rcbo', { loopImpedanceMOhm: 200 }, 100)).toEqual([]);
  });

  it('uses the multiples of the settings', () => {
    const lenient = { ...DEFAULT_CABLE_SETTINGS, tripMultiples: { ...DEFAULT_CABLE_SETTINGS.tripMultiples, C: 1 } };
    expect(warnings('c16', { loopImpedanceMOhm: 200 }, 100, 1.5, lenient)).toEqual([]);
  });
});

describe('source protection values', () => {
  it('refuse zero and values above the bound, and clear with undefined', () => {
    const schematic = addNode(emptySchematic(), { kind: 'source', label: 'S', x: 0, y: 0, conductors: ['L', 'N'] }).schematic;
    expect(setSourceProtection(schematic, 'n1', 'shortCircuitKA', 0).ok).toBe(false);
    expect(setSourceProtection(schematic, 'n1', 'shortCircuitKA', 1000).ok).toBe(false);
    const set = setSourceProtection(schematic, 'n1', 'shortCircuitKA', 6);
    if (!set.ok) throw new Error(set.error.kind);
    expect(set.schematic.nodes[0]?.shortCircuitKA).toBe(6);
    const cleared = setSourceProtection(set.schematic, 'n1', 'shortCircuitKA', undefined);
    if (!cleared.ok) throw new Error(cleared.error.kind);
    expect('shortCircuitKA' in cleared.schematic.nodes[0]!).toBe(false);
  });
});

describe('trip multiples in the settings', () => {
  it('are refused when out of range or missing', () => {
    const edit = (change: (s: Record<string, any>) => void) => {
      const settings = JSON.parse(cableSettingsToText(DEFAULT_CABLE_SETTINGS));
      change(settings);
      const result = parseCableSettings(JSON.stringify(settings));
      return result.ok ? [] : result.errors.map((e) => e.path);
    };
    expect(edit((s) => (s.tripMultiples.C = 0))).toEqual(['tripMultiples.C']);
    expect(edit((s) => delete s.tripMultiples)).toEqual(['tripMultiples']);
    expect(edit((s) => (s.faultVoltageV = 0))).toEqual(['faultVoltageV']);
  });
});

describe('source protection values in the project file', () => {
  it('round-trip, and are refused on a node that is not a source', () => {
    let schematic = addNode(emptySchematic(), { kind: 'source', label: 'S', x: 0, y: 0, conductors: ['L', 'N'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Q', x: 0, y: 100, conductors: ['L', 'N'] }).schematic;
    for (const [key, value] of [['shortCircuitKA', 6], ['loopImpedanceMOhm', 300]] as const) {
      const set = setSourceProtection(schematic, 'n1', key, value);
      if (!set.ok) throw new Error(set.error.kind);
      schematic = set.schematic;
    }
    const file = buildProjectFile({ panel: panelOf([]), schematic }, resolve);
    expect(parseProjectJson(JSON.stringify(file))).toEqual({ ok: true, file, warnings: [] });

    const bad = JSON.parse(JSON.stringify(file));
    bad.project.schematic.nodes[1].shortCircuitKA = 6;
    bad.project.schematic.nodes[0].loopImpedanceMOhm = 0;
    const result = parseProjectJson(JSON.stringify(bad));
    expect(result.ok ? [] : result.errors.map((e) => e.path).sort()).toEqual([
      'project.schematic.nodes[0].loopImpedanceMOhm',
      'project.schematic.nodes[1].shortCircuitKA',
    ]);
  });
});
