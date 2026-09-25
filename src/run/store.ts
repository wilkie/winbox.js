'use strict';

/**
 * Where the demo page keeps a person's Windows installation between visits:
 * the archive they dropped, as it was, in this browser's IndexedDB. Nothing
 * leaves the browser, and nothing here is needed to use the page -- a store
 * that cannot be opened, as in a private window, simply remembers nothing.
 */

const DATABASE = 'winbox-run';
const STORE = 'archives';
const KEY = 'windows';

export interface Remembered {
  name: string;
  bytes: Uint8Array;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1);

      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (database) =>
      new Promise<T | null>((resolve) => {
        if (!database) {
          resolve(null);
          return;
        }

        try {
          const request = act(database.transaction(STORE, mode).objectStore(STORE));

          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/** The Windows installation remembered from an earlier visit, if any. */
export const recallWindows = () => run<Remembered>('readonly', (store) => store.get(KEY));

/** Remembers a Windows installation for the next visit. */
export const rememberWindows = (archive: Remembered) =>
  run('readwrite', (store) => store.put(archive, KEY));

/** Forgets it. */
export const forgetWindows = () => run('readwrite', (store) => store.delete(KEY));
