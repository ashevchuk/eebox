import type { KeyValueStore } from './autosave';

/** A yes or no kept in the browser; `fallback` when nothing, or something else, is stored. */
export function loadFlag(store: KeyValueStore, key: string, fallback: boolean): boolean {
  try {
    const stored = store.getItem(key);
    return stored === 'yes' ? true : stored === 'no' ? false : fallback;
  } catch {
    return fallback;
  }
}

export function saveFlag(store: KeyValueStore, key: string, value: boolean): void {
  try {
    store.setItem(key, value ? 'yes' : 'no');
  } catch {
    // A preference that cannot be kept is only forgotten on the next start.
  }
}
