import type { Library } from './types';
import { parseLibraryJson, type ParseResult } from './validate';

export interface LibraryStorage {
  list(): Promise<Library[]>;
  put(library: Library): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryLibraryStorage implements LibraryStorage {
  private readonly libraries = new Map<string, Library>();

  async list(): Promise<Library[]> {
    return [...this.libraries.values()];
  }

  async put(library: Library): Promise<void> {
    this.libraries.set(library.id, structuredClone(library));
  }

  async remove(id: string): Promise<void> {
    this.libraries.delete(id);
  }
}

const STORE = 'libraries';

export class IndexedDbLibraryStorage implements LibraryStorage {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly dbName = 'eebox') {}

  async list(): Promise<Library[]> {
    return this.request('readonly', (store) => store.getAll());
  }

  async put(library: Library): Promise<void> {
    await this.request('readwrite', (store) => store.put(library));
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

  private async request<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = action(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}

/** Stores the library only if it validates; a library with the same id is replaced. */
export async function importLibrary(
  storage: LibraryStorage,
  text: string,
): Promise<ParseResult> {
  const result = parseLibraryJson(text);
  if (result.ok) await storage.put(result.library);
  return result;
}
