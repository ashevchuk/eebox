import { describe, expect, it } from 'vitest';
import partsCsv from '../examples/parts.csv?raw';
import { libraryFromCsv, parseCsv } from '../src/library/csvImport';
import { terminalsOf } from '../src/electrical/terminals';

const options = { id: 'parts', name: 'Parts' };
const load = (text: string) => {
  const result = libraryFromCsv(text, options);
  if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  return result.library;
};

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, line breaks inside a field and a byte order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('detects semicolons and tabs from the header', () => {
    expect(parseCsv('a;b\n1,5;2')).toEqual([['a', 'b'], ['1,5', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n,\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('libraryFromCsv', () => {
  it('reads the sample table: decimal commas, mm widths, prices and a distribution block', () => {
    const library = load(partsCsv);
    expect(library.modules.map((m) => m.id)).toEqual(['rel-22', 'mcb-1c16', 'db-1-6']);
    const [relay, breaker, block] = library.modules;
    expect(relay?.widthUnits).toBeCloseTo(22.5 / 17.5, 3);
    expect(relay).toMatchObject({ kind: 'relay', price: 4.9, currency: 'EUR', sku: 'REL-22' });
    expect(breaker).toMatchObject({ ratedCurrentA: 16, curve: 'C', breakingCapacityKA: 6, widthUnits: 1 });
    expect(block?.widthUnits).toBe(3);
    const terminals = terminalsOf(block!);
    expect(terminals.filter((t) => t.side === 'top')).toHaveLength(1);
    expect(terminals.filter((t) => t.side === 'bottom')).toHaveLength(6);
    expect(new Set(terminals.map((t) => t.net)).size).toBe(1);
  });

  it('needs only a name and a width, and accepts width in units', () => {
    const library = load('Name,Units\nThing,2');
    expect(library.modules[0]).toMatchObject({ name: 'Thing', widthUnits: 2, kind: 'other', poles: 1 });
  });

  it('makes ids unique', () => {
    const library = load('name,width_units\nA b,1\nA b,1');
    expect(library.modules.map((m) => m.id)).toEqual(['a-b', 'a-b-2']);
  });

  it('reports the row and the reason for each bad row', () => {
    const result = libraryFromCsv('name,width_mm,kind\nOk,17.5,breaker\n,17.5,breaker\nBad,x,breaker\nOdd,17.5,gizmo\nNoWidth,,breaker', options);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.path)).toEqual(['row 3', 'row 4', 'row 5', 'row 6']);
  });

  it('refuses a table without parts', () => {
    expect(libraryFromCsv('name,width_mm', options).ok).toBe(false);
  });

  it('reports columns it does not know', () => {
    const result = libraryFromCsv('name,width_units,colour\nA,1,red', options);
    expect(result.ok && result.skippedColumns).toEqual(['colour']);
  });

  it('turns library validation failures into row errors', () => {
    const result = libraryFromCsv('name,width_units,price\nA,1,-5', options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toContain('row 2');
  });
});
