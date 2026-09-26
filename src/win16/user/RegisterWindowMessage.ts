'use strict';

import { NULL } from '../consts.js';
import { copyText } from './control-classes.js';

/**
 * A message number for a string, the same for every program that registers
 * the same string, so that two programs can agree on a message neither
 * defines.
 *
 * Measured by the `regmsg` probe: the number is at least `0xC000`; the same
 * string again, or in another case, gives the same number; another string a
 * different one. USER keeps the strings in a table of its own --
 * `GlobalFindAtom` does not find a registered message, and
 * `GlobalGetAtomName` does not name one.
 *
 * Not reproduced: the numbers themselves. Windows gave `0xC40E` for the first
 * string the probe registered, and a second string eight more; both depend on
 * what was registered before, and on how USER lays out its table. These count
 * up from `0xC000` a string at a time.
 *
 * @param {string} lpsz - The string.
 * @returns {number} The message, or 0.
 */
export function RegisterWindowMessage(this: any, lpsz: any) {
  if (lpsz === null || lpsz === undefined) {
    return NULL;
  }

  const key = String(lpsz).toUpperCase();

  this._registeredMessages ??= new Map<string, number>();

  const known = this._registeredMessages.get(key);

  if (known) {
    return known;
  }

  const message = 0xc000 + this._registeredMessages.size;

  if (message > 0xffff) {
    return NULL;
  }

  this._registeredMessages.set(key, message);
  (this._registeredNames ??= new Map<number, string>()).set(message, String(lpsz));

  return message;
}

/**
 * The string a clipboard format was registered with, as it was first
 * registered; its length, or nought for a format not registered by name --
 * `CF_TEXT` too. Recorded by `atoms`. `RegisterClipboardFormat` is this
 * table's, the same code as `RegisterWindowMessage` (`USER.EXE` seg1 `8214`).
 */
export function GetClipboardFormatName(this: any, format: number, far: number, size: number) {
  const name = this._registeredNames?.get(format & 0xffff);

  return name === undefined ? 0 : copyText(this, name, far, (size << 16) >> 16);
}
