import { parseTextVisibility, type TextVisibility } from '../view/textVisibility';
import type { KeyValueStore } from './autosave';

export const SCREEN_TEXT_KEY = 'eebox:texts-screen';
export const EXPORT_TEXT_KEY = 'eebox:texts-export';

export function loadTextVisibility(store: KeyValueStore, key: string): TextVisibility {
  try {
    return parseTextVisibility(store.getItem(key));
  } catch {
    return parseTextVisibility(null);
  }
}

export function saveTextVisibility(store: KeyValueStore, key: string, texts: TextVisibility): void {
  try {
    store.setItem(key, JSON.stringify(texts));
  } catch {
    // A preference that cannot be kept is only forgotten on the next start.
  }
}
