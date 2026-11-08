import { describe, expect, it } from 'vitest';
import { terminalsOf } from '../src/electrical/terminals';
import { sideRange } from '../src/library/positions';
import { SCHEMA_VERSION, type Library, type ModuleDef } from '../src/library/types';
import { validateLibrary } from '../src/library/validate';
import { applyEditorEdit, describeEditor } from '../src/ui/libraryEditor';
import { addRow, addTerminalAt, designerLayout, makeBlock, moveTerminal, slotAt, spreadSide, storedUnit, UNIT_PX } from '../src/ui/moduleDesigner';

const column: ModuleDef = {
  id: 'column',
  kind: 'terminal',
  name: 'Column',
  widthUnits: 0.7,
  heightMm: 70,
  mounting: 'rail',
  poles: 1,
  sideTerminals: true,
  terminals: [
    { name: 'A', conductor: 'N', side: 'top', unit: 0.5 },
    { name: 'B', conductor: 'N', side: 'top', unit: 1.5 },
    { name: 'C', conductor: 'N', side: 'bottom', unit: 1 },
  ],
};
const across: ModuleDef = {
  id: 'across',
  kind: 'terminal',
  name: 'Across',
  widthUnits: 4,
  heightMm: 90,
  mounting: 'rail',
  poles: 1,
  resizable: { minUnits: 2, maxUnits: 8 },
  terminals: [
    { name: 'T', conductor: 'L', side: 'top', count: 4 },
    { name: 'B', conductor: 'L', side: 'bottom', unit: 1 },
  ],
};
const libraryOf = (...modules: ModuleDef[]): Library => ({ schemaVersion: SCHEMA_VERSION, id: 'lib', name: 'Lib', modules, enclosures: [] });
const only = (draft: Library, id: string): ModuleDef => draft.modules.find((m) => m.id === id)!;
const must = <T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

describe('the designer of a module with its terminals down the sides', () => {
  const layout = designerLayout(column);

  it('draws the top terminals down the right side and the bottom ones down the left, at their distance from the top edge', () => {
    expect(layout.sideways).toBe(true);
    const pin = (name: string) => layout.pins.find((p) => p.terminal.name === name)!;
    const { body } = layout;
    expect(body.width).toBeCloseTo(0.7 * UNIT_PX);
    expect(pin('A').x).toBeGreaterThan(body.x + body.width / 2);
    expect(pin('C').x).toBeLessThan(body.x + body.width / 2);
    expect(pin('A').y).toBeCloseTo(body.y + (0.5 / (70 / 17.5)) * body.height);
    expect(pin('B').y - pin('A').y).toBeCloseTo((1 / (70 / 17.5)) * body.height);
  });

  it('keeps a module that is not sideways drawn along its width', () => {
    expect(designerLayout(across).sideways).toBe(false);
  });

  it('turns a click on the right half into a top terminal and on the left half into a bottom one, at the clicked height, in quarter units', () => {
    const { body } = layout;
    const y = body.y + (2 / (70 / 17.5)) * body.height;
    expect(slotAt(layout, body.x + body.width - 3, y)).toEqual({ unit: 2, side: 'top' });
    expect(slotAt(layout, body.x + 3, y)).toEqual({ unit: 2, side: 'bottom' });
    expect(slotAt(layout, body.x + 3, body.y - 5)).toBeNull();
    expect(slotAt(layout, body.x + body.width + 100, y)).toBeNull();
  });

  it('keeps a click near either end inside the range the validator allows', () => {
    const { body } = layout;
    const { min, max } = sideRange(70);
    const near = slotAt(layout, body.x + 3, body.y + 0.5)!;
    const far = slotAt(layout, body.x + 3, body.y + body.height - 0.5)!;
    expect(near.unit).toBeGreaterThanOrEqual(min);
    expect(far.unit).toBeLessThanOrEqual(max);
  });

  it('stores a position as a distance from the top edge, kept inside the module', () => {
    expect(storedUnit(column, 2.25)).toBe(2.25);
    expect(storedUnit(column, 99)).toBeCloseTo(sideRange(70).max, 5);
    expect(storedUnit(column, -3)).toBe(sideRange(70).min);
  });

  it('adds and moves a terminal by that distance and leaves a draft the validator accepts', () => {
    const draft = libraryOf(column);
    const added = must(addTerminalAt(draft, 'column', 2.5, 'top', 'N'));
    expect(only(added.draft, 'column').terminals!.at(-1)).toMatchObject({ side: 'top', unit: 2.5 });
    const moved = must(moveTerminal(added.draft, 'column', 0, 3, 'bottom'));
    expect(only(moved.draft, 'column').terminals![0]).toMatchObject({ side: 'bottom', unit: 3 });
    expect(validateLibrary(moved.draft).ok).toBe(true);
  });

  it('adds a row, spreads a side and makes a block evenly down the height', () => {
    const draft = libraryOf({ ...column, terminals: [{ name: 'X', conductor: 'N', side: 'bottom', unit: 1 }] });
    const row = must(addRow(draft, 'column', { side: 'top', count: 4, conductor: 'N', prefix: 'N', joined: true }));
    const top = terminalsOf(only(row.draft, 'column')).filter((t) => t.side === 'top');
    expect(top).toHaveLength(4);
    const pitch = 70 / 17.5 / 4;
    top.slice(1).forEach((t, i) => expect(t.unit - top[i]!.unit).toBeCloseTo(pitch, 2));
    expect(top[0]!.unit).toBeCloseTo(pitch / 2, 2);
    expect(top.every((t) => t.net === top[0]!.net && t.net !== undefined)).toBe(true);
    expect(validateLibrary(row.draft).ok).toBe(true);
    const uneven = libraryOf({ ...column, terminals: [{ name: 'A', conductor: 'N', side: 'top', unit: 0.5 }, { name: 'B', conductor: 'N', side: 'top', unit: 1 }, { name: 'C', conductor: 'N', side: 'top', unit: 3 }] });
    const spread = must(spreadSide(uneven, 'column', 'top'));
    const spaced = only(spread.draft, 'column').terminals!.map((t) => t.unit!);
    expect(spaced[1]! - spaced[0]!).toBeCloseTo(spaced[2]! - spaced[1]!, 3);
    const block = must(makeBlock(libraryOf(column), 'column', { top: 3, bottom: 2, conductor: 'N', joined: true }));
    expect(terminalsOf(only(block.draft, 'column')).map((t) => [t.side, t.name])).toEqual([['top', 'IN1'], ['top', 'IN2'], ['top', 'IN3'], ['bottom', 'OUT1'], ['bottom', 'OUT2']]);
    expect(validateLibrary(block.draft).ok).toBe(true);
  });
});

describe('the field that puts the terminals down the sides', () => {
  const edit = (draft: Library, id: string, key: string, raw: string): Library => {
    const result = applyEditorEdit({ draft, target: { kind: 'module', id } }, key, raw);
    if (!result.ok) throw new Error(result.message);
    return result.draft;
  };
  const DOWN = 'in a column down the sides';
  const ACROSS = 'in a row across the width';

  it('is offered for a module that has terminals, with the way they stand now selected', () => {
    const view = describeEditor({ draft: libraryOf(column, across), target: { kind: 'module', id: 'column' } });
    expect(view.fields.find((f) => f.key === 'sideTerminals')).toMatchObject({ value: DOWN, options: [ACROSS, DOWN] });
    const other = describeEditor({ draft: libraryOf(column, across), target: { kind: 'module', id: 'across' } });
    expect(other.fields.find((f) => f.key === 'sideTerminals')).toMatchObject({ value: ACROSS });
  });

  it('moves the terminals of a row down the sides, evenly, keeping the names, groups made single and the module no longer resizable', () => {
    const draft = edit(libraryOf(across), 'across', 'sideTerminals', DOWN);
    const def = only(draft, 'across');
    expect(def.sideTerminals).toBe(true);
    expect(def.resizable).toBeUndefined();
    const placed = terminalsOf(def);
    expect(placed.map((t) => t.id)).toEqual(['top:T1', 'top:T2', 'top:T3', 'top:T4', 'bottom:B']);
    expect(placed.filter((t) => t.side === 'top').map((t) => t.unit)).toEqual([0.643, 1.929, 3.214, 4.5].map((v) => expect.closeTo(v, 2)));
    expect(validateLibrary(draft).ok).toBe(true);
  });

  it('puts them back across the width, evenly, and the terminals keep their names', () => {
    const back = edit(libraryOf(column), 'column', 'sideTerminals', ACROSS);
    const def = only(back, 'column');
    expect(def.sideTerminals).toBeUndefined();
    expect(terminalsOf(def).map((t) => t.id)).toEqual(['top:A', 'top:B', 'bottom:C']);
    const units = terminalsOf(def).filter((t) => t.side === 'top').map((t) => t.unit);
    expect(units).toHaveLength(2);
    expect(validateLibrary(back).ok).toBe(true);
  });

  it('changes nothing when the module already stands that way', () => {
    const draft = libraryOf(column);
    expect(edit(draft, 'column', 'sideTerminals', DOWN)).toEqual(draft);
  });
});
