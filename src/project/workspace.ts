import type { Snippet } from '../layout/snippets';
import type { Library } from '../library/types';
import { validateLibrary, type ValidationError } from '../library/validate';
import { parseProjectJson, type ProjectFile } from './file';
import type { StoredProject } from './projectStore';
import { parseSnippetList } from './snippetStorage';

export const WORKSPACE_FORMAT = 'eebox-workspace';
export const WORKSPACE_VERSION = 1;
export const MAX_WORKSPACE_CHARS = 64_000_000;
const MAX_PROJECTS = 500;
const MAX_LIBRARIES = 100;
const MAX_SETTING_CHARS = 500_000;
const ID = /^[A-Za-z0-9_.-]{1,80}$/;

/** The browser settings a backup carries; anything else in a file is refused, not written into storage. */
export const SETTING_KEYS = [
  'eebox:cable-settings',
  'eebox:colour-scheme',
  'eebox:texts-screen',
  'eebox:texts-export',
  'eebox:length-unit',
  'eebox:minimap',
  'eebox:tour-done',
  'eebox:width-sidebar',
  'eebox:width-inspector',
] as const;

/** Everything a user has made in this browser, in one file. */
export interface WorkspaceFile {
  format: typeof WORKSPACE_FORMAT;
  version: typeof WORKSPACE_VERSION;
  savedAt: number;
  /** The project on the screen when the backup was made. */
  current: ProjectFile | null;
  projects: StoredProject[];
  /** The libraries of the user; the bundled one comes with the application. */
  libraries: Library[];
  snippets: Snippet[];
  settings: Record<string, string>;
}

export type WorkspaceParseResult =
  | { ok: true; workspace: WorkspaceFile; warnings: string[] }
  | { ok: false; errors: ValidationError[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function buildWorkspace(parts: Omit<WorkspaceFile, 'format' | 'version'>): WorkspaceFile {
  return { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, ...parts };
}

export function workspaceToText(workspace: WorkspaceFile): string {
  return JSON.stringify(workspace, null, 2);
}

/** Reads a backup; every project, library and setting in it is checked as if it came on its own. */
export function parseWorkspace(text: string): WorkspaceParseResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });
  if (text.length > MAX_WORKSPACE_CHARS) return { ok: false, errors: [{ path: '', message: 'the backup is larger than 64 MB' }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [{ path: '', message: `not valid JSON: ${(error as Error).message}` }] };
  }
  if (!isObject(raw)) return { ok: false, errors: [{ path: '', message: 'a backup is a JSON object' }] };
  if (raw.format !== WORKSPACE_FORMAT) return { ok: false, errors: [{ path: 'format', message: `expected "${WORKSPACE_FORMAT}"` }] };
  if (raw.version !== WORKSPACE_VERSION) return { ok: false, errors: [{ path: 'version', message: `expected ${WORKSPACE_VERSION}` }] };
  for (const key of Object.keys(raw)) {
    if (!['format', 'version', 'savedAt', 'current', 'projects', 'libraries', 'snippets', 'settings'].includes(key)) fail(key, 'unknown field');
  }
  if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt)) fail('savedAt', 'must be a number');

  let current: ProjectFile | null = null;
  if (raw.current !== null) {
    const parsed = parseProjectJson(JSON.stringify(raw.current));
    if (parsed.ok) {
      current = parsed.file;
      warnings.push(...parsed.warnings);
    } else for (const e of parsed.errors) fail(`current${e.path ? `.${e.path}` : ''}`, e.message);
  }

  const projects: StoredProject[] = [];
  if (!Array.isArray(raw.projects)) fail('projects', 'must be a list');
  else if (raw.projects.length > MAX_PROJECTS) fail('projects', `at most ${MAX_PROJECTS}`);
  else {
    raw.projects.forEach((entry: unknown, i) => {
      const path = `projects[${i}]`;
      if (!isObject(entry)) return fail(path, 'must be an object');
      for (const key of Object.keys(entry)) if (!['id', 'title', 'savedAt', 'file', 'snapshot'].includes(key)) fail(`${path}.${key}`, 'unknown field');
      if (typeof entry.id !== 'string' || !ID.test(entry.id)) return fail(`${path}.id`, 'must be 1-80 letters, digits, dots, dashes or underscores');
      if (typeof entry.title !== 'string' || entry.title.length > 200) return fail(`${path}.title`, 'must be text of at most 200 characters');
      if (typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt)) return fail(`${path}.savedAt`, 'must be a number');
      if (entry.snapshot !== undefined && entry.snapshot !== true) return fail(`${path}.snapshot`, 'must be true when present');
      const parsed = parseProjectJson(JSON.stringify(entry.file));
      if (!parsed.ok) return parsed.errors.forEach((e) => fail(`${path}.file${e.path ? `.${e.path}` : ''}`, e.message));
      projects.push({ id: entry.id, title: entry.title, savedAt: entry.savedAt, file: parsed.file, ...(entry.snapshot ? { snapshot: true as const } : {}) });
    });
  }

  const libraries: Library[] = [];
  if (!Array.isArray(raw.libraries)) fail('libraries', 'must be a list');
  else if (raw.libraries.length > MAX_LIBRARIES) fail('libraries', `at most ${MAX_LIBRARIES}`);
  else {
    raw.libraries.forEach((entry: unknown, i) => {
      const parsed = validateLibrary(entry);
      if (parsed.ok) libraries.push(parsed.library);
      else parsed.errors.forEach((e) => fail(`libraries[${i}]${e.path ? `.${e.path}` : ''}`, e.message));
    });
  }

  const snippetList = parseSnippetList(raw.snippets);
  if (!snippetList.ok) errors.push(...snippetList.errors);

  const settings: Record<string, string> = {};
  if (!isObject(raw.settings)) fail('settings', 'must be an object');
  else {
    for (const [key, value] of Object.entries(raw.settings)) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) fail(`settings.${key}`, 'not a setting of this application');
      else if (typeof value !== 'string' || value.length > MAX_SETTING_CHARS) fail(`settings.${key}`, 'must be text of at most 500000 characters');
      else settings[key] = value;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, workspace: buildWorkspace({ savedAt: raw.savedAt as number, current, projects, libraries, snippets: snippetList.ok ? snippetList.snippets : [], settings }), warnings };
}
