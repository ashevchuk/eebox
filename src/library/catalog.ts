import { MODULE_KINDS, type ModuleDef, type ModuleKind } from './types';

export const KIND_LABELS: Record<ModuleKind, string> = {
  breaker: 'Circuit breakers',
  rcd: 'RCDs',
  rcbo: 'RCBOs',
  contactor: 'Contactors',
  spd: 'Surge protectors',
  meter: 'Meters',
  psu: 'Power supplies',
  terminal: 'Terminals',
  busbar: 'Bars',
  comb: 'Combs',
  switch: 'Switches',
  relay: 'Relays',
  other: 'Other',
};

export interface KindGroup {
  kind: ModuleKind;
  modules: ModuleDef[];
}

/** Everything a person might type to find a module: name, id, part number, kind, ratings. */
function haystackOf(def: ModuleDef): string {
  const parts: Array<string | number | undefined> = [
    def.name,
    def.id,
    def.sku,
    def.kind,
    KIND_LABELS[def.kind],
    `${def.poles}p`,
    def.curve,
    def.ratedCurrentA === undefined ? undefined : `${def.ratedCurrentA}a`,
    def.residualCurrentMa === undefined ? undefined : `${def.residualCurrentMa}ma`,
    def.breakingCapacityKA === undefined ? undefined : `${def.breakingCapacityKA}ka`,
  ];
  return parts.filter((p) => p !== undefined).join(' ').toLowerCase();
}

/** Every word of the query must occur somewhere in the module, in any order; a blank query matches all. */
export function matchesQuery(def: ModuleDef, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = haystackOf(def);
  return words.every((word) => haystack.includes(word));
}

/** Groups by kind in a fixed order, keeping the order the library gives inside each group. */
export function groupByKind(modules: ModuleDef[]): KindGroup[] {
  return MODULE_KINDS.map((kind) => ({ kind, modules: modules.filter((m) => m.kind === kind) })).filter(
    (group) => group.modules.length > 0,
  );
}
