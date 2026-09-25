'use strict';

import { Profile } from '../profile.js';

/**
 * The glue between the profile calls and the disk.
 *
 * The six profile functions differ only in which file they read and whether
 * they hand back a string or a number, so the parts that are the same -- find
 * the file, read it, copy the answer into the caller's buffer under the rules
 * the API states -- live here once.
 */

/** The file the `GetProfile*` calls read, as opposed to the private ones. */
export const WINDOWS_PROFILE = 'WIN.INI';

/**
 * What each write leaves in memory, until the program flushes the file.
 *
 * Windows does not read a value it has just written back out of the file.
 * Recorded by the `profile` probe: a value written with spaces at its start
 * reads back with them straight after the write, though the file holds it
 * unquoted and the reader trims those spaces from every value it parses; once
 * the program flushes the file, the same entry reads back without them. So a
 * write is kept as written, by file, section and entry, until the flush.
 * Whether reading another file flushes it as well is not separated by the
 * recording, which read `WIN.INI` before flushing.
 */
const written = new WeakMap<object, Map<string, string>>();

/** The key a write is kept under: the file's name, the section and the entry, without case. */
const writtenKey = (name, section, entry) =>
  [
    String(name)
      .split(/[\\/:]/)
      .pop()!
      .toUpperCase(),
    section.toLowerCase(),
    entry.toLowerCase(),
  ].join('\0');

/** The value a write left for this entry, if the file has not been flushed since. */
export function writtenValue(kernel, name, section, entry) {
  return written.get(kernel)?.get(writtenKey(name, section, entry)) ?? null;
}

/**
 * Keeps a write, or forgets one: `null` for the value forgets the entry, and
 * `null` for the entry forgets the section.
 */
export function rememberWrite(kernel, name, section, entry, value) {
  let values = written.get(kernel);

  if (!values) {
    values = new Map();
    written.set(kernel, values);
  }

  if (entry === null) {
    const prefix = writtenKey(name, section, '');

    for (const key of [...values.keys()]) {
      if (key.startsWith(prefix)) {
        values.delete(key);
      }
    }
  } else if (value === null) {
    values.delete(writtenKey(name, section, entry));
  } else {
    values.set(writtenKey(name, section, entry), value);
  }
}

/** Forgets every write to a file: what a flush does. */
export function flushWrites(kernel, name) {
  const prefix = writtenKey(name, '', '').split('\0')[0] + '\0';
  const values = written.get(kernel);

  for (const key of [...(values?.keys() ?? [])]) {
    if (key.startsWith(prefix)) {
      values!.delete(key);
    }
  }
}

/**
 * Reads an initialisation file, or an empty one if it does not exist.
 *
 * A missing file is not an error: every profile call is defined to fall back
 * to the caller's default, and a program asking about a settings file it has
 * never written is the ordinary case rather than the exceptional one.
 *
 * @param {Object} kernel - The module the call is running in.
 * @param {string} name - The file's name, as the program gave it.
 */
export async function readProfile(kernel, name) {
  const handle = await kernel.dos.files.open(String(name));

  if (!handle) {
    return new Profile('');
  }

  const file = kernel.dos.files.resolve(handle);

  try {
    if (!file || !file.size) {
      return new Profile('');
    }

    const bytes = new Uint8Array(await file.read(0, file.size));

    /* These files are text in the OEM code page. Nothing here needs more than
     * the low half of it, and reading it as Latin-1 keeps every byte
     * addressable rather than replacing the ones we cannot name.
     */
    let text = '';

    for (const byte of bytes) {
      text += String.fromCharCode(byte);
    }

    return new Profile(text);
  } finally {
    kernel.dos.files.close(handle);
  }
}

/**
 * Writes an initialisation file back.
 *
 * @param {Object} kernel - The module the call is running in.
 * @param {string} name - The file's name, as the program gave it.
 * @param {Profile} profile - The file's new contents.
 */
export async function writeProfile(kernel, name, profile) {
  const handle = await kernel.dos.files.open(String(name));

  if (!handle) {
    return false;
  }

  const file = kernel.dos.files.resolve(handle);

  try {
    if (!file) {
      return false;
    }

    const text = profile.text;
    const bytes = new Uint8Array(text.length);

    for (let at = 0; at < text.length; at++) {
      bytes[at] = text.charCodeAt(at) & 0xff;
    }

    await file.write(0, bytes);

    /* Rewriting an entry in place usually leaves the file shorter than it was,
     * and what followed the end is still on the disk. Truncating is what makes
     * the next read see the file we meant to write.
     */
    if (file.size > bytes.length && file.setSize) {
      await file.setSize(bytes.length);
    }

    return true;
  } finally {
    kernel.dos.files.close(handle);
  }
}

/**
 * Copies a string into the caller's buffer and reports what it copied.
 *
 * The buffer size counts the terminating null, so a string that exactly fills
 * it loses its last character. The count returned does not count the null,
 * which means a truncated answer reports one less than the buffer size and a
 * caller has no direct way to tell truncation from an answer that happened to
 * fit -- which is the API as specified, not an accident here.
 *
 * @param {Object} kernel - The module the call is running in.
 * @param {number} pointer - Far pointer to the caller's buffer.
 * @param {string} text - What to copy.
 * @param {number} size - The buffer's size in bytes, including the null.
 */
export function copyOut(kernel, pointer, text, size) {
  const cpu = kernel.machine.cpu.core;

  const segment = (pointer >> 16) & 0xffff;
  const offset = pointer & 0xffff;

  if (!size) {
    return 0;
  }

  const count = Math.min(text.length, size - 1);

  for (let at = 0; at < count; at++) {
    cpu.write8(segment, offset + at, text.charCodeAt(at) & 0xff);
  }

  cpu.write8(segment, offset + count, 0);

  return count;
}

/**
 * Copies a list of names into the caller's buffer, the way the API returns one.
 *
 * A program that asks for a section's contents rather than one entry gets the
 * names one after another, each with its own null, and a second null closing
 * the list. The count returned excludes only that final null.
 *
 * @param {Object} kernel - The module the call is running in.
 * @param {number} pointer - Far pointer to the caller's buffer.
 * @param {string[]} names - The names to copy.
 * @param {number} size - The buffer's size in bytes.
 */
export function copyOutList(kernel, pointer, names, size) {
  const cpu = kernel.machine.cpu.core;

  const segment = (pointer >> 16) & 0xffff;
  const offset = pointer & 0xffff;

  if (!size) {
    return 0;
  }

  /* Built as one string with the separators already in it, so the list is laid
   * out once and the truncation rule has only one place to be wrong.
   */
  let text = '';

  for (const name of names) {
    text += `${name}\0`;
  }

  /* Two bytes are held back rather than one. Windows keeps room for the null
   * that closes the list *and* for the one that ends the name before it, so a
   * six-byte buffer asked for `only` returns four and holds `onl\0\0` -- one
   * less than the single-string form would give for the same room.
   */
  const count = Math.min(text.length, size - 2);

  for (let at = 0; at < count; at++) {
    cpu.write8(segment, offset + at, text.charCodeAt(at) & 0xff);
  }

  /* A truncated list still ends in a terminated name: asked for `only` with
   * six bytes of room, Windows answers `onl\0\0` rather than `only\0`. So the
   * last byte of what was copied is a null whether it started as one or not,
   * and a name loses a character rather than its terminator.
   */
  if (count > 0) {
    cpu.write8(segment, offset + count - 1, 0);
  }

  cpu.write8(segment, offset + count, 0);

  /* The count excludes the closing null but includes the one after each name,
   * so a section holding just `only` reports five. Recorded rather than
   * reasoned about: see `oracle/probes/profile.c`.
   */
  return count;
}

/**
 * Reads an entry as a number, the way the `*ProfileInt` calls do.
 *
 * This is not `atoi`, and it is not the string lookup with a conversion on the
 * end either. All three of its edges were recorded rather than reasoned about,
 * and two of them are the opposite of what the documentation suggests:
 *
 * * It stops at the first character that is not a digit and keeps what it has,
 *   so `40two` is 40.
 * * It does read a leading minus, and the result is a `UINT`, so `-1` comes
 *   back as 65535 rather than as zero.
 * * It does *not* remove quotes, though the string form does. `"7"` begins
 *   with a character that is not a digit, so it is zero.
 *
 * A value that yields no digits at all is zero; the default is only for an
 * entry that is not there, which is a different thing.
 *
 * @param {string|null} value - The entry's value, or `null` if it is absent.
 * @param {number} fallback - What to return when there is no usable value.
 */
export function toInteger(value, fallback) {
  if (value === null) {
    return fallback;
  }

  const match = /^\s*(-?)(\d+)/.exec(value);

  if (!match) {
    return 0;
  }

  const magnitude = Number(match[2]);

  return (match[1] ? -magnitude : magnitude) & 0xffff;
}
