import type { KeyValueStore } from '../project/autosave';

export const LANGUAGES = ['en', 'uk'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', uk: 'Українська' };

const KEY = 'eebox:language';

/** What was chosen, else what the browser asks for; English when it is neither of ours. */
export function loadLanguage(store: KeyValueStore | null, browserLanguages: readonly string[]): Language {
  try {
    const stored = store?.getItem(KEY);
    const chosen = LANGUAGES.find((language) => language === stored);
    if (chosen) return chosen;
  } catch {
    // Fall through to what the browser asks for.
  }
  const asked = browserLanguages.map((l) => l.toLowerCase().split('-')[0]);
  for (const language of asked) {
    const known = LANGUAGES.find((candidate) => candidate === language);
    if (known) return known;
  }
  return 'en';
}

export function saveLanguage(store: KeyValueStore, language: Language): void {
  try {
    store.setItem(KEY, language);
  } catch {
    // A choice that cannot be kept is only forgotten on the next start.
  }
}
