import { describe, expect, it } from 'vitest';
import { bomCells } from '../src/ui/printSheet';
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
