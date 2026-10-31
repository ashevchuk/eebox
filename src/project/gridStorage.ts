import type { KeyValueStore } from './autosave';

/** The grids a device on the plate may be drawn to, in mm; 0 is none. */
export const GRID_SIZES_MM: readonly number[] = [0, 5, 10, 25];

const KEY = 'eebox:grid';

export function loadGrid(store: KeyValueStore): number {
  try {
    const stored = Number(store.getItem(KEY));
    return GRID_SIZES_MM.find((size) => size === stored) ?? 0;
  } catch {
    return 0;
  }
}

export function saveGrid(store: KeyValueStore, sizeMm: number): void {
  try {
    store.setItem(KEY, String(sizeMm));
  } catch {
    // A preference that cannot be kept is only forgotten on the next start.
  }
}
