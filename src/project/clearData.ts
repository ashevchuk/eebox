/** Every key the application writes to localStorage starts with this. */
export const KEY_PREFIX = 'eebox:';

/** The IndexedDB databases of the application: the libraries and the stored projects. */
export const DATABASE_NAMES: readonly string[] = ['eebox', 'eebox-projects'];

export interface KeyListStore {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

export interface DatabaseDeleter {
  deleteDatabase(name: string): IDBOpenDBRequest;
}

/** Removes the keys of the application only; other sites' keys on the same origin (a shared dev host) stay. */
export function clearKeys(store: KeyListStore): number {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key !== null && key.startsWith(KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
  return keys.length;
}

/** Rejects when the browser refuses or when an open connection keeps the database alive, so a failure is not mistaken for a clean slate. */
export function deleteDatabaseNamed(factory: DatabaseDeleter, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`could not delete ${name}`));
    request.onblocked = () => reject(new Error(`${name} is still open in another tab`));
  });
}

export interface ClearTargets {
  local: KeyListStore;
  databases: DatabaseDeleter | undefined;
  /** Closes this page's own connections first; a database cannot be deleted while one is open. */
  closeConnections: () => Promise<void>;
}

export async function clearAllData(targets: ClearTargets): Promise<void> {
  clearKeys(targets.local);
  if (!targets.databases) return;
  await targets.closeConnections();
  for (const name of DATABASE_NAMES) await deleteDatabaseNamed(targets.databases, name);
}
