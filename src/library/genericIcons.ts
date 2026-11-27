import catalogue from '../../icons/generic/catalogue.json';
import { MAX_ART_SHAPES } from './art';
import { BUNDLED_ICON_SOURCE, iconFromSvg, iconKey, type IconDef } from './icons';

const sources = import.meta.glob('../../icons/generic/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface IconCategory {
  id: string;
  name: string;
}

export const GENERIC_ICON_CATEGORIES: readonly IconCategory[] = catalogue.categories;

let cache: Map<string, IconDef> | undefined;

/**
 * The bundled icons by key, read from their SVG sources the first time they are asked for; a test
 * holds every source to importing with no notes, so nothing is lost here.
 */
export function genericIcons(): Map<string, IconDef> {
  if (cache) return cache;
  cache = new Map();
  for (const entry of catalogue.icons) {
    const text = sources[`../../icons/generic/${entry.id}.svg`];
    if (text === undefined) continue;
    const result = iconFromSvg(text, entry.id, entry.name, entry.category, MAX_ART_SHAPES);
    if (result.ok) cache.set(iconKey(BUNDLED_ICON_SOURCE, entry.id), result.icon);
  }
  return cache;
}
