'use strict';

import { decodeIcon, iconEntries, pickIcon } from '../../raster/icon.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { GetDOSEnvironment } from '../kernel/GetDOSEnvironment.js';
import { readProfile } from '../kernel/profiles.js';
import { resourcesOf } from '../ne-resources.js';
import { iconBlock } from '../user/icon-block.js';
import { scaleIcon } from '../user/driver-resources.js';
import { WinExec } from '../kernel/WinExec.js';
import { queryValue } from './reg-api.js';

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
 * Where a file is, as `OpenFile` finds it: a path as given, or a name in the
 * directory given -- else the current one -- then Windows' and its system
 * directory; or the DOS error, 2 for no file and 3 for no path.
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

  const current = directory || String(system.dos?.currentDirectory?.() ?? 'C:\\WINDOWS');

  for (const place of [current, 'C:\\WINDOWS', 'C:\\WINDOWS\\SYSTEM']) {
    const path = `${place.replace(/\\$/, '')}\\${name}`;

    if (await exists(system, path)) {
      return { path };
    }
  }

  return { error: 2 };
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

  const found = await commandFor(this, String(lpszFile ?? ''), String(lpszDir ?? '').trim());

  if ('error' in found) {
    return found.error;
  }

  const result = found.command.split(' ')[0];

  if (!result) {
    return 2;
  }

  writeString(this, lpszResult >>> 0, result);

  return 1000;
}

/**
 * Opens a file with its program, or starts a program. **Read out** (seg4
 * `082e`, the body `FindExecutable` shares) and **recorded** by `shellex`:
 * the command is found as `FindExecutable` finds it, for the verb given --
 * `open` when none -- and started by `WinExec`: a program with the
 * parameters after it, a text file with Notepad. Another verb for a
 * program, or a file with no association, answers 31.
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

  return WinExec.call(this, found.command, fsShowCmd);
}

/**
 * A program's icon, by its place among the icons, or with -1 how many it
 * has. **Read out** (seg10 `026e`) and **recorded**: a file not there
 * answers nought; a file that is no Windows program answers 1, or for -1
 * nought; an index past the last answers nought. The icons are counted in
 * the order of the resource table, and the image is the one for the display.
 *
 * @param {Types.HINSTANCE} hinst - The caller.
 * @param {Types.LPCSTR} lpszExeName - The program.
 * @param {Types.UINT} iIcon - Which, or -1.
 *
 * @returns {Types.HICON} The icon, a count, 1, or nought.
 */
export async function ExtractIcon(this: any, _hinst: number, lpszExeName: string, iIcon: number) {
  const index = (iIcon << 16) >> 16;
  const handle = await this.dos.files.open(String(lpszExeName ?? ''));

  if (!handle) {
    return 0;
  }

  let bytes: Uint8Array;

  try {
    const file = this.dos.files.resolve(handle);

    bytes = new Uint8Array(await file.read(0, file.size));
  } finally {
    this.dos.files.close(handle);
  }

  const none = index === -1 ? 0 : 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return none;
  }

  const ne = view.getUint32(0x3c, true);

  if (!ne || ne + 0x40 > bytes.length || view.getUint16(ne, true) !== 0x454e) {
    return none;
  }

  if (![0, 2, 4].includes(bytes[ne + 0x36])) {
    return none;
  }

  if (view.getUint16(ne + 0x24, true) === view.getUint16(ne + 0x26, true)) {
    return 0;
  }

  const modern = view.getUint16(ne + 0x3e, true) >= 0x300;
  const resources = resourcesOf(bytes);
  const groups = resources.filter((each) => each.type === (modern ? RT_GROUP_ICON : RT_ICON));

  if (index === -1) {
    return groups.length;
  }

  const group = groups[index];

  if (!group) {
    return 0;
  }

  const palette = DevicePalette.forDisplay(this.display);
  let image = group.data;

  if (modern) {
    const entry = pickIcon(iconEntries(group.data), 32, this.display?.colors ?? 16);
    const icon = resources.find((each) => each.type === RT_ICON && each.id === entry?.id);

    if (!icon) {
      return 0;
    }

    image = icon.data;
  }

  return iconBlock(this, scaleIcon(decodeIcon(image, palette), 32)) ?? 0;
}
