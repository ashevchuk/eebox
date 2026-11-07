import { describe, expect, it } from 'vitest';
import type { Library, ModuleDef } from '../src/library/types';
import { validateDraft, addModule, applyEditorAction, applyEditorEdit, describeEditor, duplicateModule, newLibrary, type EditorState } from '../src/ui/libraryEditor';
import { addRow, addTerminalAt, designerLayout, fitTerminalsToWidth, makeVariants, roleMarker, setAllConductors } from '../src/ui/moduleDesigner';

const withModule = (patch: Partial<ModuleDef>) => {
  const made = addModule(newLibrary('mine', 'Mine'), 'rcd');
  const draft: Library = { ...made.draft, modules: made.draft.modules.map((m) => ({ ...m, ...patch })) };
  return { draft, id: made.id };
};
const state = (draft: Library, id: string): EditorState => ({ draft, target: { kind: 'module', id } });
const fieldOf = (s: EditorState, key: string) => describeEditor(s).fields.find((f) => f.key === key);
const moduleOf = (draft: Library, id: string) => draft.modules.find((m) => m.id === id)!;
const edit = (s: EditorState, key: string, raw: string): Library => {
  const result = applyEditorEdit(s, key, raw);
  if (!result.ok) throw new Error(result.message);
  return result.draft;
};

describe('the input side of a device in the library editor', () => {
  it('is a choice on a module with terminals from its poles, empty for either side', () => {
    const { draft, id } = withModule({});
    expect(fieldOf(state(draft, id), 'feed')).toMatchObject({ kind: 'select', value: '' });
    const fed = edit(state(draft, id), 'feed', 'top');
    expect(moduleOf(fed, id).feed).toBe('top');
    expect(validateDraft(fed)).toEqual([]);
    expect('feed' in moduleOf(edit(state(fed, id), 'feed', ''), id)).toBe(false);
  });

  it('is not offered once the terminals are listed, where each one has its own role', () => {
    const { draft, id } = withModule({ terminals: [{ name: 'L', conductor: 'L', side: 'top' }] });
    expect(fieldOf(state(draft, id), 'feed')).toBeUndefined();
    expect(fieldOf(state(draft, id), 't.0.role')).toMatchObject({ kind: 'select', value: '' });
  });

  it('sets and clears the role of a listed terminal', () => {
    const { draft, id } = withModule({ terminals: [{ name: 'L', conductor: 'L', side: 'top' }] });
    const marked = edit(state(draft, id), 't.0.role', 'input');
    expect(moduleOf(marked, id).terminals![0]!.role).toBe('input');
    expect('role' in moduleOf(edit(state(marked, id), 't.0.role', ''), id).terminals![0]!).toBe(false);
  });

  it('turns into roles when the terminals become a list, so the draft stays valid', () => {
    const { draft, id } = withModule({ feed: 'top', poles: 2 });
    const added = applyEditorAction(state(draft, id), 'addTerminal');
    if (!added.ok) throw new Error(added.message);
    const listed = moduleOf(added.draft, id);
    expect(listed.feed).toBeUndefined();
    expect(listed.terminals!.filter((t) => t.side === 'top' && t.name !== 'T5').every((t) => t.role === 'input')).toBe(true);
    expect(listed.terminals!.filter((t) => t.side === 'bottom').every((t) => t.role === 'output')).toBe(true);
    expect(validateDraft(added.draft)).toEqual([]);
  });

  it('survives a terminal put on the drawing of the designer', () => {
    const { draft, id } = withModule({ feed: 'top', poles: 1 });
    const placed = addTerminalAt(draft, id, 0.5, 'top');
    if (!placed.ok) throw new Error(placed.message);
    expect(moduleOf(placed.draft, id).feed).toBeUndefined();
    expect(validateDraft(placed.draft)).toEqual([]);
  });
});

describe('the other edits of a device that names its input', () => {
  const fed = () => withModule({ feed: 'top', poles: 2, ratedCurrentA: 25 });

  it('a change of the number of poles keeps the side and stays valid', () => {
    const { draft, id } = fed();
    const changed = edit(state(draft, id), 'poles', '4');
    expect(moduleOf(changed, id).feed).toBe('top');
    expect(validateDraft(changed)).toEqual([]);
  });

  it('a change of the kind to a comb drops the side, which a comb cannot have', () => {
    const { draft, id } = fed();
    const comb = edit(state(draft, id), 'kind', 'comb');
    expect(moduleOf(comb, id).feed).toBeUndefined();
    expect(validateDraft(comb)).toEqual([]);
  });

  it('a duplicate has the same side, and a duplicate of a device with roles has the same roles', () => {
    const { draft, id } = fed();
    const copy = duplicateModule(draft, id)!;
    expect(moduleOf(copy.draft, copy.id).feed).toBe('top');
    const roles = withModule({ terminals: [{ name: 'L', conductor: 'L', side: 'top', role: 'input' }, { name: 'Lo', conductor: 'L', side: 'bottom', role: 'output' }] });
    const roleCopy = duplicateModule(roles.draft, roles.id)!;
    expect(moduleOf(roleCopy.draft, roleCopy.id).terminals!.map((t) => t.role)).toEqual(['input', 'output']);
    expect(validateDraft(roleCopy.draft)).toEqual([]);
  });

  it('variants keep the side, and a variant for a conductor turns it into roles on the listed terminals', () => {
    const { draft, id } = fed();
    const rated = makeVariants(draft, id, [16, 32]);
    if (!rated.ok) throw new Error(rated.message);
    expect(rated.draft.modules.filter((m) => m.feed === 'top')).toHaveLength(rated.draft.modules.length);
    expect(validateDraft(rated.draft)).toEqual([]);
    const wired = makeVariants(draft, id, [], [], ['L1']);
    if (!wired.ok) throw new Error(wired.message);
    const made = wired.draft.modules.find((m) => m.id !== id)!;
    expect(made.feed).toBeUndefined();
    expect(made.terminals!.filter((t) => t.side === 'top').every((t) => t.role === 'input')).toBe(true);
    expect(validateDraft(wired.draft)).toEqual([]);
  });

  it('one conductor on every terminal and a row of terminals both list the terminals without a leftover side', () => {
    const { draft, id } = fed();
    const all = setAllConductors(draft, id, 'L1');
    if (!all.ok) throw new Error(all.message);
    expect(moduleOf(all.draft, id).feed).toBeUndefined();
    expect(validateDraft(all.draft)).toEqual([]);
    const row = addRow(draft, id, { side: 'top', count: 2, conductor: 'PE', prefix: 'E', joined: false });
    if (!row.ok) throw new Error(row.message);
    expect(moduleOf(row.draft, id).feed).toBeUndefined();
    expect(moduleOf(row.draft, id).terminals!.filter((t) => t.side === 'top' && t.name === 'L').every((t) => t.role === 'input')).toBe(true);
    expect(validateDraft(row.draft)).toEqual([]);
  });

  it('a narrower width keeps the roles of the terminals that are moved', () => {
    const base = withModule({
      widthUnits: 6,
      terminals: [
        { name: 'L', conductor: 'L', side: 'top', unit: 5, role: 'input' },
        { name: 'Lo', conductor: 'L', side: 'bottom', unit: 5, role: 'output' },
      ],
    });
    const narrower: Library = { ...base.draft, modules: base.draft.modules.map((m) => ({ ...m, widthUnits: 2 })) };
    const fitted = fitTerminalsToWidth(narrower, base.id, 6);
    expect(moduleOf(fitted, base.id).terminals!.map((t) => t.role)).toEqual(['input', 'output']);
    expect(validateDraft(fitted)).toEqual([]);
  });

  it('removing every terminal of the input side leaves a valid list', () => {
    const { draft, id } = fed();
    let current = draft;
    for (let i = 0; i < 2; i++) {
      const removed = applyEditorAction(state(current, id), i === 0 ? 'addTerminal' : 'removeTerminal:0');
      if (!removed.ok) throw new Error(removed.message);
      current = removed.draft;
    }
    expect(validateDraft(current)).toEqual([]);
  });
});

describe('the arrow beside a terminal whose maker fixes the way it is fed', () => {
  const pinsOf = (patch: Partial<ModuleDef>) => {
    const { draft, id } = withModule(patch);
    const layout = designerLayout(moduleOf(draft, id));
    return { layout, markers: layout.pins.map((pin) => ({ pin, marker: roleMarker(pin, layout.pinRadius) })) };
  };
  /** The y of the tip and of the base of the arrow of a marker. */
  const tipAndBase = (points: string) => {
    const [tip, base] = points.split(' ').map((p) => Number(p.split(',')[1]));
    return { tip: tip!, base: base! };
  };

  it('points into the module on an input and out of it on an output', () => {
    const { markers } = pinsOf({ feed: 'top', poles: 1 });
    const top = markers.find((m) => m.pin.terminal.side === 'top')!;
    const bottom = markers.find((m) => m.pin.terminal.side === 'bottom')!;
    const input = tipAndBase(top.marker!.points);
    const output = tipAndBase(bottom.marker!.points);
    expect(input.tip).toBeGreaterThan(input.base);
    expect(output.tip).toBeGreaterThan(output.base);
    expect(top.marker!.points).not.toBe(bottom.marker!.points);
  });

  it('turns round with the input side', () => {
    const { markers } = pinsOf({ feed: 'bottom', poles: 1 });
    const top = markers.find((m) => m.pin.terminal.side === 'top')!;
    expect(tipAndBase(top.marker!.points).tip).toBeLessThan(tipAndBase(top.marker!.points).base);
  });

  it('stays out of the way of the pin: on the side of the edge of the module', () => {
    const { markers } = pinsOf({ feed: 'top', poles: 1 });
    const top = markers.find((m) => m.pin.terminal.side === 'top')!;
    expect(tipAndBase(top.marker!.points).tip).toBeLessThan(top.pin.y);
  });

  it('is not drawn for a terminal that works either way', () => {
    expect(pinsOf({ poles: 2 }).markers.every((m) => m.marker === null)).toBe(true);
  });
});
