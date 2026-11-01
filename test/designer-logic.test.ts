import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { validateLibrary } from '../src/library/validate';
import type { Library } from '../src/library/types';
import { addTerminalAt, dropBrokenLogic, makeBlock, moveTerminal } from '../src/ui/moduleDesigner';

const CONTACTOR = 'contactor-3p-20-230';
const bundled = JSON.parse(raw) as Library;
const draft: Library = { ...bundled, id: 'mine', modules: bundled.modules.filter((m) => m.id === CONTACTOR) };

const errorsOf = (library: Library) => {
  const result = validateLibrary(library);
  return result.ok ? [] : result.errors.map((e) => e.message);
};

describe('a module that has logic', () => {
  it('starts valid, with logic', () => {
    expect(draft.modules[0]!.logic).toBeDefined();
    expect(errorsOf(draft)).toEqual([]);
  });

  it('keeps its logic while every terminal it names is still there', () => {
    const added = addTerminalAt(draft, CONTACTOR, 1, 'top', 'L', 3);
    if (!added.ok) throw new Error(added.message);
    const result = dropBrokenLogic(added.draft, CONTACTOR);
    expect(result.dropped).toBe(false);
    expect(result.draft).toBe(added.draft);
  });

  it('loses its logic when a terminal block replaces the terminals, and the library validates again', () => {
    const block = makeBlock(draft, CONTACTOR, { top: 3, bottom: 6, conductor: 'L', joined: false }, 3);
    if (!block.ok) throw new Error(block.message);
    expect(errorsOf(block.draft).some((m) => /is not a terminal of this module/.test(m))).toBe(true);
    const result = dropBrokenLogic(block.draft, CONTACTOR);
    expect(result.dropped).toBe(true);
    expect(result.draft.modules[0]!.logic).toBeUndefined();
    expect(errorsOf(result.draft)).toEqual([]);
  });

  it('loses its logic when the terminals it names are all removed', () => {
    const none: Library = { ...draft, modules: draft.modules.map((m) => ({ ...m, terminals: [{ name: 'X', conductor: 'L' as const, side: 'top' as const, unit: 1 }] })) };
    const result = dropBrokenLogic(none, CONTACTOR);
    expect(result.dropped).toBe(true);
    expect(errorsOf(result.draft)).toEqual([]);
  });

  it('is left alone when moving a terminal does not change which ones exist', () => {
    const moved = moveTerminal(draft, CONTACTOR, 0, 1, 'top', 3);
    if (!moved.ok) throw new Error(moved.message);
    expect(dropBrokenLogic(moved.draft, CONTACTOR).dropped).toBe(false);
  });
});
