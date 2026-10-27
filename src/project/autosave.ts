import { parseProjectJson, type ProjectFile, type ProjectParseResult } from './file';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const AUTOSAVE_KEY = 'eebox:autosave';
const KEY = AUTOSAVE_KEY;

export const serializeAutosave = (file: ProjectFile): string => JSON.stringify(file);

/** Returns false when the browser refuses the write (quota, private mode). */
export function saveAutosave(store: KeyValueStore, file: ProjectFile): boolean {
  try {
    store.setItem(KEY, serializeAutosave(file));
    return true;
  } catch {
    return false;
  }
}

/** `null` means nothing was stored; a stored but unreadable value is reported, not hidden. */
export function loadAutosave(store: KeyValueStore): ProjectParseResult | null {
  let text: string | null;
  try {
    text = store.getItem(KEY);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `autosave unreadable: ${(e as Error).message}` }] };
  }
  return text === null ? null : parseProjectJson(text);
}
