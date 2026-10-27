import { describe, expect, it } from 'vitest';
import schemaText from '../libraries/library.schema.json?raw';
import type { Library, ModuleDef } from '../src/library/types';
import { MAX_SHORT_NAME_LENGTH, MODULE_SPEC, validateLibrary } from '../src/library/validate';
import { Camera } from '../src/view/Camera';
import { render } from '../src/view/render';
import { SvgContext } from '../src/view/svgContext';
import { applyEditorEdit, describeEditor } from '../src/ui/libraryEditor';
import { railPreviewScene } from '../src/ui/moduleDesigner';

const module = (shortName?: string): ModuleDef => ({ id: 'm', kind: 'breaker', name: 'MCB 1P B6 (copy)', widthUnits: 2, poles: 1, ...(shortName !== undefined ? { shortName } : {}) });
const library = (m: ModuleDef): Library => ({ schemaVersion: 1, id: 'lib', name: 'Lib', modules: [m], enclosures: [] });
const problems = (m: ModuleDef) => {
  const result = validateLibrary(library(m));
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
};

describe('the short name of a module', () => {
  it('is a short line without spaces at its ends', () => {
    expect(problems(module('QF'))).toEqual([]);
    expect(problems(module('x'.repeat(MAX_SHORT_NAME_LENGTH)))).toEqual([]);
    expect(problems(module('x'.repeat(MAX_SHORT_NAME_LENGTH + 1)))[0]).toMatch(/modules\[0\]\.shortName: must be 1 to 16 characters/);
    expect(problems(module(' QF'))[0]).toMatch(/shortName/);
    expect(problems(module(''))[0]).toMatch(/shortName/);
    expect(problems(module('a\nb'))[0]).toMatch(/shortName/);
  });

  it('is in the schema with the same limit', () => {
    const schema = JSON.parse(schemaText) as { definitions: { module: { properties: Record<string, { maxLength?: number }> } } };
    expect(Object.keys(MODULE_SPEC)).toContain('shortName');
    expect(schema.definitions.module.properties.shortName?.maxLength).toBe(MAX_SHORT_NAME_LENGTH);
  });

  it('is a field of the library editor, set by typing and cleared by typing nothing', () => {
    const state = { draft: library(module()), target: { kind: 'module', id: 'm' } } as const;
    const field = describeEditor(state).fields.find((f) => f.key === 'shortName');
    expect(field).toMatchObject({ label: 'Short name', value: '' });
    const set = applyEditorEdit(state, 'shortName', '  QF ');
    expect(set.ok && set.draft.modules[0]!.shortName).toBe('QF');
    const cleared = set.ok && applyEditorEdit({ ...state, draft: set.draft }, 'shortName', '');
    expect(cleared && cleared.ok && 'shortName' in cleared.draft.modules[0]!).toBe(false);
  });
});

describe('the face of a module with a short name', () => {
  const drawn = (def: ModuleDef): string => {
    const { panel, resolve } = railPreviewScene(def, def.widthUnits);
    const svg = new SvgContext(600, 300, (text) => text.length * 5);
    const camera = new Camera();
    camera.fit({ minX: 0, minY: 0, maxX: 600, maxY: 300 }, 600, 300, 0);
    render(svg as unknown as CanvasRenderingContext2D, camera, { panel, resolve, selectedPlacementId: null, selectedCombId: null, selectedRail: null, moving: null, ghost: null }, 600, 300, 1);
    return svg.toSvg();
  };

  it('shows it in place of the name', () => {
    const out = drawn(module('QF'));
    expect(out).toContain('>QF</text>');
    expect(out).not.toContain('MCB 1P B6');
  });

  it('shows the name when there is none', () => {
    const out = drawn(module());
    expect(out).toContain('>MCB');
    expect(out).not.toContain('>QF<');
  });
});
