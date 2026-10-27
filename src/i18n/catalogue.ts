/** A translation, or the three forms of a phrase with a number `{n}` in it: one, few and many (1, 2-4, 5-20 and so on). */
export type Entry = string | readonly [one: string, few: string, many: string];
/** English phrases and what they are called in another language; a `{name}` in a phrase stands for any text. */
export type Dictionary = Record<string, Entry>;

/** Which of the three forms a number takes in Ukrainian. */
export function pluralForm(n: number): 0 | 1 | 2 {
  const [last, last2] = [Math.abs(n) % 10, Math.abs(n) % 100];
  if (last === 1 && last2 !== 11) return 0;
  if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return 1;
  return 2;
}

interface Pattern {
  regex: RegExp;
  names: string[];
  entry: Entry;
  /** How many letters the phrase fixes, so that the most specific phrase is tried first. */
  fixed: number;
}

/** How deep a phrase may stand inside a phrase; a pattern that is only a place would otherwise never end. */
const MAX_DEPTH = 3;
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The phrases of a dictionary, ready to be matched against text. */
export class Catalogue {
  private readonly exact = new Map<string, Entry>();
  private readonly patterns: Pattern[] = [];

  constructor(dictionary: Dictionary) {
    for (const [phrase, entry] of Object.entries(dictionary)) {
      const names = [...phrase.matchAll(PLACEHOLDER)].map((m) => m[1]!);
      if (names.length === 0) {
        this.exact.set(phrase, entry);
        continue;
      }
      let source = '';
      let last = 0;
      for (const m of phrase.matchAll(PLACEHOLDER)) {
        source += escape(phrase.slice(last, m.index)) + '([\\s\\S]+?)';
        last = m.index! + m[0].length;
      }
      source += escape(phrase.slice(last));
      this.patterns.push({ regex: new RegExp(`^${source}$`), names, entry, fixed: phrase.replace(PLACEHOLDER, '').length });
    }
    this.patterns.sort((a, b) => b.fixed - a.fixed);
  }

  private fill(entry: Entry, values: Record<string, string>): string {
    let text: string;
    if (typeof entry === 'string') text = entry;
    else {
      const n = Number(values.n);
      text = entry[Number.isFinite(n) ? pluralForm(n) : 2];
    }
    return text.replace(PLACEHOLDER, (_all, name: string) => values[name] ?? '');
  }

  private lookup(core: string, depth: number): string | undefined {
    const exact = this.exact.get(core);
    if (exact !== undefined) return this.fill(exact, {});
    for (const pattern of this.patterns) {
      const match = pattern.regex.exec(core);
      // What stood in a place may be a phrase itself, such as "3 wires" inside a sentence; only a number `{n}` is left as it is.
      if (match) return this.fill(pattern.entry, Object.fromEntries(pattern.names.map((name, i) => [name, name === 'n' ? match[i + 1]! : depth < MAX_DEPTH ? this.translateAt(match[i + 1]!, depth + 1) : match[i + 1]!])));
    }
    return undefined;
  }

  /** The text in this language; text that is not a phrase of the dictionary comes back as it was, line by line if need be. */
  translate(text: string): string {
    return this.translateAt(text, 0);
  }

  private translateAt(text: string, depth: number): string {
    const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
    if (core === '') return text;
    const whole = this.lookup(core, depth);
    if (whole !== undefined) return lead + whole + trail;
    // A sentence that ends a line of a longer text with a full stop that the phrase does not have.
    if (core.endsWith('.')) {
      const bare = this.lookup(core.slice(0, -1), depth);
      if (bare !== undefined && !bare.endsWith('.')) return `${lead}${bare}.${trail}`;
    }
    if (!core.includes('\n')) return text;
    return lead + core.split('\n').map((line) => (line.trim() === '' ? line : this.translateAt(line, depth))).join('\n') + trail;
  }
}
