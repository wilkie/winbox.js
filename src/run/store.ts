'use strict';

import { type Layer, type LayerManifest } from '../layers/layer.js';
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
const BLOBS = 'blobs';
const LAYERS = 'layers';
const PROGRAMS = 'programs';
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

/**
 * The identity of what programs wrote on a kept program's stack: its name,
 * and the stack -- the base, the display and the layers' ids -- which what
 * it wrote is kept only with.
 */
export const programIdentity = (name: string, base: string, display: string, layers: string[]) =>
  `program:${encodeURIComponent(name)}:${base}:${display}:${layers.join(',')}`;

/**
 * Where changes told against an identity are kept: a kept program's in a
 * record of its own, `C:program:<name>`, whatever its stack; the asset
 * bundle's base's for each display; the installation's, or none, in the
 * one record.
 */
export const changesKey = (identity: string | null) =>
  identity?.startsWith('program:')
    ? `${DRIVE}:program:${decodeURIComponent(identity.split(':')[1])}`
    : identity?.startsWith('assets:')
      ? `${DRIVE}:${identity}`
      : DRIVE;

/** Where a kept program's changes are kept, by its name. */
export const programChangesKey = (name: string) => `${DRIVE}:program:${name}`;

/**
 * A program kept in this browser (`kb/formats/layer.md`): its stack -- the
 * base it was made on and its layers, the lowest first, each kept in the
 * `layers` store, its files' bytes in `blobs` -- and the display it is
 * bound to. What it writes as it runs is its user layer, kept in `changes`
 * under `programChangesKey`.
 */
export interface KeptProgram {
  /** Its name: its archive's, without `.zip`. */
  name: string;

  /** The base it was made on: `base:<assets id>:<display>`, or `install:<sha256 of the archive>`. */
  base: string;
  display: string;

  /** Its layers' ids, the lowest first. */
  layers: string[];

  /** Its programs, as C: names them: `C:\GAMES\SKI.EXE`. */
  exes: string[];

  /** The order a layer's files are put on the drive in, by its id, where kept (`PlannedLayer`). */
  orders: Record<string, string[]>;

  /** When it was kept, in milliseconds since 1970. */
  kept: number;
}

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
      /* Version 4 added the programs, their layers and the blobs; the
       * stores before it are kept as they are. */
      const request = indexedDB.open(DATABASE, 4);

      request.onupgradeneeded = () => {
        const database = request.result;

        for (const name of [ARCHIVES, ASSETS, CHANGES, BLOBS, LAYERS, PROGRAMS]) {
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

/** A request answered, as a promise. */
const answer = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * Something done in one transaction over several stores, answered once the
 * transaction is done; rejected, with why, where it failed -- the browser's
 * quota spent, say -- or the database could not be opened.
 */
function across<T>(
  names: string[],
  mode: IDBTransactionMode,
  act: (stores: Record<string, IDBObjectStore>) => Promise<T>
) {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        if (!database) {
          reject(new Error('this browser keeps nothing for the page'));
          return;
        }

        try {
          const transaction = database.transaction(names, mode);
          const stores = Object.fromEntries(
            names.map((name) => [name, transaction.objectStore(name)])
          );
          let result: T;

          act(stores).then(
            (value) => (result = value),
            (error) => {
              try {
                transaction.abort();
              } catch {
                /* Done already. */
              }

              reject(error);
            }
          );
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error ?? new Error('not kept'));
        } catch (error) {
          reject(error);
        }
      })
  );
}

/**
 * Asks the browser to keep what the page keeps when it runs short of
 * room, where it can be asked: a program kept is not to vanish with the
 * cache. Asked once, and not waited for -- Firefox asks the user, and
 * answers only once they have -- for what it answers changes nothing here.
 */
let persisting = false;

function persist() {
  if (persisting) {
    return;
  }

  persisting = true;

  try {
    navigator.storage?.persist?.().catch(() => false);
  } catch {
    /* Not to be asked here. */
  }
}

/** The programs kept, the earliest kept first; none where the store cannot be opened. */
export async function recallPrograms(): Promise<KeptProgram[]> {
  const programs = await run<KeptProgram[]>(PROGRAMS, 'readonly', (store) => store.getAll());

  return (programs ?? []).sort((one, other) => one.kept - other.kept);
}

/**
 * A program kept, with its layers and their blobs, a blob or a layer kept
 * already left as it is; rejects, with why, where it could not be. What
 * another program of the same name had and nothing else has is let go of.
 */
export async function keepProgram(program: KeptProgram, layers: Layer[]) {
  persist();
  await across([BLOBS, LAYERS, PROGRAMS], 'readwrite', async (stores) => {
    for (const { manifest, blobs } of layers) {
      for (const [hash, data] of blobs) {
        if ((await answer(stores[BLOBS].getKey(hash))) === undefined) {
          stores[BLOBS].put(data, hash);
        }
      }

      stores[LAYERS].put(manifest, manifest.id);
    }

    stores[PROGRAMS].put(program, program.name);
  });
  await collect().catch(() => undefined);
}

/**
 * A kept program's layers, the lowest first, their blobs read back;
 * rejects where one is missing.
 */
export function recallLayers(program: KeptProgram) {
  return across([BLOBS, LAYERS], 'readonly', async (stores) => {
    const layers: Layer[] = [];

    for (const id of program.layers) {
      const manifest = await answer<LayerManifest | undefined>(stores[LAYERS].get(id));

      if (!manifest) {
        throw new Error(`its layer ${id} is not kept`);
      }

      const blobs = new Map<string, Uint8Array>();

      for (const entry of manifest.entries) {
        if (entry.kind === 'file' && !blobs.has(entry.sha256)) {
          const data = await answer<Uint8Array | undefined>(stores[BLOBS].get(entry.sha256));

          if (!data) {
            throw new Error(`the bytes of its C:\\${entry.path} are not kept`);
          }

          blobs.set(entry.sha256, data);
        }
      }

      layers.push({ manifest, blobs });
    }

    return layers;
  });
}

/** A program forgotten, and what it wrote; its layers and blobs, where nothing else has them. */
export async function forgetProgram(name: string) {
  await across([PROGRAMS, CHANGES], 'readwrite', async (stores) => {
    stores[PROGRAMS].delete(name);
    stores[CHANGES].delete(programChangesKey(name));
  });
  await collect().catch(() => undefined);
}

/** Every program forgotten, with its layers and blobs. */
export const forgetAllPrograms = () =>
  across([BLOBS, LAYERS, PROGRAMS], 'readwrite', async (stores) => {
    for (const name of [BLOBS, LAYERS, PROGRAMS]) {
      stores[name].clear();
    }
  }).catch(() => undefined);

/**
 * The layers no kept program has, and the blobs no layer kept has, let go
 * of: what forgetting a program, or keeping another in its name, leaves.
 */
export function collect() {
  return across([BLOBS, LAYERS, PROGRAMS], 'readwrite', async (stores) => {
    const programs = await answer<KeptProgram[]>(stores[PROGRAMS].getAll());
    const used = new Set(programs.flatMap((program) => program.layers));
    const manifests = await answer<LayerManifest[]>(stores[LAYERS].getAll());
    const hashes = new Set<string>();

    for (const manifest of manifests) {
      if (!used.has(manifest.id)) {
        stores[LAYERS].delete(manifest.id);
        continue;
      }

      for (const entry of manifest.entries) {
        if (entry.kind === 'file') {
          hashes.add(entry.sha256);
        }
      }
    }

    for (const hash of await answer<IDBValidKey[]>(stores[BLOBS].getAllKeys())) {
      if (!hashes.has(String(hash))) {
        stores[BLOBS].delete(hash);
      }
    }
  });
}

/** How many layers and blobs are kept: what the page's tests look at. */
export const keptCounts = () =>
  across([BLOBS, LAYERS, PROGRAMS], 'readonly', async (stores) => ({
    programs: await answer(stores[PROGRAMS].count()),
    layers: await answer(stores[LAYERS].count()),
    blobs: await answer(stores[BLOBS].count()),
  }));

/** What programs wrote kept under a key, whatever it was told against. */
export const recallChangesAt = (key: string) =>
  run<Kept>(CHANGES, 'readonly', (store) => store.get(key));

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
