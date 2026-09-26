'use strict';

import {
  ERROR_BADKEY,
  ERROR_CANTWRITE,
  ERROR_INVALID_PARAMETER,
  ERROR_SUCCESS,
  HKEY_CLASSES_ROOT,
  RegistryDatabase,
} from './registry.js';

/**
 * `RegOpenKey` and the rest, over the database in `registry.ts`.
 *
 * **Read out of `SHELL.DLL`** (seg2 `0dbc`, `0b6a`, `1114`, `14dc`, `16f4`,
 * `168e`). A key's handle is `0001:` and its entry. `HKEY_CLASSES_ROOT`, 1,
 * is found again as `.classes` every time; any other handle with nothing in
 * its high word is the root; an entry below the buckets is the root too, and
 * one past the table's end is error 2.
 */

const CLASSES = '.classes';

type Mode = 'open' | 'create';

interface Shell {
  db: RegistryDatabase | null;
  open: number;
}

function stateOf(system: any): Shell {
  system._registry ??= { db: null, open: 0 };

  return system._registry;
}

function path(system: any) {
  return `${system.dos.files.systemRootPath}REG.DAT`;
}

/** The database, read when nothing is open (seg2 `0dbc`); a missing file is made empty at start. */
async function load(system: any): Promise<RegistryDatabase | number> {
  const state = stateOf(system);

  if (state.db) {
    return state.db;
  }

  const files = system.dos.files;
  const handle = await files.open(path(system));
  const file = handle ? files.resolve(handle) : null;

  if (!file) {
    /* SHELL makes the file from its empty database when it starts; here, the
     * first time it is wanted. */
    state.db = RegistryDatabase.empty();
    state.db.dirty = true;

    return state.db;
  }

  const bytes = new Uint8Array(await file.read(0, file.size));

  files.close(handle);

  const db = RegistryDatabase.parse(bytes);

  if (typeof db === 'number') {
    return db;
  }

  state.db = db;

  return db;
}

/** Written back when the last key closes, if anything changed (seg2 `1164`). */
async function flush(system: any) {
  const state = stateOf(system);

  if (state.open > 0 || !state.db?.dirty) {
    return ERROR_SUCCESS;
  }

  const files = system.dos.files;
  const handle = await files.create(path(system));
  const file = handle ? files.resolve(handle) : null;

  if (!file) {
    return ERROR_CANTWRITE;
  }

  const bytes = state.db.serialize();

  await file.write(0, bytes);
  files.close(handle);
  state.db.dirty = false;

  return ERROR_SUCCESS;
}

/** The entry a handle names, making `.classes` when asked to. */
function keyOf(db: RegistryDatabase, hkey: number, mode: Mode) {
  if (hkey === HKEY_CLASSES_ROOT) {
    const classes = db.childNamed(0, CLASSES);

    return classes || (mode === 'create' ? db.makeChild(0, CLASSES) : -1);
  }

  if (((hkey >>> 16) & 0xffff) === 0) {
    return 0;
  }

  const index = hkey & 0xffff;

  if (index >= db.entries.length) {
    return -1;
  }

  return index <= db.buckets ? 0 : index;
}

/** A path's parts (seg2 `0b6a`), or null for one SHELL refuses. */
function partsOf(subkey: string | null, root: boolean) {
  if (subkey === null) {
    return [];
  }

  let text = subkey.replace(/^ +/, '');

  if (text.startsWith('\\')) {
    if (!root) {
      return null;
    }

    text = text.substring(1);
  }

  if (text === '') {
    return [];
  }

  const parts = text.split('\\');

  for (const part of parts) {
    if (!part || part.length > 63) {
      return null;
    }

    for (const c of part) {
      const code = c.charCodeAt(0);

      if (code <= 0x20 || code >= 0x80) {
        return null;
      }
    }
  }

  return parts;
}

/** Opens (or makes) a key below another; an error code, or the entry. */
async function find(system: any, hkey: number, subkey: string | null, mode: Mode) {
  const db = await load(system);

  if (typeof db === 'number') {
    return { error: db };
  }

  let at = keyOf(db, hkey, mode);

  if (at < 0) {
    return { error: ERROR_BADKEY };
  }

  const parts = partsOf(subkey, at === 0);

  if (parts === null) {
    return { error: ERROR_BADKEY };
  }

  for (const part of parts) {
    const child = db.childNamed(at, part);

    if (child) {
      at = child;
    } else if (mode === 'create') {
      at = db.makeChild(at, part);
    } else {
      return { error: ERROR_BADKEY };
    }
  }

  return { db, at };
}

/** A string and its nought into a program's buffer, cut to `cb` less one; its length and one. */
function copyOut(system: any, text: string, buffer: number, cb: number) {
  if (!cb) {
    return null;
  }

  const core = system.machine.cpu.core;
  const kept = text.substring(0, Math.max(0, cb - 1));

  for (let i = 0; i <= kept.length; i++) {
    core.write8((buffer >>> 16) & 0xffff, ((buffer & 0xffff) + i) & 0xffff, i < kept.length ? kept.charCodeAt(i) : 0);
  }

  return kept.length + 1;
}

async function openKey(system: any, hkey: number, subkey: string | null, phkey: number, mode: Mode) {
  const found = await find(system, hkey, subkey, mode);

  if ('error' in found) {
    return found.error;
  }

  stateOf(system).open++;

  const core = system.machine.cpu.core;
  const segment = (phkey >>> 16) & 0xffff;
  const offset = phkey & 0xffff;

  core.write16(segment, offset, found.at);
  core.write16(segment, (offset + 2) & 0xffff, 1);

  return ERROR_SUCCESS;
}

export function RegOpenKey(this: any, hkey: number, lpszSubKey: any, lphkResult: number) {
  return openKey(this, hkey >>> 0, lpszSubKey ?? null, lphkResult, 'open');
}

export function RegCreateKey(this: any, hkey: number, lpszSubKey: any, lphkResult: number) {
  return openKey(this, hkey >>> 0, lpszSubKey ?? null, lphkResult, 'create');
}

/** Closes a key -- any key: only the count of open keys is kept (seg2 `1114`). */
export async function RegCloseKey(this: any, _hkey: number) {
  const state = stateOf(this);

  if (state.open <= 0) {
    return ERROR_INVALID_PARAMETER;
  }

  state.open--;

  return flush(this);
}

export async function RegQueryValue(this: any, hkey: number, lpszSubKey: any, lpszValue: number, lpcb: number) {
  const found = await find(this, hkey >>> 0, lpszSubKey ?? null, 'open');

  if ('error' in found) {
    return found.error;
  }

  const core = this.machine.cpu.core;
  const segment = (lpcb >>> 16) & 0xffff;
  const offset = lpcb & 0xffff;
  const cb = core.read16(segment, offset);
  const value = found.db.textOf(found.db.entries[found.at][3]) ?? '';
  const length = copyOut(this, value, lpszValue, cb);

  if (length !== null) {
    core.write16(segment, offset, length);
    core.write16(segment, (offset + 2) & 0xffff, 0);
  }

  return ERROR_SUCCESS;
}

export async function RegSetValue(
  this: any,
  hkey: number,
  lpszSubKey: any,
  fdwType: number,
  lpszValue: any,
  _cb: number
) {
  if ((fdwType >>> 0) !== 1) {
    return ERROR_INVALID_PARAMETER;
  }

  stateOf(this).open++;

  const found = await find(this, hkey >>> 0, lpszSubKey ?? null, 'create');

  if ('error' in found) {
    stateOf(this).open--;
    return found.error;
  }

  const { db, at } = found;
  const entry = db.entries[at];
  const text = lpszValue ? String(lpszValue) : '';
  const was = entry[3];

  if (!text) {
    if (was) {
      entry[3] = 0;
      db.releaseText(was);
      db.dirty = true;
    }
  } else if (db.textOf(was) !== text) {
    entry[3] = db.useText(text, false);
    db.releaseText(was);
    db.dirty = true;
  }

  stateOf(this).open--;

  return flush(this);
}

export async function RegDeleteKey(this: any, hkey: number, lpszSubKey: any) {
  if (!lpszSubKey) {
    return ERROR_BADKEY;
  }

  const parts = String(lpszSubKey).split('\\');
  const name = parts.pop()!;
  const found = await find(this, hkey >>> 0, parts.length ? parts.join('\\') : null, 'open');

  if ('error' in found) {
    return found.error;
  }

  const { db, at } = found;
  const child = db.childNamed(at, name);

  if (!child) {
    return ERROR_BADKEY;
  }

  /* Out of its parent's list, then gone. */
  if (db.entries[at][1] === child) {
    db.entries[at][1] = db.entries[child][0];
  } else {
    let before = db.entries[at][1];

    while (db.entries[before][0] !== child) {
      before = db.entries[before][0];
    }

    db.entries[before][0] = db.entries[child][0];
  }

  db.removeTree(child);
  db.dirty = true;

  return flush(this);
}

/** A key's `index`th child's name, newest first; error 2 past the last (seg2 `14dc`). */
export async function RegEnumKey(this: any, hkey: number, iSubkey: number, lpszName: number, cchName: number) {
  const found = await find(this, hkey >>> 0, null, 'open');

  if ('error' in found) {
    return found.error;
  }

  const { db, at } = found;
  let child = db.entries[at][1];

  for (let i = 0; i < iSubkey >>> 0 && child; i++) {
    child = db.entries[child][0];
  }

  if (!child) {
    return ERROR_BADKEY;
  }

  copyOut(this, db.textOf(db.entries[child][2]) ?? '', lpszName, cchName & 0xffff);

  return ERROR_SUCCESS;
}

