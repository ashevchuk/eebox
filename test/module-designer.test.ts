import { describe, expect, it } from 'vitest';
import { emptyMyLibrary, MY_LIBRARY_ID } from '../src/library/myModules';
import { SCHEMA_VERSION, type Conductor, type Library, type ModuleDef, type TerminalDef } from '../src/library/types';
import { validateLibrary } from '../src/library/validate';
import {
  netCentre,
  pinLabels,
  addRow,
  evenPositions,
  makeBlock,
  setAllConductors,
  spreadSide,
  POSITION_STEP,
  addPreset,
  addTerminalAt,
  connectTerminals,
  designerLayout,
  detachTerminal,
  makeVariants,
  moveTerminal,
  netGroups,
  pinAt,
  railPreviewScene,
  repairPositions,
  slotAt,
  storedUnit,
  TERMINAL_PRESETS,
  UNIT_PX,
} from '../src/ui/moduleDesigner';
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
    expect(slotAt(layout, layout.body.x + UNIT_PX * 0.5, layout.body.y + 10)).toEqual({ unit: 0, side: 'top' });
    expect(slotAt(layout, layout.body.x + UNIT_PX * 1.5, layout.body.y + layout.body.height - 10)).toEqual({ unit: 1, side: 'bottom' });
    expect(slotAt(layout, layout.body.x + layout.body.width, layout.body.y + 5)).toEqual({ unit: 1.25, side: 'top' });
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

  it('moves a group to the other side but gives it no position, as a group is spread over the width', () => {
    const grouped: ModuleDef = { ...relay, terminals: [{ name: 'G', conductor: 'N', side: 'top', count: 2 }] };
    const result = moveTerminal(libraryOf(grouped), 'relay', 0, 1, 'bottom');
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules[0]!.terminals![0]).toEqual({ name: 'G', conductor: 'N', side: 'bottom', count: 2 });
  });

  it('refuses a missing terminal and a name that is taken on the other side', () => {
    expect(moveTerminal(libraryOf(relay), 'relay', 9, 0, 'top')).toEqual({ ok: false, message: 'That terminal does not exist.' });
    const clash: ModuleDef = { ...relay, terminals: [{ name: 'X', conductor: 'L', side: 'top', unit: 0 }, { name: 'X', conductor: 'N', side: 'bottom', unit: 0 }] };
    expect(moveTerminal(libraryOf(clash), 'relay', 1, 0, 'top')).toEqual({ ok: false, message: 'The top side already has a terminal named X.' });
  });

  it('counts a position from the width that is shown, not from the one the module has by default', () => {
    const result = moveTerminal(libraryOf(relay), 'relay', 0, 3, 'top', 4);
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules[0]!.terminals![0]!.unit).toBe(-1);
  });
});

describe('addPreset', () => {
  const plain: ModuleDef = { id: 'm', kind: 'relay', name: 'M', widthUnits: 3, poles: 1, terminals: [] };
  const names = (draft: Library, side: 'top' | 'bottom') => draft.modules[0]!.terminals!.filter((t) => t.side === side).map((t) => t.name);
  const add = (draft: Library, id: string, side: 'top' | 'bottom' = 'bottom') => {
    const result = addPreset(draft, 'm', id, 1, side);
    if (!result.ok) throw new Error(result.message);
    return result.draft;
  };

  it('adds the terminals of a kind with their standard names and conductors, at the unit given', () => {
    const draft = add(libraryOf(plain), 'changeover');
    expect(draft.modules[0]!.terminals).toEqual([
      { name: '11', conductor: 'C', side: 'bottom', unit: 1 },
      { name: '12', conductor: 'C', side: 'bottom', unit: 1 },
      { name: '14', conductor: 'C', side: 'bottom', unit: 1 },
    ]);
    expect(validateLibrary(draft).ok).toBe(true);
  });

  it('numbers the next contact of the same kind by the tens, so that names never repeat', () => {
    let draft = add(libraryOf(plain), 'no');
    draft = add(draft, 'no');
    draft = add(draft, 'nc');
    draft = add(draft, 'nc');
    expect(names(draft, 'bottom')).toEqual(['13', '14', '23', '24', '11', '12', '21', '22']);
    expect(validateLibrary(draft).ok).toBe(true);
  });

  it('numbers coils by letter and appends a number to a supply that is added twice', () => {
    let draft = add(libraryOf(plain), 'coil', 'top');
    draft = add(draft, 'coil', 'top');
    draft = add(draft, 'supply1', 'top');
    draft = add(draft, 'supply1', 'top');
    expect(names(draft, 'top')).toEqual(['A1', 'A2', 'B1', 'B2', 'L', 'N', 'L2', 'N2']);
  });

  it('names the same kind on the other side without a clash, as sides are separate', () => {
    const draft = add(add(libraryOf(plain), 'no', 'top'), 'no', 'bottom');
    expect(draft.modules[0]!.terminals!.map((t) => `${t.side}:${t.name}`)).toEqual(['top:13', 'top:14', 'bottom:13', 'bottom:14']);
  });

  it('gives DC, earth and sensor kinds the conductors of their family', () => {
    const draft = add(add(add(libraryOf(plain), 'dc'), 'earth'), 'sensor');
    expect(draft.modules[0]!.terminals!.map((t) => `${t.name}:${t.conductor}`)).toEqual(['24V:DCP', '0V:DCN', 'PE:PE', 'S1:C', 'S2:C']);
  });

  it('adds a row as a group with a count and no position', () => {
    const draft = add(libraryOf(plain), 'row');
    expect(draft.modules[0]!.terminals).toEqual([{ name: 'T', conductor: 'L', side: 'bottom', count: 2 }]);
    expect(validateLibrary(draft).ok).toBe(true);
  });

  it('refuses an unknown kind, an unknown module and a comb', () => {
    expect(addPreset(libraryOf(plain), 'm', 'nope', 0, 'top')).toMatchObject({ ok: false });
    expect(addPreset(libraryOf(), 'm', 'coil', 0, 'top')).toMatchObject({ ok: false });
    const comb: ModuleDef = { id: 'm', kind: 'comb', name: 'C', widthUnits: 6, poles: 1, comb: { pattern: ['L'], side: 'top' } };
    expect(addPreset(libraryOf(comb), 'm', 'coil', 0, 'top')).toEqual({ ok: false, message: 'A comb has no terminals.' });
  });

  it('has a distinct id for every kind and a label', () => {
    expect(new Set(TERMINAL_PRESETS.map((p) => p.id)).size).toBe(TERMINAL_PRESETS.length);
    expect(TERMINAL_PRESETS.every((p) => p.label.length > 0)).toBe(true);
  });
});

describe('joining terminals inside the module', () => {
  const three: ModuleDef = {
    id: 'm', kind: 'terminal', name: 'M', widthUnits: 3, poles: 1,
    terminals: [{ name: 'A', conductor: 'N', side: 'top', unit: 0 }, { name: 'B', conductor: 'N', side: 'top', unit: 1 }, { name: 'C', conductor: 'N', side: 'bottom', unit: 2 }],
  };
  const nets = (draft: Library) => draft.modules[0]!.terminals!.map((t) => t.net);

  it('gives two terminals a new net, and adds a third to the net one of them has', () => {
    const first = connectTerminals(libraryOf(three), 'm', 0, 1);
    if (!first.ok) throw new Error(first.message);
    expect(nets(first.draft)).toEqual(['NET1', 'NET1', undefined]);
    const second = connectTerminals(first.draft, 'm', 2, 0);
    if (!second.ok) throw new Error(second.message);
    expect(nets(second.draft)).toEqual(['NET1', 'NET1', 'NET1']);
    expect(validateLibrary(second.draft).ok).toBe(true);
  });

  it('merges two nets that meet, so that no terminal is left on the old one', () => {
    const terminals: TerminalDef[] = [
      { name: 'A', conductor: 'N', side: 'top', unit: 0, net: 'Y' },
      { name: 'B', conductor: 'N', side: 'top', unit: 1, net: 'Y' },
      { name: 'C', conductor: 'N', side: 'bottom', unit: 2 },
      { name: 'D', conductor: 'N', side: 'bottom', unit: 1, net: 'X' },
      { name: 'E', conductor: 'N', side: 'bottom', unit: 0, net: 'X' },
    ];
    const result = connectTerminals(libraryOf({ ...three, terminals }), 'm', 0, 3);
    if (!result.ok) throw new Error(result.message);
    expect(nets(result.draft)).toEqual(['Y', 'Y', undefined, 'Y', 'Y']);
  });

  it('refuses a terminal joined to itself and a terminal that does not exist', () => {
    expect(connectTerminals(libraryOf(three), 'm', 1, 1)).toEqual({ ok: false, message: 'Pick a second terminal to join it to.' });
    expect(connectTerminals(libraryOf(three), 'm', 1, 7)).toEqual({ ok: false, message: 'That terminal does not exist.' });
  });

  it('detaches a terminal and drops a net that is left with one terminal', () => {
    const joined = connectTerminals(libraryOf(three), 'm', 0, 1);
    if (!joined.ok) throw new Error(joined.message);
    const detached = detachTerminal(joined.draft, 'm', 0);
    if (!detached.ok) throw new Error(detached.message);
    expect(nets(detached.draft)).toEqual([undefined, undefined, undefined]);
  });

  it('keeps a net of three when one terminal leaves, and refuses to detach one that is not joined', () => {
    const library = libraryOf({ ...three, terminals: three.terminals!.map((t) => ({ ...t, net: 'N' })) });
    const detached = detachTerminal(library, 'm', 2);
    if (!detached.ok) throw new Error(detached.message);
    expect(nets(detached.draft)).toEqual(['N', 'N', undefined]);
    expect(detachTerminal(libraryOf(three), 'm', 0)).toEqual({ ok: false, message: 'That terminal is not joined to another one.' });
  });

  it('groups the pins of a net for drawing, left to right, and leaves out a net of one pin', () => {
    const library = libraryOf({ ...three, terminals: [{ ...three.terminals![1]!, net: 'J' }, { ...three.terminals![0]!, net: 'J' }, { ...three.terminals![2]!, net: 'ALONE' }] });
    const groups = netGroups(designerLayout(library.modules[0]!));
    expect(groups.map((g) => [g.net, g.pins.map((p) => p.terminal.name)])).toEqual([['J', ['A', 'B']]]);
  });
});

describe('makeVariants', () => {
  const breaker: ModuleDef = { id: 'mcb', kind: 'breaker', name: 'MCB', widthUnits: 1, poles: 1, ratedCurrentA: 10 };

  it('makes one copy per rating after the original, with the rating in id, name and data', () => {
    const result = makeVariants(libraryOf(breaker), 'mcb', [6, 16]);
    if (!result.ok) throw new Error(result.message);
    expect(result.ids).toEqual(['mcb-6a', 'mcb-16a']);
    expect(result.draft.modules.map((m) => [m.id, m.name, m.ratedCurrentA])).toEqual([
      ['mcb', 'MCB', 10], ['mcb-6a', 'MCB 6 A', 6], ['mcb-16a', 'MCB 16 A', 16],
    ]);
    expect(validateLibrary(result.draft).ok).toBe(true);
  });

  it('crosses ratings with curves, and ignores a rating that is repeated', () => {
    const result = makeVariants(libraryOf(breaker), 'mcb', [10, 16, 10], ['B', 'C']);
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules.slice(1).map((m) => [m.id, m.curve, m.ratedCurrentA])).toEqual([
      ['mcb-b10', 'B', 10], ['mcb-b16', 'B', 16], ['mcb-c10', 'C', 10], ['mcb-c16', 'C', 16],
    ]);
  });

  it('copies the terminals, so that editing a variant does not change another', () => {
    const withTerminals: ModuleDef = { ...breaker, terminals: [{ name: 'A', conductor: 'L', side: 'top' }] };
    const result = makeVariants(libraryOf(withTerminals), 'mcb', [6, 16]);
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules[1]!.terminals).not.toBe(result.draft.modules[2]!.terminals);
  });

  it('refuses no ratings, a rating of zero, an unknown module, and an id that is already in the library', () => {
    expect(makeVariants(libraryOf(breaker), 'mcb', [])).toMatchObject({ ok: false });
    expect(makeVariants(libraryOf(breaker), 'mcb', [0])).toMatchObject({ ok: false });
    expect(makeVariants(libraryOf(breaker), 'x', [6])).toEqual({ ok: false, message: 'That module does not exist.' });
    const taken = libraryOf(breaker, { ...breaker, id: 'mcb-6a' });
    expect(makeVariants(taken, 'mcb', [6])).toEqual({ ok: false, message: 'The library already has a module with the id mcb-6a.' });
  });
});

describe('railPreviewScene', () => {
  it('puts the module one unit into a rail that has a unit of room at each end', () => {
    const { panel, resolve } = railPreviewScene(relay, 3);
    expect(panel.railLengthsUnits).toEqual([5]);
    expect(panel.placements).toHaveLength(1);
    expect(panel.placements[0]).toMatchObject({ rail: 0, slot: 1, widthUnits: 3 });
    expect(resolve(panel.placements[0]!.module)).toBe(relay);
    expect(resolve({ libraryId: 'other', moduleId: 'relay' })).toBeUndefined();
  });

  it('gives a module that is not resizable its own width', () => {
    const fixed: ModuleDef = { id: 'f', kind: 'breaker', name: 'F', widthUnits: 3, poles: 3 };
    expect(railPreviewScene(fixed, 3).panel.placements[0]).not.toHaveProperty('widthUnits');
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

describe('repairPositions', () => {
  const fixed = (resizable: ModuleDef['resizable'], terminals: TerminalDef[], widthUnits = 3): ModuleDef => ({
    id: 'm', kind: 'relay', name: 'M', widthUnits, poles: 1, ...(resizable ? { resizable } : {}), terminals,
  });
  const at = (unit: number, name = 'A'): TerminalDef => ({ name, conductor: 'L', side: 'top', unit });
  const units = (draft: Library) => draft.modules[0]!.terminals!.map((t) => t.unit);

  it('moves a position that would not exist at the narrowest width to the right edge, and keeps the others', () => {
    const draft = libraryOf(fixed({ minUnits: 2, maxUnits: 6 }, [at(0, 'A'), at(1, 'B'), at(2, 'C')]));
    const repaired = repairPositions(draft, 'm');
    expect(units(repaired)).toEqual([0, 1, -1]);
    expect(validateLibrary(repaired).ok).toBe(true);
  });

  it('counts from the width the module has, so a unit in the right half stays in the right half', () => {
    const repaired = repairPositions(libraryOf(fixed({ minUnits: 1, maxUnits: 4 }, [at(0, 'A'), at(2, 'B')], 4)), 'm');
    expect(units(repaired)).toEqual([0, -1]);
    expect(validateLibrary(repaired).ok).toBe(true);
  });

  it('returns the very same draft when nothing needs repair, and for modules that are not resizable', () => {
    const fine = libraryOf(fixed({ minUnits: 2, maxUnits: 6 }, [at(0), at(-1, 'B')]));
    expect(repairPositions(fine, 'm')).toBe(fine);
    const notResizable = libraryOf(fixed(undefined, [at(2)]));
    expect(repairPositions(notResizable, 'm')).toBe(notResizable);
    expect(repairPositions(libraryOf(), 'm')).toEqual(libraryOf());
  });

  it('leaves terminals that have no position of their own alone', () => {
    const draft = libraryOf(fixed({ minUnits: 2, maxUnits: 6 }, [{ name: 'G', conductor: 'N', side: 'top', count: 2 }, at(2)]));
    expect(units(repairPositions(draft, 'm'))).toEqual([undefined, -1]);
  });
});

describe('slotAt in steps of a quarter unit', () => {
  const layout = designerLayout(relay);

  it('gives the centre of the unit under the pointer, and the quarter steps between centres', () => {
    const at = (units: number) => slotAt(layout, layout.body.x + (units + 0.5) * UNIT_PX, layout.body.y + 10)!.unit;
    expect([0, 0.2, 0.3, 0.5, 0.74, 1].map(at)).toEqual([0, 0.25, 0.25, 0.5, 0.75, 1]);
    expect(POSITION_STEP).toBe(0.25);
  });

  it('never gives a position outside what a module of that width allows', () => {
    const edge = (x: number) => slotAt(layout, layout.body.x + x, layout.body.y + 10)!.unit;
    expect(edge(0)).toBe(-0.25);
    expect(edge(layout.body.width)).toBe(1.25);
    expect(validateLibrary(libraryOf({ ...relay, resizable: undefined, terminals: [{ name: 'A', conductor: 'L', side: 'top', unit: edge(0) }] })).ok).toBe(true);
  });
});

describe('storedUnit keeps what is valid and tidies what is not', () => {
  const resizable: ModuleDef = { ...relay, widthUnits: 4, resizable: { minUnits: 2, maxUnits: 6 } };

  it('leaves a fractional position that exists at the narrowest width', () => {
    expect(storedUnit(resizable, 0.75)).toBe(0.75);
    expect(storedUnit(resizable, 3.25)).toBe(-0.75);
  });

  it('moves a position in the middle of a wide module to the nearest unit that does exist', () => {
    expect(storedUnit({ ...resizable, widthUnits: 8 }, 3.5, 8)).toBe(1);
    expect(storedUnit({ ...resizable, widthUnits: 8 }, 4.5, 8)).toBe(-2);
  });
});

describe('evenPositions', () => {
  it('puts each terminal in the middle of an equal share of the width', () => {
    expect(evenPositions(1, 3)).toEqual([1]);
    expect(evenPositions(2, 2)).toEqual([0, 1]);
    expect(evenPositions(3, 3)).toEqual([0, 1, 2]);
    expect(evenPositions(3, 2)).toEqual([-0.167, 0.5, 1.167]);
    expect(evenPositions(6, 2)).toEqual([-0.333, 0, 0.333, 0.667, 1, 1.333]);
  });

  it('spreads the terminals between the outermost positions the module allows when equal shares would not fit', () => {
    expect(evenPositions(8, 2)).toEqual([-0.35, -0.107, 0.136, 0.379, 0.621, 0.864, 1.107, 1.35]);
  });

  it('never goes outside what a module of that width allows, for any count that fits', () => {
    for (const width of [1, 2, 3, 6]) {
      for (let count = 1; count <= 12; count++) {
        const positions = evenPositions(count, width);
        const range = { min: Math.min(...positions), max: Math.max(...positions) };
        expect(range.min, `${count} in ${width}`).toBeGreaterThanOrEqual(-0.35);
        expect(range.max, `${count} in ${width}`).toBeLessThanOrEqual(width - 0.65);
      }
    }
  });
});

describe('addRow', () => {
  const block: ModuleDef = { id: 'blk', kind: 'terminal', name: 'Block', widthUnits: 2, poles: 1, terminals: [] };
  const spec = { side: 'bottom' as const, count: 6, conductor: 'N' as const, prefix: 'OUT', joined: true };
  const entries = (draft: Library) => draft.modules[0]!.terminals!;

  it('adds the terminals of a row, numbered, one conductor, spread over the width and joined by one net', () => {
    const result = addRow(libraryOf(block), 'blk', spec);
    if (!result.ok) throw new Error(result.message);
    expect(entries(result.draft).map((t) => t.name)).toEqual(['OUT1', 'OUT2', 'OUT3', 'OUT4', 'OUT5', 'OUT6']);
    expect(new Set(entries(result.draft).map((t) => t.net))).toEqual(new Set(['NET1']));
    expect(entries(result.draft).every((t) => t.conductor === 'N' && t.side === 'bottom')).toBe(true);
    expect(entries(result.draft).map((t) => t.unit)).toEqual(evenPositions(6, 2));
    expect(validateLibrary(result.draft).ok).toBe(true);
  });

  it('adds a row of one without a number in its name, and a row that is not joined without a net', () => {
    const result = addRow(libraryOf(block), 'blk', { ...spec, count: 1, prefix: 'IN', side: 'top', joined: false });
    if (!result.ok) throw new Error(result.message);
    expect(entries(result.draft)).toEqual([{ name: 'IN', conductor: 'N', side: 'top', unit: 0.5 }]);
  });

  it('gives a second joined row a net of its own', () => {
    const first = addRow(libraryOf(block), 'blk', spec);
    if (!first.ok) throw new Error(first.message);
    const second = addRow(first.draft, 'blk', { ...spec, side: 'top', count: 2, prefix: 'IN' });
    if (!second.ok) throw new Error(second.message);
    expect(new Set(entries(second.draft).map((t) => t.net))).toEqual(new Set(['NET1', 'NET2']));
  });

  it('adds a group with a count to a module whose width can change, so that it grows with the module', () => {
    const resizable: ModuleDef = { ...block, resizable: { minUnits: 2, maxUnits: 8 } };
    const result = addRow(libraryOf(resizable), 'blk', spec);
    if (!result.ok) throw new Error(result.message);
    expect(entries(result.draft)).toEqual([{ name: 'OUT', conductor: 'N', side: 'bottom', count: 6, net: 'NET1' }]);
    expect(validateLibrary(result.draft).ok).toBe(true);
  });

  it('refuses a count out of range, a name that is not an identifier, a name already taken, and a missing module', () => {
    expect(addRow(libraryOf(block), 'blk', { ...spec, count: 0 })).toMatchObject({ ok: false });
    expect(addRow(libraryOf(block), 'blk', { ...spec, count: 49 })).toMatchObject({ ok: false });
    expect(addRow(libraryOf(block), 'blk', { ...spec, prefix: '+' })).toMatchObject({ ok: false });
    const once = addRow(libraryOf(block), 'blk', spec);
    if (!once.ok) throw new Error(once.message);
    expect(addRow(once.draft, 'blk', spec)).toEqual({ ok: false, message: 'The bottom side already has a terminal named OUT1.' });
    expect(addRow(libraryOf(), 'blk', spec)).toEqual({ ok: false, message: 'That module does not exist.' });
  });
});

describe('spreadSide', () => {
  const crowded: ModuleDef = {
    id: 'm', kind: 'terminal', name: 'M', widthUnits: 2, poles: 1,
    terminals: [
      { name: 'C', conductor: 'N', side: 'bottom', unit: 1 },
      { name: 'A', conductor: 'N', side: 'bottom', unit: 0 },
      { name: 'B', conductor: 'N', side: 'bottom', unit: 0 },
      { name: 'X', conductor: 'N', side: 'top', unit: 0 },
    ],
  };

  it('spaces the terminals of a side evenly, in the order they stood in, and leaves the other side alone', () => {
    const result = spreadSide(libraryOf(crowded), 'm', 'bottom');
    if (!result.ok) throw new Error(result.message);
    const byName = Object.fromEntries(result.draft.modules[0]!.terminals!.map((t) => [t.name, t.unit]));
    expect(byName).toEqual({ A: -0.167, B: 0.5, C: 1.167, X: 0 });
  });

  it('refuses a side without terminals and a resizable module, which keeps terminals at its edges', () => {
    expect(spreadSide(libraryOf({ ...crowded, terminals: [crowded.terminals![3]!] }), 'm', 'bottom')).toMatchObject({ ok: false });
    expect(spreadSide(libraryOf({ ...crowded, resizable: { minUnits: 2, maxUnits: 4 } }), 'm', 'bottom')).toMatchObject({ ok: false });
  });
});

describe('makeBlock', () => {
  const plain: ModuleDef = { id: 'blk', kind: 'terminal', name: 'Block', widthUnits: 2, poles: 1 };
  const shape = (draft: Library) => draft.modules[0]!.terminals!.map((t) => `${t.side}:${t.name}`);

  it('builds one input on top and six outputs below, all one point', () => {
    const result = makeBlock(libraryOf(plain), 'blk', { top: 1, bottom: 6, conductor: 'L1', joined: true });
    if (!result.ok) throw new Error(result.message);
    expect(shape(result.draft)).toEqual(['top:IN', 'bottom:OUT1', 'bottom:OUT2', 'bottom:OUT3', 'bottom:OUT4', 'bottom:OUT5', 'bottom:OUT6']);
    expect(new Set(result.draft.modules[0]!.terminals!.map((t) => t.net))).toEqual(new Set(['NET1']));
    expect(validateLibrary(result.draft).ok).toBe(true);
  });

  it('builds the other shapes a person asks for: one and one, and eight on one side only', () => {
    const pair = makeBlock(libraryOf(plain), 'blk', { top: 1, bottom: 1, conductor: 'N', joined: true });
    if (!pair.ok) throw new Error(pair.message);
    expect(shape(pair.draft)).toEqual(['top:IN', 'bottom:OUT']);
    const eight = makeBlock(libraryOf(plain), 'blk', { top: 0, bottom: 8, conductor: 'PE', joined: true });
    if (!eight.ok) throw new Error(eight.message);
    expect(shape(eight.draft)).toHaveLength(8);
    expect(eight.draft.modules[0]!.terminals!.every((t) => t.side === 'bottom' && t.conductor === 'PE')).toBe(true);
    expect(validateLibrary(eight.draft).ok).toBe(true);
  });

  it('replaces what was there, and leaves terminals separate when they are not joined', () => {
    const had = makeBlock(libraryOf({ ...plain, terminals: [{ name: 'OLD', conductor: 'L', side: 'top' }] }), 'blk', { top: 2, bottom: 2, conductor: 'L', joined: false });
    if (!had.ok) throw new Error(had.message);
    expect(shape(had.draft)).not.toContain('top:OLD');
    expect(had.draft.modules[0]!.terminals!.some((t) => t.net !== undefined)).toBe(false);
  });

  it('refuses fewer than two terminals, a count out of range, a comb and a missing module', () => {
    expect(makeBlock(libraryOf(plain), 'blk', { top: 1, bottom: 0, conductor: 'L', joined: true })).toMatchObject({ ok: false });
    expect(makeBlock(libraryOf(plain), 'blk', { top: 60, bottom: 1, conductor: 'L', joined: true })).toMatchObject({ ok: false });
    expect(makeBlock(libraryOf(plain), 'blk', { top: 1.5, bottom: 1, conductor: 'L', joined: true })).toMatchObject({ ok: false });
    expect(makeBlock(libraryOf(), 'blk', { top: 1, bottom: 1, conductor: 'L', joined: true })).toMatchObject({ ok: false });
    const comb: ModuleDef = { id: 'blk', kind: 'comb', name: 'C', widthUnits: 6, poles: 1, comb: { pattern: ['L'], side: 'top' } };
    expect(makeBlock(libraryOf(comb), 'blk', { top: 1, bottom: 1, conductor: 'L', joined: true })).toEqual({ ok: false, message: 'A comb has no terminals.' });
  });

  it('makes groups with a count, one per side, on a module whose width can change', () => {
    const resizable: ModuleDef = { ...plain, resizable: { minUnits: 2, maxUnits: 6 } };
    const result = makeBlock(libraryOf(resizable), 'blk', { top: 1, bottom: 6, conductor: 'N', joined: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules[0]!.terminals).toEqual([
      { name: 'IN', conductor: 'N', side: 'top', net: 'NET1' },
      { name: 'OUT', conductor: 'N', side: 'bottom', count: 6, net: 'NET1' },
    ]);
    expect(validateLibrary(result.draft).ok).toBe(true);
  });
});

describe('conductors of a whole module', () => {
  const plain: ModuleDef = { id: 'blk', kind: 'terminal', name: 'Block', widthUnits: 2, poles: 1 };
  const block = (conductor: Conductor): ModuleDef => ({ ...plain, terminals: [{ name: 'A', conductor, side: 'top' }, { name: 'B', conductor, side: 'bottom' }] });

  it('puts one conductor on every terminal, also of a module whose terminals come from its poles', () => {
    const result = setAllConductors(libraryOf(plain), 'blk', 'PE');
    if (!result.ok) throw new Error(result.message);
    expect(result.draft.modules[0]!.terminals!.map((t) => t.conductor)).toEqual(['PE', 'PE']);
    expect(setAllConductors(libraryOf(), 'blk', 'N')).toMatchObject({ ok: false });
  });

  it('makes a variant for each conductor, with the conductor in id and name and on all terminals', () => {
    const result = makeVariants(libraryOf(block('L')), 'blk', [], [], ['L1', 'L2', 'L3', 'N', 'PE']);
    if (!result.ok) throw new Error(result.message);
    expect(result.ids).toEqual(['blk-l1', 'blk-l2', 'blk-l3', 'blk-n', 'blk-pe']);
    expect(result.draft.modules.map((m) => m.name)).toEqual(['Block', 'Block L1', 'Block L2', 'Block L3', 'Block N', 'Block PE']);
    expect(result.draft.modules[4]!.terminals!.map((t) => t.conductor)).toEqual(['N', 'N']);
    expect(result.draft.modules[0]!.terminals!.map((t) => t.conductor)).toEqual(['L', 'L']);
    expect(validateLibrary(result.draft).ok).toBe(true);
  });

  it('crosses conductors with ratings, and refuses to make nothing', () => {
    const crossed = makeVariants(libraryOf(block('L')), 'blk', [63, 125], [], ['N', 'PE']);
    if (!crossed.ok) throw new Error(crossed.message);
    expect(crossed.ids).toEqual(['blk-63a-n', 'blk-125a-n', 'blk-63a-pe', 'blk-125a-pe']);
    expect(makeVariants(libraryOf(block('L')), 'blk', [], [], [])).toEqual({ ok: false, message: 'Give at least one rating, curve or conductor.' });
  });
});

describe('the layout of a crowded module', () => {
  const eight: ModuleDef = { id: 'e', kind: 'terminal', name: 'E', widthUnits: 2, poles: 1, terminals: [] };

  it('draws smaller pins and marks the layout crowded when eight terminals stand in two units', () => {
    const result = addRow(libraryOf(eight), 'e', { side: 'bottom', count: 8, conductor: 'N', prefix: 'T', joined: false });
    if (!result.ok) throw new Error(result.message);
    const layout = designerLayout(result.draft.modules[0]!);
    expect(layout.crowded).toBe(true);
    expect(layout.pinRadius).toBeLessThan(6);
    expect(layout.pinRadius).toBeGreaterThanOrEqual(3);
    const xs = layout.pins.map((p) => p.x);
    expect(new Set(xs).size).toBe(8);
  });

  it('keeps full size pins when there is room', () => {
    const layout = designerLayout({ id: 'p', kind: 'breaker', name: 'P', widthUnits: 2, poles: 1 });
    expect(layout.pinRadius).toBe(6);
    expect(layout.crowded).toBe(false);
  });

  it('makes the pins a little smaller where two share a unit, side by side', () => {
    expect(designerLayout(relay).pinRadius).toBeCloseTo(5.46, 2);
  });
});

describe('pin labels and the centre of a net', () => {
  const eight: ModuleDef = { id: 'e', kind: 'terminal', name: 'E', widthUnits: 2, poles: 1, terminals: [] };
  const withRow = (prefix: string) => {
    const result = addRow(libraryOf(eight), 'e', { side: 'bottom', count: 8, conductor: 'N', prefix, joined: false });
    if (!result.ok) throw new Error(result.message);
    return designerLayout(result.draft.modules[0]!);
  };

  it('write the full names while the pins have room', () => {
    expect(pinLabels(designerLayout(relay))).toEqual(['A1', 'A2', '14']);
  });

  it('write only the numbers when the pins are crowded and share the letters before them', () => {
    expect(pinLabels(withRow('OUT'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('keep the names of a pair that stands side by side, such as the two ends of a coil', () => {
    expect(designerLayout(relay).crowded).toBe(true);
    expect(pinLabels(designerLayout(relay))).toEqual(['A1', 'A2', '14']);
  });

  it('keep the names of a crowded side whose pins do not share a prefix', () => {
    const mixed: ModuleDef = { ...eight, terminals: [
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n, i): TerminalDef => ({ name: `${n}1`, conductor: 'N', side: 'bottom', unit: -0.3 + i * 0.25 })),
    ] };
    expect(pinLabels(designerLayout(mixed))).toEqual(['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1']);
  });

  it('is the middle of the pins that a net is drawn to', () => {
    const layout = designerLayout(relay);
    const pins = [layout.pins[0]!, layout.pins[2]!];
    expect(netCentre(pins)).toEqual({ x: (pins[0]!.x + pins[1]!.x) / 2, y: (pins[0]!.y + pins[1]!.y) / 2 });
  });
});
