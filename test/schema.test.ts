import { describe, expect, it } from 'vitest';
import libraryText from '../libraries/generic-iec.json?raw';
import schemaText from '../libraries/library.schema.json?raw';
import { MAX_RAILS, MAX_RAIL_LENGTH_UNITS } from '../src/layout/limits';
import { CONDUCTORS, MODULE_KINDS, TERMINAL_SIDES, TRIP_CURVES } from '../src/library/types';
import {
  COMB_SPEC,
  ENCLOSURE_SPEC,
  ID_PATTERN,
  LIBRARY_SPEC,
  MAX_COMB_PATTERN,
  MAX_DESCRIPTION_LENGTH,
  MAX_TERMINALS_PER_MODULE,
  MAX_TERMINAL_GROUP,
  MAX_URL_LENGTH,
  MAX_VERSION_LENGTH,
  MODULE_SPEC,
  RESIZE_SPEC,
  TERMINAL_SPEC,
  parseLibraryJson,
  type FieldSpec,
} from '../src/library/validate';

/* The schema is written by hand for editors; these tests keep it from drifting away from the validator. */
type Schema = Record<string, any>;
const schema: Schema = JSON.parse(schemaText);
const defs: Schema = schema.definitions;

const requiredOf = (spec: FieldSpec) => Object.entries(spec).filter(([, f]) => f.required).map(([k]) => k).sort();
const sorted = (values: string[]) => [...values].sort();

function sameShape(name: string, definition: Schema, spec: FieldSpec) {
  it(`${name}: same fields, same required fields, no extras allowed`, () => {
    expect(sorted(Object.keys(definition.properties))).toEqual(sorted(Object.keys(spec)));
    expect(sorted(definition.required ?? [])).toEqual(requiredOf(spec));
    expect(definition.additionalProperties).toBe(false);
  });
}

describe('library schema matches the validator', () => {
  sameShape('library', schema, LIBRARY_SPEC);
  sameShape('module', defs.module, MODULE_SPEC);
  sameShape('terminal', defs.terminal, TERMINAL_SPEC);
  sameShape('comb', defs.comb, COMB_SPEC);
  sameShape('resizable', defs.resizable, RESIZE_SPEC);
  sameShape('enclosure', defs.enclosure, ENCLOSURE_SPEC);

  it('lists the same kinds, curves, conductors, sides and pole counts', () => {
    expect(defs.module.properties.kind.enum).toEqual([...MODULE_KINDS]);
    expect(defs.module.properties.curve.enum).toEqual([...TRIP_CURVES]);
    expect(defs.conductor.enum).toEqual([...CONDUCTORS]);
    expect(defs.side.enum).toEqual([...TERMINAL_SIDES]);
    expect(defs.module.properties.poles.enum).toEqual([1, 2, 3, 4]);
  });

  it('uses the same identifier pattern', () => {
    expect(defs.identifier.pattern).toBe(ID_PATTERN.source);
  });

  it('has the same limits', () => {
    expect(defs.module.properties.terminals.maxItems).toBe(MAX_TERMINALS_PER_MODULE);
    expect(defs.terminal.properties.count.maximum).toBe(MAX_TERMINAL_GROUP);
    expect(defs.comb.properties.pattern.maxItems).toBe(MAX_COMB_PATTERN);
    expect(defs.resizable.properties.minUnits.maximum).toBe(MAX_RAIL_LENGTH_UNITS);
    expect(defs.resizable.properties.maxUnits.maximum).toBe(MAX_RAIL_LENGTH_UNITS);
    expect(defs.enclosure.properties.railLengthsUnits.maxItems).toBe(MAX_RAILS);
    expect(defs.enclosure.properties.railLengthsUnits.items.maximum).toBe(MAX_RAIL_LENGTH_UNITS);
    expect(schema.properties.version.maxLength).toBe(MAX_VERSION_LENGTH);
    expect(schema.properties.url.maxLength).toBe(MAX_URL_LENGTH);
    expect(schema.properties.description.maxLength).toBe(MAX_DESCRIPTION_LENGTH);
  });

  it('states the one rule that ties fields together: a comb needs a spec and no terminals, others no spec', () => {
    expect(defs.module.allOf).toHaveLength(1);
    const [combRule] = defs.module.allOf;
    expect(combRule.then.required).toEqual(['comb']);
    expect(combRule.then.not.required).toEqual(['terminals']);
    expect(combRule.else.not.required).toEqual(['comb']);
  });

  it('is pointed at by the bundled library, which the validator accepts', () => {
    expect(JSON.parse(libraryText).$schema).toBe('./library.schema.json');
    expect(parseLibraryJson(libraryText).ok).toBe(true);
  });
});
