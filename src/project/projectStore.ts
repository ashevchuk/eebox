import { canonicalJson } from './canonical';
import type { ProjectFile } from './file';

/** A project kept in the browser under a name of its own, next to the one being worked on. */
export interface StoredProject {
  id: string;
  /** The title of the panel when it was saved. */
  title: string;
  savedAt: number;
  file: ProjectFile;
  /** Kept by the application, not chosen by the user: an earlier state of the project on the screen. */
  snapshot?: true;
}

export const MAX_SNAPSHOTS = 12;
/** An automatic snapshot is taken at most this often; a project about to be replaced is kept at once. */
export const SNAPSHOT_INTERVAL_MS = 5 * 60_000;

export const savedProjects = (projects: readonly StoredProject[]): StoredProject[] => projects.filter((p) => !p.snapshot);
export const snapshotsOf = (projects: readonly StoredProject[]): StoredProject[] => newestFirst(projects.filter((p) => p.snapshot));

/** The oldest snapshots beyond `max`, which are to be removed. */
export const snapshotsToDrop = (projects: readonly StoredProject[], max = MAX_SNAPSHOTS): StoredProject[] => snapshotsOf(projects).slice(max);

export interface ProjectStore {
  list(): Promise<StoredProject[]>;
  put(project: StoredProject): Promise<void>;
  remove(id: string): Promise<void>;
}

/** The projects, the one saved last first. */
export function newestFirst(projects: readonly StoredProject[]): StoredProject[] {
  return [...projects].sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
}

/** An id that no stored project has: `project-1`, `project-2`, ... */
export function newProjectId(existing: readonly StoredProject[]): string {
  const taken = new Set(existing.map((p) => p.id));
  for (let n = 1; ; n++) if (!taken.has(`project-${n}`)) return `project-${n}`;
}

/** An id for a snapshot taken at `at`; two snapshots in one millisecond are told apart by a counter. */
export function newSnapshotId(existing: readonly StoredProject[], at: number): string {
  const taken = new Set(existing.map((p) => p.id));
  for (let n = 0; ; n++) {
    const id = n === 0 ? `snapshot-${at}` : `snapshot-${at}-${n}`;
    if (!taken.has(id)) return id;
  }
}

export interface ImportPlan {
  put: StoredProject[];
  added: number;
  unchanged: number;
}

/**
 * What storing projects from a backup does: one that is already there with the same content is left,
 * one whose id is taken by a different project gets a new id, so nothing that is stored is overwritten.
 */
export function planProjectImport(existing: readonly StoredProject[], incoming: readonly StoredProject[]): ImportPlan {
  const known = [...existing];
  const put: StoredProject[] = [];
  let unchanged = 0;
  for (const project of incoming) {
    const same = known.find((p) => p.id === project.id);
    if (same && canonicalJson(same.file) === canonicalJson(project.file)) {
      unchanged++;
      continue;
    }
    const stored = same ? { ...project, id: newProjectId(known) } : project;
    known.push(stored);
    put.push(stored);
  }
  return { put, added: put.length, unchanged };
}

export class MemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<string, StoredProject>();

  async list(): Promise<StoredProject[]> {
    return [...this.projects.values()].map((p) => structuredClone(p));
  }

  async put(project: StoredProject): Promise<void> {
    this.projects.set(project.id, structuredClone(project));
  }

  async remove(id: string): Promise<void> {
    this.projects.delete(id);
  }
}

const STORE = 'projects';

/** Kept in a database of its own, so the libraries and the projects never share a version. */
export class IndexedDbProjectStore implements ProjectStore {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly dbName = 'eebox-projects') {}

  async list(): Promise<StoredProject[]> {
    return this.request('readonly', (store) => store.getAll());
  }

  async put(project: StoredProject): Promise<void> {
    await this.request('readwrite', (store) => store.put(project));
  }

  async remove(id: string): Promise<void> {
    await this.request('readwrite', (store) => store.delete(id));
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async request<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = action(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
