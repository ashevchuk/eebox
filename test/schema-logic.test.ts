import { describe, expect, it } from 'vitest';
import schemaText from '../libraries/library.schema.json?raw';
import {
  LOGIC_CONTACT_SPEC,
  LOGIC_FLAG_SPEC,
  MAX_FLAG_LABEL_LENGTH,
  MAX_LOGIC_FLAGS,
  LOGIC_INPUT_SPEC,
  LOGIC_SPEC,
  MAX_INPUT_TERMINALS,
  MAX_LOGIC_CONTACTS,
  MAX_LOGIC_INPUTS,
  type FieldSpec,
} from '../src/library/validate';
import { MAX_EXPRESSION_LENGTH } from '../src/library/logicExpression';
import { addNode, emptySchematic } from '../src/schematic/model';
import { applyEdit, inspect } from '../src/ui/inspector';
import { genericModules } from '../src/library/genericSeries';
import { place, panelOf } from './fixtures';

type Schema = Record<string, any>;
const defs: Schema = JSON.parse(schemaText).definitions;
const sorted = (values: string[]) => [...values].sort();
const requiredOf = (spec: FieldSpec) => Object.entries(spec).filter(([, f]) => f.required).map(([k]) => k).sort();

describe('logic in the library schema', () => {
  for (const [name, definition, spec] of [
    ['logic', defs.logic, LOGIC_SPEC],
    ['logic input', defs.logicInput, LOGIC_INPUT_SPEC],
    ['logic contact', defs.logicContact, LOGIC_CONTACT_SPEC],
    ['logic flag', defs.logicFlag, LOGIC_FLAG_SPEC],
  ] as const) {
    it(`${name}: same fields, same required fields, no extras allowed`, () => {
      expect(sorted(Object.keys(definition.properties))).toEqual(sorted(Object.keys(spec)));
      expect(sorted(definition.required ?? [])).toEqual(requiredOf(spec));
      expect(definition.additionalProperties).toBe(false);
    });
  }

  it('has the same limits', () => {
    expect(defs.logic.properties.inputs.maxProperties).toBe(MAX_LOGIC_INPUTS);
    expect(defs.logic.properties.contacts.maxItems).toBe(MAX_LOGIC_CONTACTS);
    expect(defs.logic.properties.flags.maxProperties).toBe(MAX_LOGIC_FLAGS);
    expect(defs.logicFlag.properties.label.maxLength).toBe(MAX_FLAG_LABEL_LENGTH);
    expect(defs.logicInput.properties.terminals.maxItems).toBe(MAX_INPUT_TERMINALS);
    expect(defs.logicContact.properties.closedWhen.maxLength).toBe(MAX_EXPRESSION_LENGTH);
  });
});

describe('bundled devices with logic', () => {
  it('give every contactor, monitoring relay and transfer controller its logic', () => {
    const withLogic = genericModules().filter((m) => m.logic).map((m) => m.kind);
    expect(withLogic.filter((k) => k === 'contactor')).toHaveLength(4);
    expect(genericModules().find((m) => m.id === 'ats-controller-3pn')?.logic?.contacts).toHaveLength(3);
    expect(genericModules().find((m) => m.id === 'vrelay-1p')?.logic).toBeDefined();
  });
});

describe('inspecting a contactor', () => {
  it('offers auto as the position and shows the sensed coil once a source is on', () => {
    const contactor = genericModules().find((m) => m.id === 'contactor-3p-20-230')!;
    const resolve = () => contactor;
    const schematic = addNode(emptySchematic(), { kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L', 'N'] }).schematic;
    const context = {
      project: { panel: panelOf([place('p1', 'x', 0, 0)]), schematic },
      selection: { placementId: 'p1' },
      mode: 'panel' as const,
      resolve,
      snapshot: {},
      fromLibraries: resolve,
    };
    const fields = inspect(context).fields;
    const position = fields.find((f) => f.key === 'state');
    expect(position).toMatchObject({ value: 'auto', options: ['auto', 'closed', 'open'] });
    expect(fields.find((f) => f.key === 'input-coil')?.value).toBe('no voltage');
    expect(fields.find((f) => f.key === 'contacts')?.value).toBe('0 of 3 closed');
    expect(applyEdit(context, 'state', 'closed').ok).toBe(true);
  });
});
