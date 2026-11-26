import { isStoredLabel } from '../layout/labels';
import type { ArtShape } from './art';
import { importSvg } from './svgImport';
import { validateArt, type ValidationError } from './validate';

/** A picture for the marking strip: shapes in a box of `widthMm` by `heightMm`, drawn scaled to fit a cell. */
export interface IconDef {
  id: string;
  name: string;
  category: string;
  widthMm: number;
  heightMm: number;
  art: ArtShape[];
}

/** Bundled icons and the person's own ones; a key is `<source>/<id>`. */
export const BUNDLED_ICON_SOURCE = 'generic';
export const OWN_ICON_SOURCE = 'my';
export const OWN_ICON_CATEGORY = 'my';
/** Stored instead of a key when a module is to have no icon although its load has one. */
export const NO_ICON = 'none';

/** Every icon is imported at this width; its height follows its proportions. */
export const ICON_WIDTH_MM = 24;
const MAX_ICON_SIZE_MM = 1000;
export const MAX_ICON_ID_LENGTH = 40;
const ICON_ID = /^[a-z0-9][a-z0-9-]*$/;
const ICON_KEY = new RegExp(`^(${BUNDLED_ICON_SOURCE}|${OWN_ICON_SOURCE})/[a-z0-9][a-z0-9-]{0,${MAX_ICON_ID_LENGTH - 1}}$`);

export const iconKey = (source: string, id: string): string => `${source}/${id}`;
export const isIconKey = (value: unknown): value is string => typeof value === 'string' && ICON_KEY.test(value);
/** What a marking may store as its icon: a key, or `none`. */
export const isIconChoice = (value: unknown): value is string => value === NO_ICON || isIconKey(value);

export function iconProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object';
  const icon = value as Record<string, unknown>;
  const known = ['id', 'name', 'category', 'widthMm', 'heightMm', 'art'];
  const unknown = Object.keys(icon).find((k) => !known.includes(k));
  if (unknown) return `has an unknown field "${unknown}"`;
  if (typeof icon.id !== 'string' || icon.id.length > MAX_ICON_ID_LENGTH || !ICON_ID.test(icon.id)) return 'id must be lower-case letters, digits and hyphens';
  if (!isStoredLabel(icon.name)) return 'name must be a label of 1 to 60 characters';
  if (typeof icon.category !== 'string' || !ICON_ID.test(icon.category)) return 'category must be lower-case letters, digits and hyphens';
  for (const side of ['widthMm', 'heightMm'] as const) {
    const size = icon[side];
    if (typeof size !== 'number' || !(size > 0) || size > MAX_ICON_SIZE_MM) return `${side} must be above 0 and at most ${MAX_ICON_SIZE_MM}`;
  }
  if (!Array.isArray(icon.art)) return 'art must be a list of shapes';
  const errors: ValidationError[] = [];
  validateArt(icon.art, 'art', errors);
  return errors.length > 0 ? `${errors[0]!.path} ${errors[0]!.message}` : null;
}

export const isIconDef = (value: unknown): value is IconDef => iconProblem(value) === null;

/** A file name turned into an id: lower case, other characters as hyphens. */
export function iconIdOf(fileName: string): string {
  const stem = fileName.replace(/\.svg$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (stem === '' ? 'icon' : stem).slice(0, MAX_ICON_ID_LENGTH).replace(/-+$/, '');
}

export type IconImport = { ok: true; icon: IconDef; notes: string[] } | { ok: false; message: string };

/** An SVG as an icon; what cannot be drawn is left out and said in the notes, as for a module face. */
export function iconFromSvg(text: string, id: string, name: string, category: string, room: number): IconImport {
  const result = importSvg(text, { widthMm: ICON_WIDTH_MM, leftMm: 0, topMm: 0, anchor: 'left', room });
  if (!result.ok) return result;
  return { ok: true, icon: { id, name, category, widthMm: ICON_WIDTH_MM, heightMm: result.heightMm, art: result.shapes }, notes: result.notes };
}
