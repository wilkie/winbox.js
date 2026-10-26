'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';

import { decodeIcon, iconEntries, pickIcon } from '../../raster/icon.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { GetDOSEnvironment } from '../kernel/GetDOSEnvironment.js';
import { readProfile } from '../kernel/profiles.js';
import { resourcesOf } from '../ne-resources.js';
import { iconBlock } from '../user/icon-block.js';
import { LoadIcon } from '../user/icon-api.js';
import { GetModuleFilename } from '../kernel/GetModuleFilename.js';
import { scaleIcon } from '../user/driver-resources.js';
import { WinExec } from '../kernel/WinExec.js';
import { searchFile, taskDirectory } from '../kernel/search.js';
import { queryValue } from './reg-api.js';
import { progmanFile } from '../progman/stored.js';
import { chdir } from '../../dos/syscall/directory.js';
import { selectDisk } from '../../dos/syscall/selectDisk.js';

/**
 * SHELL's calls about programs and their files: the environment's
 * variables in a string, the program that opens a file, and a program's
 * icons. **Read out of `SHELL.DLL`** and **recorded** by `shell2`.
 */

const HKEY_CLASSES_ROOT = 1;
const RT_ICON = 3;
const RT_GROUP_ICON = 14;

function core(system: any) {
  return system.machine.cpu.core;
}

function readString(system: any, far: number) {
  let text = '';

  for (let at = far & 0xffff; ; at = (at + 1) & 0xffff) {
    const byte = core(system).read8(far >>> 16, at);

    if (!byte) {
      return text;
    }

    text += String.fromCharCode(byte);
  }
}

function writeString(system: any, far: number, text: string) {
  for (let i = 0; i <= text.length; i++) {
    core(system).write8(
      far >>> 16,
      ((far & 0xffff) + i) & 0xffff,
      i < text.length ? text.charCodeAt(i) & 0xff : 0
    );
  }
}

/** The task's environment, `NAME=value` each (see `task-environment.ts`). */
function environment(system: any): string[] {
  const far = GetDOSEnvironment.call(system) >>> 0;
  const entries: string[] = [];

  for (let at = far & 0xffff; ;) {
    const entry = readString(system, ((far & 0xffff0000) | at) >>> 0);

    if (!entry) {
      return entries;
    }

    entries.push(entry);
    at = (at + entry.length + 1) & 0xffff;
  }
}

/**
 * A variable's value, or null: the whole name before its `=`, without regard
 * to case; an entry with no `=` has an empty value (seg5 `0000`).
 */
function variable(system: any, name: string): string | null {
  for (const entry of environment(system)) {
    const eq = entry.indexOf('=');
    const key = eq < 0 ? entry : entry.slice(0, eq);

    if (key.length === name.length && key.toUpperCase() === name.toUpperCase()) {
      return eq < 0 ? '' : entry.slice(eq + 1);
    }
  }

  return null;
}

/**
 * A string's `%NAME%`s replaced by the environment's values. **Read out**
 * (seg5 `00ae`): a name not there is left as it is; `%%` is one `%`; a `%`
 * with no name after it stays. It answers 1 in the high word and the length
 * in the low when the result and its nought fit the size given, and nought
 * and the string's own length otherwise, the string as it was.
 *
 * @param {Types.FARPTR} lpszSrc - The string, replaced in place.
 * @param {Types.UINT} cchSrc - Its buffer's size.
 *
 * @returns {Types.DWORD} Whether it fitted, and the length.
 */
export function DoEnvironmentSubst(this: any, lpszSrc: number, cchSrc: number) {
  const source = readString(this, lpszSrc >>> 0);
  let out = '';
  let start = -1;
  let startOut = 0;

  for (let at = 0; at < source.length && out.length < 0x100; at++) {
    const ch = source[at];

    if (ch !== '%') {
      out += ch;
      continue;
    }

    if (start < 0) {
      start = at;
      startOut = out.length;
      out += ch;
      continue;
    }

    /* `%%`: the one already written. */
    if (at === start + 1) {
      start = -1;
      continue;
    }

    const value = variable(this, source.slice(start + 1, at));

    if (value === null) {
      out += ch;
    } else {
      if (value.length > 0x100 - (startOut + 1)) {
        writeString(this, lpszSrc >>> 0, source.slice(0, at));
        return at & 0xffff;
      }

      out = out.slice(0, startOut) + value;
    }

    start = -1;
  }

  if (out.length >= (cchSrc & 0xffff)) {
    return source.length & 0xffff;
  }

  writeString(this, lpszSrc >>> 0, out);

  return ((1 << 16) | out.length) >>> 0;
}

/**
 * A variable's value, as a pointer into the environment, or null (seg5 `0000`).
 *
 * @param {Types.FARPTR} lpszName - The name.
 *
 * @returns {Types.FARPTR} Its value.
 */
export function FindEnvironmentString(this: any, lpszName: number) {
  const name = readString(this, lpszName >>> 0);
  const far = GetDOSEnvironment.call(this) >>> 0;
  let at = far & 0xffff;

  for (const entry of environment(this)) {
    const eq = entry.indexOf('=');
    const key = eq < 0 ? entry : entry.slice(0, eq);

    if (key.toUpperCase() === name.toUpperCase()) {
      return ((far & 0xffff0000) | ((at + (eq < 0 ? entry.length : eq + 1)) & 0xffff)) >>> 0;
    }

    at += entry.length + 1;
  }

  return 0;
}

/** Whether a file is there. */
async function exists(system: any, path: string) {
  const handle = await system.dos.files.open(path);

  if (!handle) {
    return false;
  }

  system.dos.files.close(handle);

  return true;
}

/** Whether a directory is there. */
async function directoryExists(system: any, path: string) {
  try {
    await system.files.list(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a file is, as `OpenFile` finds it: a path as given; or a name where
 * KERNEL looks (`search.ts`), the directory given first -- else the current
 * one, the task's own, where `WinExec` finds a program by its name alone
 * (`curdir`) -- and the running task's program's directory fourth
 * (**recorded** by `search`); or the DOS error, 2 for no file and 3 for no
 * path.
 */
export async function locate(
  system: any,
  name: string,
  directory: string
): Promise<{ path: string } | { error: number }> {
  if (/[\\:]/.test(name)) {
    const slash = Math.max(name.lastIndexOf('\\'), name.lastIndexOf(':'));
    const folder = name.slice(0, slash + (name[slash] === ':' ? 1 : 0)) || '\\';

    if (await exists(system, name)) {
      return { path: name };
    }

    return { error: (await directoryExists(system, folder)) ? 2 : 3 };
  }

  return searchFile(system, name, taskDirectory(system), directory || undefined);
}

/** WIN.INI's `[windows]` `Programs=`: the extensions of programs. */
async function programExtensions(system: any) {
  const profile = await readProfile(system, 'WIN.INI');

  return String(profile.get('windows', 'Programs') ?? 'exe com bat pif')
    .split(/ +/)
    .filter(Boolean)
    .map((each) => each.toUpperCase());
}

/**
 * The command that opens a file, or the error (seg4 `082e`): the file
 * found; itself if it is a program; else the registration database's
 * `.EXT`'s class's `shell\open\command`, `%1` its path; else `WIN.INI`'s
 * `[extensions]`, each `^` its path less the extension.
 */
async function commandFor(
  system: any,
  file: string,
  directory: string,
  verb = 'open',
  parameters = ''
): Promise<{ command: string } | { error: number }> {
  const isOpen = verb.toUpperCase() === 'OPEN';
  const name = file.toUpperCase();
  const part = name.slice(Math.max(name.lastIndexOf('\\'), name.lastIndexOf(':')) + 1);
  const dot = part.lastIndexOf('.');
  let extension = dot >= 0 ? part.slice(dot + 1, dot + 4) : '';
  const programs = await programExtensions(system);
  let path: string;

  if (extension) {
    const found = await locate(system, name, directory.toUpperCase());

    if ('error' in found) {
      return found;
    }

    path = found.path;
  } else {
    let found: string | null = null;

    for (const each of programs) {
      const tried = await locate(system, `${name}.${each}`, directory.toUpperCase());

      if ('path' in tried) {
        found = tried.path;
        extension = each;
        break;
      }
    }

    if (!found) {
      return { error: 2 };
    }

    path = found;
  }

  if (programs.includes(extension)) {
    return isOpen ? { command: `${path} ${parameters}` } : { error: 31 };
  }

  let hadClass = false;
  const klass = await queryValue(system, HKEY_CLASSES_ROOT, `.${extension}`);

  if ('error' in klass) {
    if (klass.error === 6) {
      return { error: 8 };
    }

    if (klass.error !== 2) {
      return { error: 27 };
    }
  } else {
    hadClass = true;

    const key = `${klass.value ? `${klass.value}\\` : ''}shell\\${verb}\\command`;
    const command = await queryValue(system, HKEY_CLASSES_ROOT, key);

    if ('error' in command && command.error !== 2) {
      return { error: 8 };
    }

    if ('value' in command && command.value) {
      /* `%1` the file's path, and `%2` on the parameters' words (seg4 `03d8`). */
      const words = parameters.split(/ +/).filter(Boolean);

      return {
        command: command.value.replace(/%([0-9])/g, (_, digit) =>
          digit === '0' || digit === '1' ? path : (words[Number(digit) - 2] ?? '')
        ),
      };
    }
  }

  const profile = await readProfile(system, 'WIN.INI');
  const entry = isOpen ? (profile.get('extensions', extension) ?? '') : '';

  if (!entry) {
    return { error: hadClass ? 27 : 31 };
  }

  const stem = path.replace(/\.[^.\\:]*$/, '');

  return { command: entry.replace(/\^/g, stem) };
}

/**
 * The program that opens a file. **Read out** (seg4 `1154`) and
 * **recorded**: it answers 1000 and the program's name as the association
 * writes it, cut at its first space -- or for a program, its own path --
 * and else an error, the result emptied: 2 for no file, 3 for no path, 31
 * for no association.
 *
 * @param {Types.LPCSTR} lpszFile - The file.
 * @param {Types.LPCSTR} lpszDir - Where to look first, or none.
 * @param {Types.FARPTR} lpszResult - Where the program goes.
 *
 * @returns {Types.HINSTANCE} 1000, or the error.
 */
export async function FindExecutable(
  this: any,
  lpszFile: string,
  lpszDir: string | null,
  lpszResult: number
) {
  writeString(this, lpszResult >>> 0, '');

  const found = await programFor(this, String(lpszFile ?? ''), String(lpszDir ?? '').trim());

  if (typeof found === 'number') {
    return found;
  }

  writeString(this, lpszResult >>> 0, found);

  return 1000;
}

/** The program `FindExecutable` names for a file, or its error. */
async function programFor(system: any, file: string, directory: string) {
  const found = await commandFor(system, file, directory);

  if ('error' in found) {
    return found.error;
  }

  return found.command.split(' ')[0] || 2;
}

/**
 * Where a name's extension starts, after its last `.` that comes after its
 * last `\`; null where it has none. **Read out**: `SHELL.DLL` seg10 `0884`.
 */
function extensionOf(name: string) {
  for (let at = name.length; at >= 0; at--) {
    if (name[at] === '.') {
      return at + 1;
    }

    if (name[at] === '\\') {
      return null;
    }
  }

  return null;
}

/**
 * The icon for an item: the file's own, or its program's, or one of the
 * caller's. **Read out** (`SHELL.DLL` seg10 `08dc`) and **recorded** by
 * `associco`:
 *
 * - `ExtractIcon` of the path at the index (seg10 `08ea`). An icon answers.
 * - Answered 1 -- a file that is not a program -- the program
 *   `FindExecutable` names for it, the directory left out (`0944`): with
 *   none, the caller's icon 6 where the name has an extension, else its
 *   icon 2 (`0949`-`095d`). With one, that program written over the path,
 *   `.EXE` after it where it has no extension of its own (`0960`-`0988`),
 *   and `ExtractIcon` of it at the same index: 1 again is the caller's
 *   icon 6, nought its icon 2.
 * - Answered nought -- no file, or no icon at that index -- the caller's
 *   icon 2 (`0904`).
 *
 * The caller's icon is its module's resource, by number, loaded with
 * `LoadIcon` from the instance passed; its module's path is written over
 * the path (`GetModuleFileName`, 128 bytes) and the index set to 6 for
 * icon 2, 1 for icon 6 (`090d`-`0924`, `09af`-`09cf`).
 *
 * @param {Types.HINSTANCE} hinst - Whose icons are the fallback.
 * @param {Types.FARPTR} lpIconPath - The file; the path used, written back.
 * @param {Types.FARPTR} lpiIcon - The icon's index; the index used, written back.
 *
 * @returns {Types.HICON} The icon, or nought.
 */
export async function ExtractAssociatedIcon(
  this: any,
  hinst: number,
  lpIconPath: number,
  lpiIcon: number
) {
  const far = lpIconPath >>> 0;
  const index = core(this).read16(lpiIcon >>> 16, lpiIcon & 0xffff);
  const caller = (written: number, id: number) => {
    GetModuleFilename.call(this, hinst, far, 0x80);
    core(this).write16(lpiIcon >>> 16, lpiIcon & 0xffff, written);

    return LoadIcon.call(this, hinst, id);
  };

  let icon = await ExtractIcon.call(this, hinst, readString(this, far), index);

  if (icon === 1) {
    const path = readString(this, far);
    const program = await programFor(this, path, '');

    if (typeof program === 'number') {
      return extensionOf(path) === null ? caller(6, 2) : caller(1, 6);
    }

    writeString(this, far, extensionOf(program) === null ? `${program}.EXE` : program);
    icon = await ExtractIcon.call(this, hinst, readString(this, far), index);

    if (icon === 1) {
      return caller(1, 6);
    }
  }

  return icon === 0 ? caller(6, 2) : icon;
}

/**
 * Opens a file with its program, or starts a program. **Read out** (seg4
 * `082e`, the body `FindExecutable` shares) and **recorded** by `shellex`:
 * the command is found as `FindExecutable` finds it, for the verb given --
 * `open` when none -- and started by `WinExec`: a program with the
 * parameters after it, a text file with Notepad. Another verb for a
 * program, or a file with no association, answers 31.
 *
 * A directory given is the current one while the program is found and
 * started, so that it starts there, and the drive and directory current
 * before are current again after (`enterDirectory`).
 *
 * Not followed: an association that asks for DDE.
 *
 * @param {Types.HWND} _hwnd - The window to report to.
 * @param {Types.LPCSTR} lpszOp - The verb, or none for `open`.
 * @param {Types.LPCSTR} lpszFile - The file.
 * @param {Types.LPCSTR} lpszParams - What a program is given.
 * @param {Types.LPCSTR} lpszDir - Where to look first.
 * @param {Types.INT} fsShowCmd - How to show it.
 *
 * @returns {Types.HINSTANCE} The program's instance, or an error below 32.
 */
export async function ShellExecute(
  this: any,
  _hwnd: number,
  lpszOp: string | null,
  lpszFile: string | null,
  lpszParams: string | null,
  lpszDir: string | null,
  fsShowCmd: number
) {
  /* A program's string comes as a `String` with its address, WinBox's own
   * Program Manager's as text: either is a directory given. */
  const saved =
    lpszDir !== null && lpszDir !== undefined ? await enterDirectory(this, String(lpszDir)) : null;

  try {
    const found = await commandFor(
      this,
      String(lpszFile ?? ''),
      String(lpszDir ?? '').trim(),
      lpszOp ? String(lpszOp) : 'open',
      String(lpszParams ?? '')
    );

    if ('error' in found) {
      return found.error;
    }

    return await WinExec.call(this, found.command, fsShowCmd);
  } finally {
    if (saved) {
      this.dos.files.drive = saved.drive;
      this.dos.files._pwd[saved.drive] = saved.path;
    }
  }
}

/**
 * **Read out** (`SHELL.DLL` seg4 `093c`-`098a`, `107a`-`1088`): a directory
 * given to `ShellExecute`, past its leading spaces, made current before
 * anything else is done -- its drive selected where it names one (DOS 0Eh,
 * its letter less `a`, a capital's made small; seg1 `00f9`) and the rest,
 * where there is any, made that drive's directory (DOS 3Bh) -- once the
 * drive and directory current are kept (seg1 `00b0`, DOS 47h); those made
 * current again as it returns. A directory that is not there changes
 * nothing. What was current, where a directory is given. As `programs.rs`'s
 * `enter_directory`.
 */
async function enterDirectory(system: any, given: string) {
  const directory = given.replace(/^ +/, '');

  if (!directory) {
    return null;
  }

  const files = system.dos.files;
  const saved = { drive: files.drive, path: files._pwd[files.drive] ?? `${files.drive}:\\` };
  let rest = directory;

  if (directory[1] === ':') {
    const letter = directory.charCodeAt(0) & 0xff;
    const index = (letter < 0x61 ? letter - 0x61 + 0x20 : letter - 0x61) & 0xff;

    selectDisk.call(system.dos, index);
    rest = directory.slice(2);
  }

  if (rest) {
    try {
      await chdir.call(system.dos, rest);
    } catch {
      /* Not there: nothing changed. */
    }
  }

  return saved;
}

/**
 * An icon file's icon, as `ExtractIcon` makes it for index nought.
 * **Read out** (`SHELL.DLL` seg10 `0360`-`04ea`): its entries, ten at most
 * (`039c`-`03aa`), each read as 16 bytes -- one come short ends it with no
 * icon (`03e5`-`03ef`) -- are made a group's directory, 14 bytes an entry and
 * its number the entry's place counted from one (`03f2`-`0437`); the icon
 * for the display picked from it as from a program's group (`044c`), and
 * its image, where the entry says it is in the file, made the icon
 * (`0474`-`04b4`). **Recorded**: Widget Workshop's installer asks Program
 * Manager for an item whose icon is `WIDGET.ICO`, and the group Windows
 * wrote holds that icon, at index nought (`widget-windows.json`). None
 * where it cannot be read.
 */
function iconFileIcon(system: any, bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.min(view.getUint16(4, true), 10);
  const group = new Uint8Array(6 + count * 14);

  group.set(bytes.subarray(0, 6));
  new DataView(group.buffer).setUint16(4, count, true);

  for (let at = 0; at < count; at++) {
    const from = 6 + at * 16;

    if (from + 16 > bytes.length) {
      return null;
    }

    group.set(bytes.subarray(from, from + 12), 6 + at * 14);
    new DataView(group.buffer).setUint16(6 + at * 14 + 12, at + 1, true);
  }

  const entry = pickIcon(iconEntries(group), 32, system.display?.colors ?? 16);

  if (!entry) {
    return null;
  }

  const from = 6 + (entry.id - 1) * 16;
  const size = view.getUint32(from + 8, true);
  const offset = view.getUint32(from + 12, true);

  if (offset + size > bytes.length) {
    return null;
  }

  const palette = DevicePalette.forDisplay(system.display);

  return (
    iconBlock(system, scaleIcon(decodeIcon(bytes.subarray(offset, offset + size), palette), 32)) ??
    null
  );
}

/**
 * The icons `InternalExtractIcon` gives (`SHELL.DLL` seg10 `026e`-`0881`):
 * null where it makes no block -- a file not there, none asked for, or not
 * two bytes to read -- else its words, `count` of them, noughts but those
 * set. The first is 1 for a file that is no Windows program, or nought for
 * -1 (`02ed`-`0301`). An icon file sets the first alone. A program of
 * Windows 3 sets one icon a word from `index` on, each its group's member
 * for the display (`USER`'s `GetIconID`, `071d`) made an icon
 * (`LoadIconHandler`, `07a3`), stopping at the first group there is not
 * (`06ee`-`07c4`); with -1 the first is how many groups it has
 * (`06a3`-`06d4`). An older program sets the first alone (`0812`-`083a`).
 */
async function extractIcons(
  system: any,
  lpszExeName: string,
  iIcon: number,
  count: number
): Promise<number[] | null> {
  const index = (iIcon << 16) >> 16;
  const handle = await system.dos.files.open(String(lpszExeName ?? ''));
  let bytes: Uint8Array;

  if (handle) {
    try {
      const file = system.dos.files.resolve(handle);

      bytes = new Uint8Array(await file.read(0, file.size));
    } finally {
      system.dos.files.close(handle);
    }
  } else {
    /* While WinBox's Program Manager runs, the file it says it is
     * (`progman/stored.ts`). */
    const stored = await progmanFile(system, String(lpszExeName ?? ''));

    if (!stored) {
      return null;
    }

    bytes = stored;
  }

  /* None asked for, or not two bytes to read: no block (seg10 `02a8`,
   * `02b7`-`02c1`). */
  if (!count || bytes.length < 2) {
    return null;
  }

  const words: number[] = new Array(count).fill(0);
  const first = (value: number) => {
    words[0] = value & 0xffff;
    return words;
  };
  const none = index === -1 ? 0 : 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /* A first word of nought is an icon file's (seg10 `084a`, `030e`-`035c`):
   * nought unless the next word, its type, is 1; then -1 answers 1, its one
   * icon, and another index but the first nought. A PIF begins so, and is
   * no icon file: `DOSPRMPT.PIF` answers nought (`pmbare`). */
  if (bytes[0] === 0 && bytes[1] === 0) {
    if (bytes.length < 6 || view.getUint16(2, true) !== 1) {
      return first(0);
    }

    if (index !== 0) {
      return first(index === -1 ? 1 : 0);
    }

    return first(iconFileIcon(system, bytes) ?? 0);
  }

  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return first(none);
  }

  const ne = view.getUint32(0x3c, true);

  if (!ne || ne + 0x40 > bytes.length || view.getUint16(ne, true) !== 0x454e) {
    return first(none);
  }

  if (![0, 2, 4].includes(bytes[ne + 0x36])) {
    return first(none);
  }

  if (view.getUint16(ne + 0x24, true) === view.getUint16(ne + 0x26, true)) {
    return first(0);
  }

  const modern = view.getUint16(ne + 0x3e, true) >= 0x300;
  const resources = resourcesOf(bytes);
  const groups = resources.filter((each) => each.type === (modern ? RT_GROUP_ICON : RT_ICON));

  if (index === -1) {
    return first(groups.length);
  }

  const palette = DevicePalette.forDisplay(system.display);
  const iconOf = (group: any) => {
    let image = group.data;

    if (modern) {
      const entry = pickIcon(iconEntries(group.data), 32, system.display?.colors ?? 16);
      const icon = resources.find((each) => each.type === RT_ICON && each.id === entry?.id);

      if (!icon) {
        return 0;
      }

      image = icon.data;
    }

    return iconBlock(system, scaleIcon(decodeIcon(image, palette), 32)) ?? 0;
  };

  for (let at = 0; at < (modern ? count : 1); at++) {
    const group = groups[index + at];

    if (!group) {
      break;
    }

    words[at] = iconOf(group) & 0xffff;
  }

  return words;
}

/**
 * A program's icon, by its place among the icons, or with -1 how many it
 * has: `InternalExtractIcon` of one, its word, the block freed (`SHELL.DLL`
 * seg10 `021a`-`026a`). **Recorded**: a file not there answers nought; a
 * file that is no Windows program answers 1, or for -1 nought; an index
 * past the last answers nought. The icons are counted in the order of the
 * resource table, and the image is the one for the display.
 *
 * @param {Types.HINSTANCE} hinst - The caller.
 * @param {Types.LPCSTR} lpszExeName - The program.
 * @param {Types.UINT} iIcon - Which, or -1.
 *
 * @returns {Types.HICON} The icon, a count, 1, or nought.
 */
export async function ExtractIcon(this: any, _hinst: number, lpszExeName: string, iIcon: number) {
  return (await extractIcons(this, lpszExeName, iIcon, 1))?.[0] ?? 0;
}

/**
 * Icons of a file, a block of `nIcons` words (`SHELL.DLL` seg10
 * `026e`-`0881`, `extractIcons`): fixed, its words noughts but those set;
 * nought where none is made.
 */
/** `GMEM_ZEROINIT`, fixed (seg10 `02c4`). */
const GMEM_ZEROINIT = 0x0040;

export async function InternalExtractIcon(
  this: any,
  _hinst: number,
  lpszExeName: string,
  iIcon: number,
  nIcons: number
) {
  const words = await extractIcons(this, lpszExeName, iIcon, nIcons & 0xffff);

  if (!words) {
    return 0;
  }

  const handle = GlobalAlloc.call(this, GMEM_ZEROINIT, words.length * 2);

  if (!handle) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const selector = handle | 1;

  words.forEach((word, at) => core.write16(selector, at * 2, word));

  return handle;
}
