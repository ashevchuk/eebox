import { describe, expect, it } from 'vitest';
import { bomCells, priceCells, totalsText } from '../src/ui/printSheet';
import { buildBom } from '../src/project/bom';
import { panelOf, place, resolve } from './fixtures';

const rowFor = (moduleId: string, label?: string) =>
  buildBom(panelOf([{ ...place('p1', moduleId, 0, 0), ...(label ? { label } : {}) }]), resolve)[0]!;

describe('bomCells', () => {
  it('describes a module with its rating, curve, residual current and breaking capacity', () => {
    expect(bomCells(rowFor('breaker16', 'Kitchen'))).toEqual([
      '1', 'MCB 1P C16', 'SKU-16', 'breaker', '1', '16 A C 30 mA 6 kA', '1 u', 'Kitchen',
    ]);
  });

  it('leaves out what the module does not state', () => {
    expect(bomCells(rowFor('mcb3'))).toEqual(['1', 'MCB 3P', '', 'breaker', '3', '', '3 u', '']);
  });

  it('names a module that is not in any library instead of hiding the row', () => {
    const [row] = buildBom(panelOf([place('p1', 'ghost', 0, 0)]), resolve);
    expect(bomCells(row!)).toEqual(['1', 'ghost (module not found)', '', '', '', '', '', '']);
  });
});

describe('prices on the print sheet', () => {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 1), place('p3', 'mcb3', 0, 2)]);
  const priced = (price?: number, currency?: string) => (ref: Parameters<typeof resolve>[0]) => {
    const def = resolve(ref);
    return def && ref.moduleId === 'breaker16' && price !== undefined ? { ...def, price, ...(currency ? { currency } : {}) } : def;
  };

  it('shows the price of one copy and of the line, with the currency, in cents', () => {
    const [row] = buildBom(panel, priced(2.5, 'EUR')).filter((r) => r.moduleId === 'breaker16');
    expect(priceCells(row!)).toEqual(['2.50 EUR', '5.00 EUR']);
  });

  it('leaves both cells empty for a module without a price', () => {
    const row = buildBom(panel, priced(2.5, 'EUR')).find((r) => r.moduleId === 'mcb3')!;
    expect(priceCells(row)).toEqual(['', '']);
  });

  it('writes a total per currency and says how many rows it leaves out', () => {
    expect(totalsText(buildBom(panel, priced(2.5, 'EUR')))).toEqual(['Total: 5.00 EUR', '1 row has no price and is not in the total.']);
  });

  it('writes no remark when every row has a price, and nothing when nothing has', () => {
    const all = (ref: Parameters<typeof resolve>[0]) => ({ ...resolve(ref)!, price: 1 });
    expect(totalsText(buildBom(panel, all))).toEqual(['Total: 3.00']);
    expect(totalsText(buildBom(panel, priced()))).toEqual([]);
  });
});
