import { iconIdOf, iconProblem, type IconDef } from '../library/icons';
import type { KeyValueStore } from './autosave';

export const MY_ICONS_KEY = 'eebox:my-icons';
export const MAX_OWN_ICONS = 200;

/** The person's own icons from untrusted text: each is checked, and ids must not repeat. */
export function parseIconList(raw: unknown): { ok: true; icons: IconDef[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: 'must be a list' };
  if (raw.length > MAX_OWN_ICONS) return { ok: false, message: `at most ${MAX_OWN_ICONS} icons` };
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    const problem = iconProblem(entry);
    if (problem) return { ok: false, message: `[${i}] ${problem}` };
    const { id } = entry as IconDef;
    if (seen.has(id)) return { ok: false, message: `[${i}] id "${id}" is used twice` };
    seen.add(id);
  }
  return { ok: true, icons: raw as IconDef[] };
}

/** What is stored, or none; a stored list that does not read is reported, not used. */
export function loadOwnIcons(store: KeyValueStore): { icons: IconDef[]; problem?: string } {
  try {
    const text = store.getItem(MY_ICONS_KEY);
    if (text === null) return { icons: [] };
    const parsed = parseIconList(JSON.parse(text));
    return parsed.ok ? { icons: parsed.icons } : { icons: [], problem: `stored icons ignored: ${parsed.message}` };
  } catch (e) {
    return { icons: [], problem: `stored icons ignored: ${(e as Error).message}` };
  }
}

/** Returns false when the browser refuses the write. */
export function saveOwnIcons(store: KeyValueStore, icons: readonly IconDef[]): boolean {
  try {
    store.setItem(MY_ICONS_KEY, JSON.stringify(icons));
    return true;
  } catch {
    return false;
  }
}

/** An id for an imported file that no icon of the list has yet: the file name, numbered when taken. */
export function freeIconId(icons: readonly IconDef[], fileName: string): string {
  const base = iconIdOf(fileName);
  const taken = new Set(icons.map((i) => i.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 36)}-${n}`;
    if (!taken.has(id)) return id;
  }
}
