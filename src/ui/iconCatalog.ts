import type { IconCategory } from '../library/genericIcons';
import { genericIcons, GENERIC_ICON_CATEGORIES } from '../library/genericIcons';
import { iconKey, OWN_ICON_CATEGORY, OWN_ICON_SOURCE, type IconDef } from '../library/icons';

export interface IconEntry {
  key: string;
  icon: IconDef;
}

export const OWN_ICONS_CATEGORY: IconCategory = { id: OWN_ICON_CATEGORY, name: 'My icons' };

/** The bundled icons in the order of their catalogue, then the person's own. */
export function iconEntries(own: readonly IconDef[]): IconEntry[] {
  return [...[...genericIcons()].map(([key, icon]) => ({ key, icon })), ...own.map((icon) => ({ key: iconKey(OWN_ICON_SOURCE, icon.id), icon }))];
}

export const iconCategories = (own: readonly IconDef[]): IconCategory[] => [...GENERIC_ICON_CATEGORIES, ...(own.length > 0 ? [OWN_ICONS_CATEGORY] : [])];

/**
 * The icons of a category ('' for all) whose name, in English or as `translate` gives it, or id
 * holds every word of the query, ignoring case.
 */
export function filterIcons(entries: readonly IconEntry[], query: string, category: string, translate: (text: string) => string = (s) => s): IconEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(({ icon }) => {
    if (category !== '' && icon.category !== category) return false;
    const haystack = `${icon.name} ${translate(icon.name)} ${icon.id}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
