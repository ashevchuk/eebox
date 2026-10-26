import { DEFAULT_CABLE_SETTINGS, cableSettingsToText, parseCableSettings, type CableSettings } from '../electrical/cables';
import type { KeyValueStore } from './autosave';

const KEY = 'eebox:cable-settings';

/** What is stored, or the built-in values; a stored value that does not parse is reported, not used. */
export function loadCableSettings(store: KeyValueStore): { settings: CableSettings; problem?: string } {
  let text: string | null;
  try {
    text = store.getItem(KEY);
  } catch (e) {
    return { settings: DEFAULT_CABLE_SETTINGS, problem: `cable settings unreadable: ${(e as Error).message}` };
  }
  if (text === null) return { settings: DEFAULT_CABLE_SETTINGS };
  const parsed = parseCableSettings(text);
  if (parsed.ok) return { settings: parsed.settings };
  const [first] = parsed.errors;
  return { settings: DEFAULT_CABLE_SETTINGS, problem: `stored cable settings ignored: ${first?.path ?? ''} ${first?.message ?? ''}`.trim() };
}

/** Returns false when the browser refuses the write. */
export function saveCableSettings(store: KeyValueStore, settings: CableSettings): boolean {
  try {
    store.setItem(KEY, cableSettingsToText(settings));
    return true;
  } catch {
    return false;
  }
}
