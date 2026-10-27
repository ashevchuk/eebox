import { Catalogue } from './catalogue';
import { translateDocument } from './dom';
import { LANGUAGE_NAMES, LANGUAGES, type Language } from './language';
import { UKRAINIAN } from './uk';

let active: Catalogue | null = null;

/** A phrase in the language of the page; the phrase itself in English, and for what has no translation. */
export function t(text: string): string {
  return active ? active.translate(text) : text;
}

/** Puts the page, and everything that is put into it later, into the language; English is what the code says, so nothing is done for it. */
export function startLanguage(language: Language): void {
  document.documentElement.lang = language;
  if (language === 'en') return;
  active = new Catalogue(UKRAINIAN);
  translateDocument(active);
}

export { LANGUAGE_NAMES, LANGUAGES, type Language };
