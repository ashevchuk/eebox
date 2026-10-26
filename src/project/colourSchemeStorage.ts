import { BUILT_IN_SCHEMES, DEFAULT_COLOUR_CHOICE, COLOURS_FORMAT, parseColourScheme, type ColourChoice, type SchemeId } from '../view/colourScheme';
import type { KeyValueStore } from './autosave';

const KEY = 'eebox:colour-scheme';
const SCHEME_IDS: readonly SchemeId[] = [...BUILT_IN_SCHEMES.map((s) => s.id), 'custom'];

/** What is stored, or the default; a stored value that does not read is reported, not used. */
export function loadColourChoice(store: KeyValueStore): { choice: ColourChoice; problem?: string } {
  let text: string | null;
  try {
    text = store.getItem(KEY);
  } catch (e) {
    return { choice: DEFAULT_COLOUR_CHOICE, problem: `colours unreadable: ${(e as Error).message}` };
  }
  if (text === null) return { choice: DEFAULT_COLOUR_CHOICE };
  try {
    const raw = JSON.parse(text) as { scheme?: unknown; custom?: unknown };
    if (typeof raw.scheme !== 'string' || !SCHEME_IDS.includes(raw.scheme as SchemeId)) throw new Error('unknown scheme');
    const custom = parseColourScheme(JSON.stringify({ format: COLOURS_FORMAT, version: 1, colours: raw.custom }));
    if (!custom.ok) throw new Error(`${custom.errors[0]?.path ?? ''} ${custom.errors[0]?.message ?? ''}`.trim());
    return { choice: { scheme: raw.scheme as SchemeId, custom: custom.scheme } };
  } catch (e) {
    return { choice: DEFAULT_COLOUR_CHOICE, problem: `stored colours ignored: ${(e as Error).message}` };
  }
}

/** Returns false when the browser refuses the write. */
export function saveColourChoice(store: KeyValueStore, choice: ColourChoice): boolean {
  try {
    store.setItem(KEY, JSON.stringify({ scheme: choice.scheme, custom: choice.custom }));
    return true;
  } catch {
    return false;
  }
}
