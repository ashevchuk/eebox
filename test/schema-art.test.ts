import { describe, expect, it } from 'vitest';
import schemaText from '../libraries/library.schema.json?raw';
import { ART_ANCHORS, ART_KINDS, MAX_ART_POINTS, MAX_ART_SHAPES, MAX_ART_TEXT_LENGTH, TEXT_ALIGNS } from '../src/library/art';
import { ART_SPECS } from '../src/library/validate';

/* The schema is written by hand for editors; these tests keep the art in it from drifting away from the validator. */
type Schema = Record<string, any>;
const schema: Schema = JSON.parse(schemaText);
const defs: Schema = schema.definitions;
const sorted = (values: string[]) => [...values].sort();

describe('library schema matches the validator for the art of a module', () => {
  it('has a definition for each kind, in the same order', () => {
    expect(defs.artShape.oneOf.map((s: Schema) => s.properties.kind.const)).toEqual([...ART_KINDS]);
  });

  for (const [index, kind] of ART_KINDS.entries()) {
    it(`${kind}: same fields, same required fields, no extras allowed`, () => {
      const definition = defs.artShape.oneOf[index];
      const spec = ART_SPECS[kind];
      expect(sorted(Object.keys(definition.properties))).toEqual(sorted(Object.keys(spec)));
      expect(sorted(definition.required)).toEqual(sorted(Object.entries(spec).filter(([, f]) => f.required).map(([k]) => k).concat(kind === 'line' ? ['stroke'] : kind === 'text' ? ['fill'] : [])));
      expect(definition.additionalProperties).toBe(false);
    });
  }

  it('lists the same anchors and alignments and the same limits', () => {
    const [line] = defs.artShape.oneOf;
    expect(line.properties.anchor.enum).toEqual([...ART_ANCHORS]);
    expect(defs.artShape.oneOf[4].properties.align.enum).toEqual([...TEXT_ALIGNS]);
    expect(defs.art.maxItems).toBe(MAX_ART_SHAPES);
    expect(defs.artShape.oneOf[3].properties.points.maxItems).toBe(MAX_ART_POINTS);
    expect(defs.artShape.oneOf[4].properties.text.maxLength).toBe(MAX_ART_TEXT_LENGTH);
  });

  it('is what a module refers to, and a tile needs a period in it', () => {
    expect(defs.module.properties.art).toEqual({ $ref: '#/definitions/art' });
    const [rule] = defs.artShape.allOf;
    expect(rule.then.required).toEqual(['period']);
    expect(rule.else.not.required).toEqual(['period']);
  });
});
