'use strict';

import { type Change } from './changes.js';

/**
 * Where the demo page keeps a person's Windows between visits, and what their
 * programs wrote: the installation's archive they dropped, as it was, or the
 * asset bundle made from their Windows 3.1 disks (`kb/topics/asset-bundle.md`);
 * and the changes on C: (`changes.ts`), in this browser's IndexedDB. Nothing
 * leaves the browser -- the bundle is Microsoft's files, the user's own, and
 * is never sent anywhere -- and nothing here is needed to use the page: a
 * store that cannot be opened, as in a private window, simply remembers
 * nothing.
 */

const DATABASE = 'winbox-run';
const ARCHIVES = 'archives';
const ASSETS = 'assets';
const CHANGES = 'changes';
const KEY = 'windows';
const BUNDLE = 'bundle';

/**
 * The changes are kept as one record, for drive C:, whichever archives were
 * dropped with the installation: they are paths on C:, and the program
 * archives are not remembered, but come and go, dropped again or others
 * dropped beside them, where the changes are to stay. They are told against
 * the installation they were made on, which they name, and are kept only
 * with it.
 *
 * On the asset bundle's base, the base differs with the display -- its
 * profiles and fonts are Setup's for that display -- so the changes are told
 * against the bundle and the display (`assetsIdentity`), and each display's
 * are kept in a record of their own (`changesKey`): a `WIN.INI` written on
 * one display is not put on another's base, and is there again when that
 * display is chosen again.
 */
const DRIVE = 'C';

/** The identity of changes made on an asset bundle's base for a display. */
export const assetsIdentity = (id: string, display: string) => `assets:${id}:${display}`;

/** Where changes told against an identity are kept: the installation's, or none, in the one record. */
export const changesKey = (identity: string | null) =>
  identity?.startsWith('assets:') ? `${DRIVE}:${identity}` : DRIVE;

export interface Remembered {
  name: string;
  bytes: Uint8Array;
}

/** What programs wrote on C:, and the installation it was written against. */
export interface Kept {
  /**
   * What it was written against: the installation's identity (`identify`),
   * the asset bundle's and the display's (`assetsIdentity`), or null where
   * neither was dropped.
   */
  installation: string | null;
  changes: Change[];
}

/** The database, opened once, until another page asks to upgrade it. */
let opened: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 3);

      request.onupgradeneeded = () => {
        const database = request.result;

        for (const name of [ARCHIVES, ASSETS, CHANGES]) {
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

/** The asset bundle remembered from an earlier visit, as `winbox-assets.zip`'s bytes, if any. */
export const recallAssets = () => run<Remembered>(ASSETS, 'readonly', (store) => store.get(BUNDLE));

/** Remembers the asset bundle for the next visit; rejects where it could not be kept. */
export const rememberAssets = (bundle: Remembered) =>
  run(ASSETS, 'readwrite', (store) => store.put(bundle, BUNDLE), true);

/** Forgets it. */
export const forgetAssets = () => run(ASSETS, 'readwrite', (store) => store.delete(BUNDLE));

/**
 * What programs wrote on C: against an identity, kept from an earlier visit:
 * none where nothing was, or what was is told against another.
 */
export const recallChanges = async (identity: string | null) => {
  const kept = await run<Kept>(CHANGES, 'readonly', (store) => store.get(changesKey(identity)));

  return kept && kept.installation === identity ? kept : null;
};

/** Keeps what programs wrote on C: for the next visit; rejects where it could not be kept. */
export const rememberChanges = (kept: Kept) =>
  run(CHANGES, 'readwrite', (store) => store.put(kept, changesKey(kept.installation)), true);

/** Forgets what was written against an identity. */
export const forgetChanges = (identity: string | null) =>
  run(CHANGES, 'readwrite', (store) => store.delete(changesKey(identity)));

/** Forgets everything programs wrote, against whatever it was. */
export const forgetAllChanges = () => run(CHANGES, 'readwrite', (store) => store.clear());

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
