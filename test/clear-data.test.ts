import { describe, expect, it } from 'vitest';
import { DATABASE_NAMES, clearAllData, clearKeys, deleteDatabaseNamed, type DatabaseDeleter, type KeyListStore } from '../src/project/clearData';

function fakeLocal(initial: Record<string, string>): KeyListStore & { keys(): string[] } {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    keys: () => [...data.keys()],
  };
}

type Outcome = 'success' | 'error' | 'blocked';

function fakeDatabases(outcomes: Record<string, Outcome> = {}): DatabaseDeleter & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    deleteDatabase(name: string) {
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        const outcome = outcomes[name] ?? 'success';
        if (outcome === 'success') {
          deleted.push(name);
          request.onsuccess?.({} as Event);
        } else if (outcome === 'blocked') request.onblocked?.({} as IDBVersionChangeEvent);
        else request.onerror?.({} as Event);
      });
      return request;
    },
  };
}

describe('clearing everything the application keeps', () => {
  it('removes the keys of the application and leaves the others', () => {
    const local = fakeLocal({ 'eebox:autosave': '{}', 'eebox:grid': '10', 'other-app:token': 'x', eebox: 'bare' });
    expect(clearKeys(local)).toBe(2);
    expect(local.keys()).toEqual(['other-app:token', 'eebox']);
  });

  it('deletes both databases after the page has closed its own connections', async () => {
    const local = fakeLocal({ 'eebox:autosave': '{}' });
    const databases = fakeDatabases();
    const order: string[] = [];
    await clearAllData({ local, databases, closeConnections: async () => void order.push(`closed after ${databases.deleted.length} deletions`) });
    expect(order).toEqual(['closed after 0 deletions']);
    expect(databases.deleted).toEqual([...DATABASE_NAMES]);
    expect(local.keys()).toEqual([]);
  });

  it('still clears the keys where there is no IndexedDB', async () => {
    const local = fakeLocal({ 'eebox:grid': '5' });
    await clearAllData({ local, databases: undefined, closeConnections: async () => undefined });
    expect(local.keys()).toEqual([]);
  });

  it('reports a database that cannot be deleted instead of passing as clean', async () => {
    await expect(deleteDatabaseNamed(fakeDatabases({ eebox: 'blocked' }), 'eebox')).rejects.toThrow(/still open/);
    await expect(deleteDatabaseNamed(fakeDatabases({ eebox: 'error' }), 'eebox')).rejects.toThrow(/could not delete eebox/);
    await expect(
      clearAllData({ local: fakeLocal({}), databases: fakeDatabases({ 'eebox-projects': 'blocked' }), closeConnections: async () => undefined }),
    ).rejects.toThrow(/eebox-projects/);
  });
});
