'use strict';

import { type Change } from './changes.js';

/**
 * Where the demo page keeps a person's Windows installation between visits,
 * and what their programs wrote: the archive they dropped, as it was, and
 * the changes on C: (`changes.ts`), in this browser's IndexedDB. Nothing
 * leaves the browser, and nothing here is needed to use the page -- a store
 * that cannot be opened, as in a private window, simply remembers nothing.
 */

const DATABASE = 'winbox-run';
const ARCHIVES = 'archives';
const CHANGES = 'changes';
const KEY = 'windows';

/**
 * The changes are kept as one record, for drive C:, whichever archives were
 * dropped with the installation: they are paths on C:, and the program
 * archives are not remembered, but come and go, dropped again or others
 * dropped beside them, where the changes are to stay. They are told against
 * the installation they were made on, which they name, and are kept only
 * with it.
 */
const DRIVE = 'C';

export interface Remembered {
  name: string;
  bytes: Uint8Array;
}

/** What programs wrote on C:, and the installation it was written against. */
export interface Kept {
  /** The installation's identity (`identify`), or null where none was dropped. */
  installation: string | null;
  changes: Change[];
}

/** The database, opened once, until another page asks to upgrade it. */
let opened: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 2);

      request.onupgradeneeded = () => {
        const database = request.result;

        for (const name of [ARCHIVES, CHANGES]) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name);
          }
        }
      };
      request.onsuccess = () => {
        const database = request.result;

        /* A newer page wanting to upgrade it is let, and this opens it again. */
        database.onversionchange = () => {
          database.close();
          opened = null;
        };
        resolve(database);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return opened;
}

/**
 * A request made of a store, and what it answered; null where the store
 * could not be opened or the request failed. A write is answered once its
 * transaction is done, so that what is written is there for the next visit;
 * one that fails rejects, with why -- the browser's quota spent, say -- where
 * `strict` asks for it.
 */
function run<T>(
  name: string,
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
  strict = false
) {
  return open().then(
    (database) =>
      new Promise<T | null>((resolve, reject) => {
        if (!database) {
          resolve(null);
          return;
        }

        const failed = (error: unknown) => (strict ? reject(error) : resolve(null));

        try {
          const transaction = database.transaction(name, mode);
          const request = act(transaction.objectStore(name));

          transaction.oncomplete = () => resolve(request.result ?? null);
          transaction.onerror = () => failed(transaction.error ?? request.error);
          transaction.onabort = () => failed(transaction.error ?? request.error);
        } catch (error) {
          failed(error);
        }
      })
  );
}

/** The Windows installation remembered from an earlier visit, if any. */
export const recallWindows = () => run<Remembered>(ARCHIVES, 'readonly', (store) => store.get(KEY));

/** Remembers a Windows installation for the next visit. */
export const rememberWindows = (archive: Remembered) =>
  run(ARCHIVES, 'readwrite', (store) => store.put(archive, KEY));

/** Forgets it. */
export const forgetWindows = () => run(ARCHIVES, 'readwrite', (store) => store.delete(KEY));

/** What programs wrote on C:, kept from an earlier visit, if anything. */
export const recallChanges = () => run<Kept>(CHANGES, 'readonly', (store) => store.get(DRIVE));

/** Keeps what programs wrote on C: for the next visit; rejects where it could not be kept. */
export const rememberChanges = (kept: Kept) =>
  run(CHANGES, 'readwrite', (store) => store.put(kept, DRIVE), true);

/** Forgets it. */
export const forgetChanges = () => run(CHANGES, 'readwrite', (store) => store.delete(DRIVE));

/**
 * An installation told apart from another: its archive's SHA-256, where the
 * browser has it to give, else its name and size.
 */
export async function identify(archive: Remembered) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', archive.bytes as BufferSource);

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    );
  } catch {
    return `${archive.name}:${archive.bytes.length}`;
  }
}
