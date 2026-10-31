import { describe, expect, it } from 'vitest';
import { buildNets, combContacts } from '../src/electrical/nets';
import type { Panel } from '../src/layout/placement';
import type { ModuleRef } from '../src/layout/placement';
import { parseLibraryJson } from '../src/library/validate';
import genericIecText from '../libraries/generic-iec.json?raw';
import { combAt, panelOf, place } from './fixtures';

const parsed = parseLibraryJson(genericIecText);
if (!parsed.ok) throw new Error('the bundled library must be valid');
const modules = new Map(parsed.library.modules.map((m) => [m.id, m]));
const resolve = (ref: ModuleRef) => modules.get(ref.moduleId);
const combsOf = (side: 'top' | 'bottom') => parsed.library.modules.filter((m) => m.kind === 'comb' && m.comb?.side === side);

describe('the combs of the bundled library', () => {
  it('have a bottom twin for each top one, with the same pattern and poles, and a name that says bottom', () => {
    const tops = combsOf('top');
    const bottoms = combsOf('bottom');
    expect(bottoms.map((m) => m.id)).toEqual(tops.map((m) => `${m.id}-bottom`));
    tops.forEach((top, i) => {
      expect(bottoms[i]!.comb!.pattern).toEqual(top.comb!.pattern);
      expect(bottoms[i]!.poles).toBe(top.poles);
      expect(bottoms[i]!.widthUnits).toBe(top.widthUnits);
      expect(bottoms[i]!.name).toContain('bottom');
    });
  });

  it('keep the ids of the top combs, which projects refer to', () => {
    for (const id of ['comb-3ph-12', 'comb-3phn-12', 'comb-1ph-12', 'comb-lpn-12']) expect(modules.get(id)?.comb?.side).toBe('top');
  });

  it('touch the bottom terminals of a module and not the top ones', () => {
    const lib = (moduleId: string): ModuleRef => ({ libraryId: parsed.library.id, moduleId });
    const rail: Panel = panelOf([], [], [12]);
    const panel: Panel = {
      ...rail,
      placements: [
        { ...place('p1', 'mcb-3p-c32', 0, 0), module: lib('mcb-3p-c32') },
        { ...place('p2', 'mcb-3p-c32', 0, 3), module: lib('mcb-3p-c32') },
      ],
      combs: [{ ...combAt('c1', 'comb-3ph-12-bottom', 0, 0), module: lib('comb-3ph-12-bottom') }],
    };
    const contacts = combContacts(panel, resolve);
    expect(contacts).toHaveLength(6);
    expect(contacts.every((c) => c.terminalId.startsWith('bottom:'))).toBe(true);
    const nets = buildNets({ panel, schematic: { nodes: [], wires: [] } }, resolve);
    expect(nets).toHaveLength(3);
    expect(nets.every((n) => n.terminals.every((t) => t.terminal.side === 'bottom'))).toBe(true);
  });
});
