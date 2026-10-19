/**
 * `REG.DAT` as Windows 3.1's Setup makes it: `REGEDIT /S /U SETUP.REG`
 * (`SETUP.INF` `[data]` `register`), each line of the script given to
 * SHELL's registration database through WinBox's own writer
 * (`src/win16/shell/registry.ts`, `reg-api.ts`).
 *
 * **Read out of `REGEDIT.EXE`** seg1:
 *
 * - `4345`: the import. `HKEY_CLASSES_ROOT` opened with `RegCreateKey`
 *   (SHELL 2) at `4357`-`4364`, held open while the script is read, and
 *   closed with `RegCloseKey` (SHELL 3) at `442d` -- so the database is
 *   written once, at the end.
 * - `4370`-`43be`: each line held to the prefixes of the table at DS:00C6
 *   in turn, `HKEY_CLASSES_ROOT\` and `\.classes\`, both for
 *   `HKEY_CLASSES_ROOT`, by USER's `lstrcmp` (USER 430) of the line's first
 *   characters, as many as the prefix has; a line that has neither is
 *   passed over -- the script's comments.
 * - `43c0`-`440e`: the key is what follows the prefix up to the first
 *   space; the spaces after it are passed over, then an `=` and the one
 *   space after it; the value is the rest of the line. A line with no ` = `
 *   names a key and an empty value.
 * - `0010`, reached through `[0036]` at `0077`: `RegSetValue` (SHELL 5) of
 *   the key below the prefix's handle, `REG_SZ`, the value.
 *
 * `/S` (no message at the end) and `/U` change nothing in the database.
 */

import { HKEY_CLASSES_ROOT, RegistryDatabase } from '../win16/shell/registry.js';
import { findIn, putValue } from '../win16/shell/reg-api.js';

/** The prefixes, in the table's order, and the handle each stands for (DS:00C6). */
const PREFIXES: [string, number][] = [
  ['HKEY_CLASSES_ROOT\\', HKEY_CLASSES_ROOT],
  ['\\.classes\\', HKEY_CLASSES_ROOT],
];

/** A script's lines put into a database, as `REGEDIT` puts them. */
export function regeditImport(db: RegistryDatabase, script: string) {
  /* RegCreateKey(HKEY_CLASSES_ROOT, NULL): `.classes` made, if it is not there. */
  findIn(db, HKEY_CLASSES_ROOT, null, 'create');

  for (const raw of script.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const match = PREFIXES.find(([prefix]) => line.startsWith(prefix));

    if (!match) {
      continue;
    }

    const [prefix, hkey] = match;
    const rest = line.slice(prefix.length);
    const space = rest.indexOf(' ');
    const key = space === -1 ? rest : rest.slice(0, space);
    let at = space === -1 ? rest.length : space;

    while (rest[at] === ' ') {
      at++;
    }

    if (rest[at] === '=') {
      at++;

      if (rest[at] === ' ') {
        at++;
      }
    }

    const found = findIn(db, hkey, key, 'create');

    if ('at' in found) {
      putValue(db, found.at, rest.slice(at));
    }
  }
}

/** The `REG.DAT` a script makes from nothing: SHELL's empty database, the script put in, written. */
export function regDatFrom(script: Uint8Array) {
  const db = RegistryDatabase.empty();

  regeditImport(db, Array.from(script, (byte) => String.fromCharCode(byte)).join(''));

  return db.serialize();
}
