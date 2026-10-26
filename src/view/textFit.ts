export type Measure = (text: string) => number;

/** Shortens text from the end until it, with an ellipsis, fits the width. */
export function ellipsize(measure: Measure, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && measure(`${shortened}…`) > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened.trimEnd()}…`;
}

/**
 * Breaks text at spaces into at most `maxLines` lines no wider than `maxWidth`. A word that is
 * wider than a line is cut, and what does not fit in the last line ends in an ellipsis.
 */
export function wrapText(measure: Measure, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < words.length; i++) {
    const candidate = current === '' ? words[i]! : `${current} ${words[i]}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current === '') {
      current = ellipsize(measure, words[i]!, maxWidth);
      continue;
    }
    if (lines.length === maxLines - 1) return [...lines, ellipsize(measure, [current, ...words.slice(i)].join(' '), maxWidth)];
    lines.push(current);
    current = words[i]!;
    if (measure(current) > maxWidth) current = ellipsize(measure, current, maxWidth);
  }
  return current === '' ? lines : [...lines, current];
}
