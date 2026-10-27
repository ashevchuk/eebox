import { MAX_SNIPPETS, type Snippet } from '../layout/snippets';
import { normalizeLabel } from '../layout/labels';
import type { ValidationError } from '../library/validate';
import type { KeyValueStore } from './autosave';
import { parseProjectJson } from './file';

const KEY = 'eebox:snippets';
const ID = /^[A-Za-z0-9_.-]{1,80}$/;

export type SnippetListResult = { ok: true; snippets: Snippet[] } | { ok: false; errors: ValidationError[] };

/** Reads a list of snippets from untrusted data: each is checked as a project file of its own. */
export function parseSnippetList(raw: unknown, base = 'snippets'): SnippetListResult {
  if (!Array.isArray(raw)) return { ok: false, errors: [{ path: base, message: 'must be a list' }] };
  if (raw.length > MAX_SNIPPETS) return { ok: false, errors: [{ path: base, message: `at most ${MAX_SNIPPETS}` }] };
  const errors: ValidationError[] = [];
  const snippets: Snippet[] = [];
  raw.forEach((entry: unknown, i) => {
    const path = `${base}[${i}]`;
    const fail = (field: string, message: string) => errors.push({ path: `${path}.${field}`, message });
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return errors.push({ path, message: 'must be an object' });
    const item = entry as Record<string, unknown>;
    for (const key of Object.keys(item)) if (!['id', 'name', 'savedAt', 'file'].includes(key)) fail(key, 'unknown field');
    if (typeof item.id !== 'string' || !ID.test(item.id)) return fail('id', 'must be 1-80 letters, digits, dots, dashes or underscores');
    const name = typeof item.name === 'string' ? normalizeLabel(item.name) : null;
    if (!name?.ok || name.label === undefined) return fail('name', 'must be a label of 1 to 60 characters');
    if (typeof item.savedAt !== 'number' || !Number.isFinite(item.savedAt)) return fail('savedAt', 'must be a number');
    const parsed = parseProjectJson(JSON.stringify(item.file));
    if (!parsed.ok) return parsed.errors.forEach((e) => fail(`file${e.path ? `.${e.path}` : ''}`, e.message));
    snippets.push({ id: item.id, name: name.label, savedAt: item.savedAt, file: parsed.file });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, snippets };
}

/** What is stored, or none; a stored list that does not read is reported, not used. */
export function loadSnippets(store: KeyValueStore): { snippets: Snippet[]; problem?: string } {
  let text: string | null;
  try {
    text = store.getItem(KEY);
  } catch (e) {
    return { snippets: [], problem: `snippets unreadable: ${(e as Error).message}` };
  }
  if (text === null) return { snippets: [] };
  try {
    const parsed = parseSnippetList(JSON.parse(text));
    if (parsed.ok) return { snippets: parsed.snippets };
    const [first] = parsed.errors;
    return { snippets: [], problem: `stored snippets ignored: ${first?.path ?? ''} ${first?.message ?? ''}`.trim() };
  } catch (e) {
    return { snippets: [], problem: `stored snippets ignored: ${(e as Error).message}` };
  }
}

/** Returns false when the browser refuses the write. */
export function saveSnippets(store: KeyValueStore, snippets: readonly Snippet[]): boolean {
  try {
    store.setItem(KEY, JSON.stringify(snippets));
    return true;
  } catch {
    return false;
  }
}

export interface SnippetImportPlan {
  put: Snippet[];
  added: number;
  unchanged: number;
  skipped: number;
}

/** Like projects: the same snippet is left, one whose id is taken by another gets a new id, and the limit holds. */
export function planSnippetImport(existing: readonly Snippet[], incoming: readonly Snippet[]): SnippetImportPlan {
  const known = [...existing];
  const put: Snippet[] = [];
  let unchanged = 0;
  let skipped = 0;
  for (const snippet of incoming) {
    const same = known.find((s) => s.id === snippet.id);
    if (same && JSON.stringify(same.file) === JSON.stringify(snippet.file) && same.name === snippet.name) {
      unchanged++;
      continue;
    }
    if (known.length >= MAX_SNIPPETS) {
      skipped++;
      continue;
    }
    let stored = snippet;
    if (same) {
      let n = 1;
      while (known.some((s) => s.id === `snippet-${n}`)) n++;
      stored = { ...snippet, id: `snippet-${n}` };
    }
    known.push(stored);
    put.push(stored);
  }
  return { put, added: put.length, unchanged, skipped };
}
