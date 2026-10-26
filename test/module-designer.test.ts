import { describe, expect, it } from 'vitest';
import { emptyMyLibrary, MY_LIBRARY_ID } from '../src/library/myModules';
import { SCHEMA_VERSION, type Library, type ModuleDef } from '../src/library/types';
import { validateLibrary } from '../src/library/validate';
import { addTerminalAt, designerLayout, moveTerminal, pinAt, slotAt, storedUnit, UNIT_PX } from '../src/ui/moduleDesigner';
import { MODULE_TEMPLATES } from '../src/ui/moduleTemplates';

const relay: ModuleDef = {
  id: 'relay', kind: 'relay', name: 'Relay', widthUnits: 2, poles: 2, resizable: { minUnits: 1, maxUnits: 4 },
  terminals: [
    { name: 'A1', conductor: 'L', side: 'top', unit: 0 },
    { name: 'A2', conductor: 'N', side: 'top', unit: 0 },
    { name: '14', conductor: 'C', side: 'bottom', unit: -1 },
  ],
};
const libraryOf = (...modules: ModuleDef[]): Library => ({ schemaVersion: SCHEMA_VERSION, id: 'lib', name: 'Lib', modules, enclosures: [] });

describe('designerLayout', () => {
  const layout = designerLayout(relay);

  it('draws the body as wide as the module and puts pins on the unit they sit on', () => {
    expect(layout.body.width).toBe(2 * UNIT_PX);
    const pin = (name: string) => layout.pins.find((p) => p.terminal.name === name)!;
    expect(pin('14').x).toBeCloseTo(layout.body.x + 1.5 * UNIT_PX);
    expect(pin('A1').y).toBeLessThan(pin('14').y);
  });

  it('puts two pins that share a unit side by side around its centre', () => {
    const [a1, a2] = ['A1', 'A2'].map((n) => layout.pins.find((p) => p.terminal.name === n)!);
    expect(a1!.y).toBe(a2!.y);
    expect((a1!.x + a2!.x) / 2).toBeCloseTo(layout.body.x + 0.5 * UNIT_PX);
    expect(a2!.x - a1!.x).toBeGreaterThan(8);
  });

  it('follows the width of a copy: a negative position stays at the right edge', () => {
    const wide = designerLayout(relay, 4);
    expect(wide.pins.find((p) => p.terminal.name === '14')!.x).toBeCloseTo(wide.body.x + 3.5 * UNIT_PX);
  });

  it('knows which entry of the list each pin comes from, also for a group, and none when derived', () => {
    const bar: ModuleDef = {
      id: 'bar', kind: 'busbar', name: 'Bar', widthUnits: 6, poles: 1, resizable: { minUnits: 2, maxUnits: 12 },
      terminals: [{ name: 'N', conductor: 'N', side: 'top', count: 3 }, { name: 'B', conductor: 'N', side: 'bottom', count: 2 }],
    };
    expect(designerLayout(bar).pins.map((p) => p.source)).toEqual([0, 0, 0, 1, 1]);
    expect(designerLayout({ id: 'm', kind: 'breaker', name: 'M', widthUnits: 1, poles: 2 }).pins.map((p) => p.source)).toEqual([null, null, null, null]);
  });

  it('has no pins for a comb', () => {
    const comb: ModuleDef = { id: 'c', kind: 'comb', name: 'C', widthUnits: 6, poles: 1, comb: { pattern: ['L'], side: 'top' } };
    expect(designerLayout(comb).pins).toEqual([]);
  });
});

describe('pinAt and slotAt', () => {
  const layout = designerLayout(relay);
  const pin = layout.pins.find((p) => p.terminal.name === '14')!;

  it('finds a pin near a point and nothing in empty space', () => {
    expect(pinAt(layout, pin.x + 3, pin.y - 3)?.terminal.name).toBe('14');
    expect(pinAt(layout, layout.body.x + 5, layout.body.y + layout.body.height / 2)).toBeUndefined();
  });

  it('takes the nearest of two pins that are both within reach', () => {
    const a1 = layout.pins.find((p) => p.terminal.name === 'A1')!;
    expect(pinAt(layout, a1.x - 2, a1.y)?.terminal.name).toBe('A1');
  });

  it('turns a point on the body into a unit and a side, and refuses a point outside it', () => {
    expect(slotAt(layout, layout.body.x + 5, layout.body.y + 10)).toEqual({ unit: 0, side: 'top' });
    expect(slotAt(layout, layout.body.x + UNIT_PX + 5, layout.body.y + layout.body.height - 10)).toEqual({ unit: 1, side: 'bottom' });
    expect(slotAt(layout, layout.body.x + layout.body.width, layout.body.y + 5)).toEqual({ unit: 1, side: 'top' });
    expect(slotAt(layout, layout.body.x - 5, layout.body.y + 5)).toBeNull();
    expect(slotAt(layout, layout.body.x + 5, layout.body.y + layout.body.height + 60)).toBeNull();
  });
});

describe('storedUnit', () => {
  it('counts from the left on a fixed module and keeps the unit on the module', () => {
    const fixed: ModuleDef = { id: 'f', kind: 'breaker', name: 'F', widthUnits: 3, poles: 1 };
    expect([0, 2, 7, -1].map((u) => storedUnit(fixed, u))).toEqual([0, 2, 2, 0]);
  });

  it('counts a resizable module from the nearer edge, within what the narrowest width has', () => {
    const wide: ModuleDef = { ...relay, widthUnits: 4, resizable: { minUnits: 2, maxUnits: 6 } };
    expect([0, 1, 2, 3].map((u) => storedUnit(wide, u))).toEqual([0, 1, -2, -1]);
    const narrow: ModuleDef = { ...relay, widthUnits: 2, resizable: { minUnits: 1, maxUnits: 4 } };
    expect([0, 1].map((u) => storedUnit(narrow, u))).toEqual([0, -1]);
  });
});

describe('addTerminalAt', () => {
  it('adds a terminal with a free name at a unit and side, and a module with derived terminals gets them listed', () => {
    const plain: ModuleDef = { id: 'm', kind: 'breaker', name: 'M', widthUnits: 2, poles: 1 };
    const result = addTerminalAt(libraryOf(plain), 'm', 1, 'bottom');
    if (!result.ok) throw new Error(result.message);
    const terminals = result.draft.modules[0]!.terminals!;
    expect(terminals.map((t) => `${t.side}:${t.name}`)).toEqual(['top:L', 'bottom:L', 'bottom:T3']);
    expect(terminals[2]).toEqual({ name: 'T3', conductor: 'L', side: 'bottom', unit: 1 });
    expect(result.index).toBe(2);
    expect(validateLibrary(result.draft).ok).toBe(true);
  });

  it('takes the conductor it is given and counts a unit from the right on a resizable module', () => {
    const result = addTerminalAt(libraryOf(relay), 'relay', 1, 'top', 'C');
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules[0]!.terminals!.at(-1)).toMatchObject({ conductor: 'C', side: 'top', unit: -1 });
    expect(validateLibrary(result.draft).ok).toBe(true);
  });

  it('refuses a module that does not exist and a comb', () => {
    const comb: ModuleDef = { id: 'c', kind: 'comb', name: 'C', widthUnits: 6, poles: 1, comb: { pattern: ['L'], side: 'top' } };
    expect(addTerminalAt(libraryOf(), 'x', 0, 'top')).toEqual({ ok: false, message: 'That module does not exist.' });
    expect(addTerminalAt(libraryOf(comb), 'c', 0, 'top')).toEqual({ ok: false, message: 'A comb has no terminals.' });
  });
});

describe('moveTerminal', () => {
  it('moves a terminal to another unit and side', () => {
    const result = moveTerminal(libraryOf(relay), 'relay', 2, 0, 'top');
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules[0]!.terminals![2]).toEqual({ name: '14', conductor: 'C', side: 'top', unit: 0 });
  });

  it('refuses to move a group, a missing terminal and a name that is taken on the other side', () => {
    const grouped: ModuleDef = { ...relay, terminals: [{ name: 'G', conductor: 'N', side: 'top', count: 2 }] };
    expect(moveTerminal(libraryOf(grouped), 'relay', 0, 0, 'bottom')).toMatchObject({ ok: false });
    expect(moveTerminal(libraryOf(relay), 'relay', 9, 0, 'top')).toEqual({ ok: false, message: 'That terminal does not exist.' });
    const clash: ModuleDef = { ...relay, terminals: [{ name: 'X', conductor: 'L', side: 'top', unit: 0 }, { name: 'X', conductor: 'N', side: 'bottom', unit: 0 }] };
    expect(moveTerminal(libraryOf(clash), 'relay', 1, 0, 'top')).toEqual({ ok: false, message: 'The top side already has a terminal named X.' });
  });
});

describe('templates and the My modules library', () => {
  it('build valid modules that are named for the new id, each time as a separate copy', () => {
    for (const template of MODULE_TEMPLATES) {
      const first = template.build('mine');
      expect(first.id, template.id).toBe('mine');
      expect(validateLibrary(libraryOf(first)).ok, template.id).toBe(true);
      expect(template.build('mine'), template.id).not.toBe(first);
    }
  });

  it('have distinct ids and start from different terminals', () => {
    expect(new Set(MODULE_TEMPLATES.map((t) => t.id)).size).toBe(MODULE_TEMPLATES.length);
    expect(MODULE_TEMPLATES.find((t) => t.id === 'monitoring-relay')!.build('m').terminals?.some((t) => t.conductor === 'C')).toBe(true);
  });

  it('give an empty library for My modules that is valid and has its own id', () => {
    const mine = emptyMyLibrary();
    expect(mine.id).toBe(MY_LIBRARY_ID);
    expect(validateLibrary(mine).ok).toBe(true);
  });
});
