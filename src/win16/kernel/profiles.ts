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

/** A file as KERNEL holds it: its whole path, upper case, its contents, the
 * stamp DOS gave the file as KERNEL last opened it, and the DOS calls there
 * had been as it was last written. */
interface Held {
  path: string;
  profile: Profile;
  stamp: number | null;
  written: number | null;
}

/**
 * What KERNEL holds of the profiles: one buffer for `WIN.INI` and one for a
 * private file (`KRNL386.EXE` seg1 `636b`: `WIN.INI` is `ds:03e4`, any other
 * `ds:047e`). **Read out**, and **recorded** by `profhold`:
 *
 * - A file read or written stays held. Another private file's name lets the
 *   private one go (`63e7`-`6438`, `6b33`), its path compared whole, a name
 *   without one in Windows' directory; `WIN.INI` does not.
 * - Every DOS call sets a flag (`1b68`). A profile call that finds the flag
 *   set and its file held looks at the file's date and time (DOS function
 *   4Eh, `630f`-`635b`), and lets the buffer go where they are not what
 *   KERNEL opened the file with (`6b33`); then clears the flag.
 * - A buffer written goes to the disk at the next DOS call (`1b6d`-`1b8c`,
 *   `WriteOutProfiles` `708b`), the file opened again first (`70a7`): what
 *   KERNEL keeps is the stamp from before the write. So a write is seen as a
 *   change once two of DOS's seconds have passed, and a value's leading
 *   spaces, which loading the file trims, last until then. Here the file is
 *   written at once, and the DOS calls that writes make are not counted:
 *   writes with no DOS call between are one write-out, and keep the stamp
 *   from before the first.
 */
interface Profiles {
  windows: Held | null;
  private: Held | null;
  /** The DOS calls there had been as the flag was last cleared. */
  seen: number;
}

const held = new WeakMap<object, Profiles>();

function profilesOf(kernel): Profiles {
  let profiles = held.get(kernel);

  if (!profiles) {
    profiles = { windows: null, private: null, seen: 0 };
    held.set(kernel, profiles);
  }

  return profiles;
}

/** Whether a name is `WIN.INI`'s, which KERNEL holds apart. */
function isWindows(name) {
  return (
    String(name).toUpperCase() === WINDOWS_PROFILE ||
    pathOf(name).toUpperCase() === `C:\\WINDOWS\\${WINDOWS_PROFILE}`
  );
}

/** The stamp DOS gives a file now, its time and date as one number; null
 * for a file not there. */
async function stampOf(kernel, path: string) {
  const files = kernel.dos.files;
  const handle = await files.open(path);

  if (!handle) {
    return null;
  }

  const info = files.resolve(handle)?.info;

  files.close(handle);

  if (!info?.time || !info.date) {
    return null;
  }

  const time = (info.time.hour << 11) | (info.time.minute << 5) | (info.time.second >> 1);
  const date = ((info.date.year - 1980) << 9) | (info.date.month << 5) | info.date.day;

  return date * 0x10000 + time;
}

/** The buffer a file's profile call works on, where KERNEL still holds one
 * (`Profiles`). */
async function heldProfile(kernel, name) {
  const profiles = profilesOf(kernel);
  const path = pathOf(name).toUpperCase();
  const windows = isWindows(name);

  if (!windows && profiles.private && profiles.private.path !== path) {
    profiles.private = null;
  }

  const holding = windows ? profiles.windows : profiles.private;

  if (holding && kernel.dos.files.activity !== profiles.seen) {
    if ((await stampOf(kernel, holding.path)) !== holding.stamp) {
      if (windows) {
        profiles.windows = null;
      } else {
        profiles.private = null;
      }
    }

    profiles.seen = kernel.dos.files.activity;
  }

  return windows ? profiles.windows : profiles.private;
}

/** A file's buffer kept as KERNEL keeps it, with the stamp it was opened with. */
export function holdProfile(kernel, name, profile: Profile, stamp: number | null = null) {
  const profiles = profilesOf(kernel);
  const holding = { path: pathOf(name).toUpperCase(), profile, stamp, written: null };

  if (isWindows(name)) {
    profiles.windows = holding;
  } else {
    profiles.private = holding;
  }
}

/** Lets a file's buffer go: what a flush does, so the next read is of the disk. */
export async function releaseProfile(kernel, name) {
  const profiles = profilesOf(kernel);

  await heldProfile(kernel, name);

  if (isWindows(name)) {
    profiles.windows = null;
  } else {
    profiles.private = null;
  }
}

/**
 * Where a file named to the profile calls is: a name with no path is in the
 * Windows directory, wherever the program runs from; one with a path is
 * where it says. **Recorded** by `profnew`, whose `PROFNEW.INI` is written
 * to `C:\WINDOWS` though the probe runs in `C:\ORACLE`.
 */
function pathOf(name) {
  const given = String(name);

  return /[\\/:]/.test(given) ? given : `C:\\WINDOWS\\${given}`;
}

/**
 * Reads an initialisation file, or an empty one if it does not exist; a file
 * read is held from then on (`Profiles`).
 *
 * A missing file is not an error: every profile call is defined to fall back
 * to the caller's default, and a program asking about a settings file it has
 * never written is the ordinary case rather than the exceptional one.
 *
 * @param {Object} kernel - The module the call is running in.
 * @param {string} name - The file's name, as the program gave it.
 */
export async function readProfile(kernel, name) {
  const holding = await heldProfile(kernel, name);

  if (holding) {
    return holding.profile;
  }

  const handle = await kernel.dos.files.open(pathOf(name));

  if (!handle) {
    return new Profile('');
  }

  const file = kernel.dos.files.resolve(handle);
  let text = '';

  try {
    if (file && file.size) {
      const bytes = new Uint8Array(await file.read(0, file.size));

      /* These files are text in the OEM code page. Nothing here needs more
       * than the low half of it, and reading it as Latin-1 keeps every byte
       * addressable rather than replacing the ones we cannot name.
       */
      for (const byte of bytes) {
        text += String.fromCharCode(byte);
      }
    }
  } finally {
    kernel.dos.files.close(handle);
  }

  const profile = new Profile(text);

  holdProfile(kernel, name, profile, await stampOf(kernel, pathOf(name)));

  return profile;
}

/**
 * Writes an initialisation file back, and holds it as written (`Profiles`),
 * with the stamp the file had before, or a file made its own.
 *
 * @param {Object} kernel - The module the call is running in.
 * @param {string} name - The file's name, as the program gave it.
 * @param {Profile} profile - The file's new contents.
 */
export async function writeProfile(kernel, name, profile) {
  const profiles = profilesOf(kernel);
  const path = pathOf(name);
  const files = kernel.dos.files;
  const before = isWindows(name) ? profiles.windows : profiles.private;
  const unwritten =
    before && before.written === files.activity && before.path === path.toUpperCase()
      ? before
      : null;
  const stamp = await stampOf(kernel, path);

  /* A file not there is made, with the one section written (`profnew`):
   * FIBS/W writes its first settings so, and sizes its window from them. */
  const handle = (await files.open(path)) ?? (await files.create(path));

  if (!handle) {
    return false;
  }

  const file = files.resolve(handle);

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
  } finally {
    files.close(handle);
  }

  holdProfile(
    kernel,
    name,
    profile,
    unwritten ? unwritten.stamp : (stamp ?? (await stampOf(kernel, path)))
  );
  profiles.seen = files.activity;
  (isWindows(name) ? profiles.windows : profiles.private)!.written = profiles.seen;

  return true;
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
