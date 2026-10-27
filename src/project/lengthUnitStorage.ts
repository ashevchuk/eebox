import type { KeyValueStore } from './autosave';

export type LengthUnit = 'units' | 'mm';
export const LENGTH_UNITS: readonly LengthUnit[] = ['units', 'mm'];

const KEY = 'eebox:length-unit';

export function loadLengthUnit(store: KeyValueStore): LengthUnit {
  try {
    const stored = store.getItem(KEY);
    return LENGTH_UNITS.find((unit) => unit === stored) ?? 'units';
  } catch {
    return 'units';
  }
}

export function saveLengthUnit(store: KeyValueStore, unit: LengthUnit): void {
  try {
    store.setItem(KEY, unit);
  } catch {
    // A preference that cannot be kept is only forgotten on the next start.
  }
}
