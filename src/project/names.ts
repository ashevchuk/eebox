const MAX_STEM_LENGTH = 40;

/** A safe file name stem from the panel title: letters and digits of any script, joined by dashes. */
export function fileStem(title: string | undefined, fallback: string): string {
  const stem = (title ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/-+$/g, '');
  return stem === '' ? fallback : stem;
}
