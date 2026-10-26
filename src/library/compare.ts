import { stableStringify } from './equality';
import type { Library } from './types';

export interface NameDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface LibraryDiff {
  modules: NameDiff;
  enclosures: NameDiff;
  /** Library-level fields (name, version, vendor, url, description) that differ. */
  metadata: string[];
}

const METADATA_FIELDS = ['name', 'version', 'vendor', 'url', 'description'] as const;
const NAME_LIMIT = 3;

function diffNames<T extends { id: string; name: string }>(before: T[], after: T[]): NameDiff {
  const old = new Map(before.map((item) => [item.id, item]));
  const next = new Map(after.map((item) => [item.id, item]));
  return {
    added: after.filter((item) => !old.has(item.id)).map((item) => item.name),
    removed: before.filter((item) => !next.has(item.id)).map((item) => item.name),
    changed: after
      .filter((item) => old.has(item.id) && stableStringify(old.get(item.id)) !== stableStringify(item))
      .map((item) => item.name),
  };
}

export function diffLibraries(before: Library, after: Library): LibraryDiff {
  return {
    modules: diffNames(before.modules, after.modules),
    enclosures: diffNames(before.enclosures, after.enclosures),
    metadata: METADATA_FIELDS.filter((field) => before[field] !== after[field]),
  };
}

export function isUnchanged(diff: LibraryDiff): boolean {
  const empty = (d: NameDiff) => d.added.length + d.removed.length + d.changed.length === 0;
  return empty(diff.modules) && empty(diff.enclosures) && diff.metadata.length === 0;
}

export type ImportPlan =
  | { kind: 'new' }
  | { kind: 'same' }
  | { kind: 'reserved' }
  | { kind: 'replace'; before: Library; diff: LibraryDiff };

/**
 * What importing a library should do: add it, say it is already there, ask before replacing a
 * different one with the same id, or refuse the id of the bundled library, which is refreshed at start-up.
 */
export function planImport(existing: Library[], incoming: Library, bundledId: string): ImportPlan {
  if (incoming.id === bundledId) return { kind: 'reserved' };
  const before = existing.find((l) => l.id === incoming.id);
  if (!before) return { kind: 'new' };
  const diff = diffLibraries(before, incoming);
  return isUnchanged(diff) ? { kind: 'same' } : { kind: 'replace', before, diff };
}

function summarise(label: string, diff: NameDiff): string[] {
  const part = (verb: string, names: string[]) =>
    names.length === 0
      ? ''
      : `${names.length} ${label}${names.length === 1 ? '' : 's'} ${verb} (${names.slice(0, NAME_LIMIT).join(', ')}${names.length > NAME_LIMIT ? ', …' : ''})`;
  return [part('added', diff.added), part('removed', diff.removed), part('changed', diff.changed)].filter(Boolean);
}

export function describeDiff(diff: LibraryDiff): string {
  const parts = [
    ...summarise('module', diff.modules),
    ...summarise('enclosure', diff.enclosures),
    ...(diff.metadata.length > 0 ? [`${diff.metadata.join(', ')} changed`] : []),
  ];
  return parts.length > 0 ? parts.join('; ') : 'no differences';
}
