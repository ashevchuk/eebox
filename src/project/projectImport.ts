import { canonicalJson } from './canonical';
import { fileStem } from './names';
import { parseProjectJson } from './file';
import { newProjectId, type StoredProject } from './projectStore';

export type FileKind = 'project' | 'workspace' | 'library' | 'unknown';

const MAX_SNIFF_CHARS = 64_000_000;

/** What a JSON file is, from its `format` field; anything that is not an object with one is `unknown`. */
export function sniffFile(text: string): FileKind {
  if (text.length > MAX_SNIFF_CHARS) return 'unknown';
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'unknown';
    const format = (raw as { format?: unknown }).format;
    if (format === 'eebox-project') return 'project';
    if (format === 'eebox-workspace') return 'workspace';
    return 'schemaVersion' in raw ? 'library' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The name a project is saved under: the title of the drawing, with the extension that marks an eebox project. */
export const projectFileName = (title: string | undefined): string => `${fileStem(title, 'panel')}.eebox.json`;

export interface ImportedFile {
  name: string;
  text: string;
}

export type ImportOutcome =
  | { name: string; outcome: 'added'; title: string; warnings: string[] }
  | { name: string; outcome: 'unchanged'; title: string }
  | { name: string; outcome: 'refused'; message: string };

export interface ProjectImportPlan {
  put: StoredProject[];
  results: ImportOutcome[];
}

/**
 * Files to be kept in the list of projects, each checked as a project file of its own. One whose content is
 * already stored is left; the others get an id that nothing stored has. A file that is not a project says what it is.
 */
export function planProjectFiles(existing: readonly StoredProject[], files: readonly ImportedFile[], now: number): ProjectImportPlan {
  const known = [...existing];
  const put: StoredProject[] = [];
  const results: ImportOutcome[] = [];
  for (const { name, text } of files) {
    const kind = sniffFile(text);
    if (kind === 'workspace') {
      results.push({ name, outcome: 'refused', message: 'this is a backup of everything; restore it with File > Restore from backup.' });
      continue;
    }
    if (kind === 'library') {
      results.push({ name, outcome: 'refused', message: 'this is a module library; import it from the library panel.' });
      continue;
    }
    const parsed = parseProjectJson(text);
    if (!parsed.ok) {
      const [first] = parsed.errors;
      results.push({ name, outcome: 'refused', message: `${first?.path ? `${first.path}: ` : ''}${first?.message ?? 'not an eebox project'}${parsed.errors.length > 1 ? ` (and ${parsed.errors.length - 1} more)` : ''}` });
      continue;
    }
    const title = parsed.file.project.panel.title ?? '';
    const content = canonicalJson(parsed.file);
    if (known.some((p) => !p.snapshot && canonicalJson(p.file) === content)) {
      results.push({ name, outcome: 'unchanged', title });
      continue;
    }
    const stored: StoredProject = { id: newProjectId(known), title, savedAt: now, file: parsed.file };
    known.push(stored);
    put.push(stored);
    results.push({ name, outcome: 'added', title, warnings: parsed.warnings });
  }
  return { put, results };
}

/** One line for the status: what became of each file. */
export function describeImport(results: readonly ImportOutcome[]): string {
  return results
    .map((r) =>
      r.outcome === 'added'
        ? `${r.name}: added "${r.title || 'Untitled panel'}"${r.warnings.length > 0 ? ` with ${r.warnings.length} problem${r.warnings.length === 1 ? '' : 's'}, see Check after opening it` : ''}.`
        : r.outcome === 'unchanged'
          ? `${r.name}: "${r.title || 'Untitled panel'}" is already in the list.`
          : `${r.name}: ${r.message}`,
    )
    .join('\n');
}
