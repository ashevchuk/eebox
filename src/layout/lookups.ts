import type { ModuleRef, ResizeOf, WidthOf } from './placement';
import type { CombLookup } from './combs';
import type { ModuleDef } from '../library/types';

/** The questions the layout model asks about modules, answered from a module resolver. */
export function lookupsOf(resolve: (ref: ModuleRef) => ModuleDef | undefined): {
  widthOf: WidthOf;
  resizeOf: ResizeOf;
  combLookup: CombLookup;
} {
  const widthOf: WidthOf = (item) => item.widthUnits ?? resolve(item.module)?.widthUnits;
  const resizeOf: ResizeOf = (ref) => {
    const def = resolve(ref);
    return def?.resizable ? { ...def.resizable, baseUnits: def.widthUnits } : undefined;
  };
  return { widthOf, resizeOf, combLookup: { widthOf, sideOf: (ref) => resolve(ref)?.comb?.side } };
}
