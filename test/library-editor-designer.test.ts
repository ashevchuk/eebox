import { describe, expect, it } from 'vitest';
import libraryText from '../libraries/generic-iec.json?raw';
import type { Library } from '../src/library/types';
import { parseLibraryJson } from '../src/library/validate';
import { DESIGN_ACTION, applyEditorAction, describeEditor, type EditorState } from '../src/ui/libraryEditor';

const parsed = parseLibraryJson(libraryText);
if (!parsed.ok) throw new Error('bundled library must be valid');
const library: Library = parsed.library;

const on = (id: string): EditorState => ({ draft: library, target: { kind: 'module', id } });
const actionKeys = (state: EditorState) => describeEditor(state).actions.map((a) => a.key);

describe('opening the designer from the library editor', () => {
  it('is offered for a module with terminals and not for a comb, which has none', () => {
    expect(actionKeys(on('mcb-1p-c16'))).toContain(DESIGN_ACTION);
    expect(actionKeys(on('pen-split-12'))).toContain(DESIGN_ACTION);
    expect(actionKeys(on('comb-3ph-12'))).not.toContain(DESIGN_ACTION);
  });

  it('is labelled, and is a button of the window, not something the model does to the library', () => {
    const action = describeEditor(on('mcb-1p-c16')).actions.find((a) => a.key === DESIGN_ACTION);
    expect(action?.label).toBe('Open in designer');
    const result = applyEditorAction(on('mcb-1p-c16'), DESIGN_ACTION);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe('The designer is opened by the editor window.');
  });
});
