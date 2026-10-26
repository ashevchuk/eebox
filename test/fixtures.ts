import { createPanel } from '../src/layout/panel';
import type { CombPlacement, ModuleRef, Panel, Placement } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';

export const defs: Record<string, ModuleDef> = {
  mcb1: { id: 'mcb1', kind: 'breaker', name: 'MCB 1P', widthUnits: 1, poles: 1 },
  breaker16: {
    id: 'breaker16',
    kind: 'breaker',
    name: 'MCB 1P C16',
    widthUnits: 1,
    poles: 1,
    ratedCurrentA: 16,
    curve: 'C',
    breakingCapacityKA: 6,
    residualCurrentMa: 30,
    sku: 'SKU-16',
  },
  mcb3: { id: 'mcb3', kind: 'breaker', name: 'MCB 3P', widthUnits: 3, poles: 3 },
  relay: {
    id: 'relay',
    kind: 'relay',
    name: 'Voltage relay',
    widthUnits: 1,
    poles: 2,
    resizable: { minUnits: 1, maxUnits: 4 },
    terminals: [
      { name: 'L', conductor: 'L', side: 'top' },
      { name: 'N', conductor: 'N', side: 'top' },
      { name: '14', conductor: 'C', side: 'bottom' },
    ],
  },
  rcd4: { id: 'rcd4', kind: 'rcd', name: 'RCD 4P', widthUnits: 4, poles: 4 },
  rcbo: { id: 'rcbo', kind: 'rcbo', name: 'RCBO 1P+N', widthUnits: 2, poles: 2 },
  contactor: {
    id: 'contactor',
    kind: 'contactor',
    name: 'Contactor',
    widthUnits: 3,
    poles: 3,
    terminals: [
      { name: 'L1', conductor: 'L1', side: 'top', unit: 0 },
      { name: 'L2', conductor: 'L2', side: 'top', unit: 1 },
      { name: 'L3', conductor: 'L3', side: 'top', unit: 2 },
      { name: 'A1', conductor: 'L', side: 'top', unit: 0 },
      { name: 'T1', conductor: 'L1', side: 'bottom', unit: 0 },
    ],
  },
  nbar: {
    id: 'nbar',
    kind: 'busbar',
    name: 'N bar',
    widthUnits: 3,
    poles: 1,
    resizable: { minUnits: 2, maxUnits: 12 },
    terminals: [
      { name: 'N', conductor: 'N', side: 'top', net: 'N', count: 3 },
      { name: 'Nb', conductor: 'N', side: 'bottom', net: 'N', count: 3 },
    ],
  },
  comb3: { id: 'comb3', kind: 'comb', name: 'Comb 3ph', widthUnits: 6, poles: 3, comb: { pattern: ['L1', 'L2', 'L3'], side: 'top' } },
  comb1: {
    id: 'comb1',
    kind: 'comb',
    name: 'Comb 1ph',
    widthUnits: 6,
    poles: 1,
    comb: { pattern: ['L'], side: 'top' },
    resizable: { minUnits: 2, maxUnits: 12 },
  },
  fixedbar: {
    id: 'fixedbar',
    kind: 'busbar',
    name: 'Fixed bar',
    widthUnits: 3,
    poles: 1,
    terminals: [{ name: 'PE', conductor: 'PE', side: 'top', net: 'PE', count: 3 }],
  },
  combLN: { id: 'combLN', kind: 'comb', name: 'Comb L+N', widthUnits: 4, poles: 2, comb: { pattern: ['L', 'N'], side: 'top' } },
  combBottom: { id: 'combBottom', kind: 'comb', name: 'Comb bottom', widthUnits: 6, poles: 3, comb: { pattern: ['L1', 'L2', 'L3'], side: 'bottom' } },
};

export const ref = (moduleId: string): ModuleRef => ({ libraryId: 'lib', moduleId });
export const resolve = (r: ModuleRef): ModuleDef | undefined => (r.libraryId === 'lib' ? defs[r.moduleId] : undefined);

export const widthOf = (item: { module: ModuleRef; widthUnits?: number }): number | undefined =>
  item.widthUnits ?? resolve(item.module)?.widthUnits;

export const resizeOf = (m: ModuleRef) => {
  const def = resolve(m);
  return def?.resizable ? { ...def.resizable, baseUnits: def.widthUnits } : undefined;
};

export const place = (id: string, moduleId: string, rail: number, slot: number): Placement => ({
  id,
  module: ref(moduleId),
  rail,
  slot,
});

export const combAt = (id: string, moduleId: string, rail: number, slot: number): CombPlacement => ({
  id,
  module: ref(moduleId),
  rail,
  slot,
});

export function panelOf(placements: Placement[], combs: CombPlacement[] = [], rails = [24, 24]): Panel {
  return { ...createPanel(rails), placements, combs };
}
