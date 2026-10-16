'use strict';

import {
  B,
  D,
  W,
  api,
  buffer,
  item,
  itemText,
  listText,
  post,
  send,
  sendBytes,
  sendItem,
  setItemText,
  stringOf,
  text,
  word,
} from './api.js';
import {
  CB_FINDSTRING,
  CB_GETCOUNT,
  CB_GETCURSEL,
  CB_GETITEMDATA,
  CB_GETLBTEXT,
  CB_INSERTSTRING,
  CB_RESETCONTENT,
  CB_SETCURSEL,
  CB_SETITEMDATA,
  CMB_DRIVES,
  EDT_NAME,
  IDRETRY,
  IDYES,
  LB_ADDSTRING,
  LB_GETTEXT,
  LB_INSERTSTRING,
  LB_RESETCONTENT,
  LB_SETCURSEL,
  LB_SETTOPINDEX,
  LPSTRDEFEXT,
  LST_FILES,
  LST_FOLDERS,
  MB_DEFBUTTON2,
  MB_ICONEXCLAMATION,
  MB_ICONQUESTION,
  MB_RETRYCANCEL,
  MB_YESNO,
  Ofn,
  PICTURES_HEIGHT,
  PICTURES_WIDTH,
  STC_DIRECTORY,
  TAKE,
  WM_COMMAND,
  WM_DRAWITEM,
  WM_GETFONT,
  WM_NEXTDLGCTL,
  WM_SETREDRAW,
  commdlgState,
  commdlgString,
  filled,
  hasWildcard,
  lower,
  readColorsNow,
  readFar,
  shared,
  terminated,
  writeFar,
} from './file-dialogs.js';
import { addExtension } from './file-ok.js';
import { dialogOf, withDialog } from './file-init.js';
import { parseFile } from './parse-file.js';
import { pictures } from './pictures.js';
import { chdir, directoryOf, volumeLabel } from '../../dos/syscall/directory.js';
import { createNewFile, deleteFile, fileAttributes } from '../../dos/syscall/files.js';
import { searchDirectory } from '../../dos/syscall/find.js';
import { selectDisk } from '../../dos/syscall/selectDisk.js';
import { CreateCompatibleDC } from '../gdi/CreateCompatibleDC.js';
import { DeleteDC } from '../gdi/DeleteDC.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { translateText } from '../keyboard/oem.js';
import { ansiLowerByte, ansiUpperByte } from '../user/ansi.js';

/**
 * The file boxes' lists and drives, DOS as COMMDLG asks it, its message
 * boxes, and its owner-drawn rows (`COMMDLG.DLL` seg2 `039b`, `0180`,
 * `4827`, `4732`, `2107`, `4ae2`, `1a26`, `4dcc`, `4e8a`, and seg1's DOS
 * calls). As `file_lists.rs`.
 */

const DISK_CHANGE = 0x22;
const ATTR_DIRECTORY = 0x10;
/** The refresh's flags: the folders too, and the folders' list's top left at its first row (seg2 `03c7`). */
const WITH_FOLDERS = 0x0010;
const FROM_TOP = 0x4000;

const SRCCOPY = 0x00cc0020;
const ETO_OPAQUE_CLIPPED = 0x0006;
const ODS_SELECTED = 0x0001;
const ODS_FOCUS = 0x0010;

const textOf = (bytes: number[]) => String.fromCharCode(...bytes);
const bytesOf = (value: string) => Array.from(value, (c) => c.charCodeAt(0) & 0xff);

async function translated(system: any, bytes: number[], to: 'oem' | 'ansi') {
  return bytesOf(await translateText(system, textOf(bytes), to));
}

// ---------------------------------------------------------------------
// DOS, as COMMDLG asks it.

/** The current drive, nought for A: (seg1 `2c1d`, DOS 19h). */
export function currentDrive(system: any) {
  return String(system.dos.files.drive).charCodeAt(0) - 0x41;
}

/** A drive selected, where it is there (seg1 `2c37`, DOS 0Eh). */
function setDrive(system: any, drive: number) {
  selectDisk.call(system.dos, drive);
}

/** The current directory, its drive first (seg2 `54c1`, seg1 `2c83`): DOS's error kept where it cannot be read. */
export function currentDirectory(system: any): number[] | null {
  const letter = system.dos.files.drive;

  try {
    const directory = directoryOf(system.dos, letter);

    shared(system).dosError = 0;
    return bytesOf(`${letter}:\\${directory}`);
  } catch (code: any) {
    shared(system).dosError = Number(code) || 0;
    return null;
  }
}

/** A drive selected and read (seg2 `5344`): whether its directory could be had; where not, the drive before is selected again. */
export function driveReady(system: any, letter: number) {
  const before = currentDrive(system);
  const wanted = ((letter | 0x60) - 0x61) & 0xff;

  setDrive(system, wanted);

  if (currentDrive(system) !== wanted) {
    return false;
  }

  if (currentDirectory(system)) {
    return true;
  }

  setDrive(system, before);
  return false;
}

/**
 * The current directory changed (seg2 `53e4`): `oem`, the name made OEM
 * first. Nought, done; 1, its drive could not be read; 2, the directory is
 * not there, and the drive before is selected again; FFFFh, no name.
 */
export async function changeDirectory(system: any, path: number[], oem: boolean) {
  const before = currentDrive(system);

  if (!path.length) {
    return 0xffff;
  }

  let rest = path;

  if (path[1] === 0x3a) {
    if (!driveReady(system, path[0])) {
      return 1;
    }

    rest = path.slice(2);
  }

  if (!rest.length) {
    return 0;
  }

  const name = oem ? await translated(system, rest, 'oem') : rest;

  try {
    await chdir.call(system.dos, textOf(name));
    return 0;
  } catch {
    setDrive(system, before);
    return 2;
  }
}

/** `GetDriveType`. */
export async function driveType(system: any, drive: number) {
  return await word(system, 'KERNEL', 'GetDriveType', [W(drive)]);
}

/** What `OpenFile` made of a name. */
export type Opened = { handle: number; code: number; path: number[] };

/**
 * `OpenFile`, a name with no folder looked for in the current one alone:
 * `.\` put before it (seg2 `0948`). A network path is given as it is.
 */
export async function openQuietly(
  system: any,
  name: number[],
  mode: number,
  network: boolean
): Promise<Opened> {
  const given =
    network || name.some((b) => b === 0x5c || b === 0x2f || b === 0x3a)
      ? name
      : [0x2e, 0x5c, ...name];
  const called = await api(system, 'KERNEL', 'OpenFile', [text(given), buffer(136), W(mode)]);
  const structure = called.buffers[1];

  /* COMMDLG's copy ends at its 128th byte (seg2 `2ad2`). */
  return {
    handle: called.value & 0xffff,
    code: structure[2] | (structure[3] << 8),
    path: terminated(structure.slice(8)).slice(0, 127),
  };
}

/** `_lclose`. */
export async function close(system: any, handle: number) {
  await api(system, 'KERNEL', '_lclose', [W(handle)]);
}

/** A file's attributes (seg1 `2e1b`, DOS 4300h): the error in the high byte, 80h, where it is not there. */
export async function fileAttributesOf(system: any, path: number[]) {
  try {
    return (await fileAttributes.call(system.dos, textOf(path), 0, 0)) & 0xff;
  } catch {
    return 0x8000;
  }
}

/**
 * Whether a file can be made in a path's folder: a temporary file made there
 * and deleted (seg2 `224f`, DOS 5Ah). Nought where it can, or the path is in
 * a drive's root; DOS's error where it cannot.
 */
export async function canCreate(system: any, path: number[]) {
  const copy = [...path, 0];
  const [offset] = parseFile(copy);

  if (offset <= 3) {
    return 0;
  }

  const folder = textOf(copy.slice(0, offset - 1));

  for (let index = 0; ; index++) {
    const name = `${folder}\\WB${index.toString(16).toUpperCase().padStart(6, '0')}`;

    try {
      await fileAttributes.call(system.dos, name, 0, 0);
      continue;
    } catch {
      /* Not there: the name to make. */
    }

    try {
      const handle = await createNewFile.call(system.dos, name, 0);

      system.dos.files.close(handle);

      try {
        await deleteFile.call(system.dos, name);
      } catch {
        /* As made, so gone. */
      }

      return 0;
    } catch (code: any) {
      return Number(code) || 0;
    }
  }
}

/** Whether a name is one of DOS's devices (seg2 `21a8`), a period after its third or fourth character taken off. */
export function reservedName(name: number[]) {
  const DEVICES = [
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'EPT',
    'NUL',
    'PRN',
    'CLOCK$',
    'CON',
    'AUX',
  ];
  let copy = name.slice();

  if (copy[4] === 0x2e) {
    copy = copy.slice(0, 4);
  }

  if (copy[3] === 0x2e) {
    copy = copy.slice(0, 3);
  }

  const upper = textOf(copy).toUpperCase();

  return DEVICES.includes(upper);
}

// ---------------------------------------------------------------------
// The lists.

/**
 * The files' list, and the folders' with `WITH_FOLDERS`, filled for a spec
 * (seg2 `039b`): the edit's name where it is a bare wildcard, else the box's
 * own; each spec of it, between `;`, spaces or tabs, matched by COMMDLG's
 * own matching. The spec is changed as COMMDLG changes it: cut at the
 * separators, its parts capitalised. 1 for a drive read, else nought.
 */
export async function refresh(system: any, hwnd: number, spec: number[] | null, flags: number) {
  const files = await item(system, hwnd, LST_FILES);
  const folders = await item(system, hwnd, LST_FOLDERS);
  const fromTop = flags & FROM_TOP;
  let kept = flags & ~FROM_TOP;
  let answer = 0;

  if (!spec) {
    let own = await itemText(system, hwnd, EDT_NAME, 0xff);
    const bare = !own.some((b) => b === 0x5c || b === 0x2f || b === 0x3a) && hasWildcard(own);

    if (!bare) {
      own = dialogOf(system, hwnd)?.filter.slice() ?? [];
    }

    spec = own;
  }

  /* The spec cut into its parts as `strtok` cuts it, each capitalised and
   * made OEM in place, at most 36 (seg2 `0463`, `0083`). */
  const parts: number[][] = [];
  const isSeparator = (b: number) => b === 0x3b || b === 0x20 || b === 0x09;
  const length = spec.indexOf(0) < 0 ? spec.length : spec.indexOf(0);
  let at = 0;

  while (parts.length < 0x24) {
    while (at < length && isSeparator(spec[at])) {
      at++;
    }

    if (at >= length) {
      break;
    }

    const begin = at;

    while (at < length && !isSeparator(spec[at])) {
      at++;
    }

    if (at < length) {
      spec[at] = 0;
      at++;
    }

    let end = begin;

    while (end < spec.length && spec[end] !== 0) {
      end++;
    }

    const upper = spec.slice(begin, end).map((b) => ansiUpperByte(b));
    const oem = await translated(system, upper, 'oem');

    oem.forEach((b, i) => (spec![begin + i] = b));
    parts.push(oem);
  }

  await send(system, files, WM_SETREDRAW, 0, 0);
  await send(system, files, LB_RESETCONTENT, 0, 0);

  if (kept & WITH_FOLDERS) {
    shared(system).redrawOff = 1;
    await send(system, folders, WM_SETREDRAW, 0, 0);
    await send(system, folders, LB_RESETCONTENT, 0, 0);
  }

  const found = await searchDirectory(system.dos, '*.*', kept & 0xff);

  if (!found) {
    kept = FROM_TOP;
  } else {
    answer = 1;
    kept &= WITH_FOLDERS;

    for (const entry of found) {
      const name = bytesOf(String(entry.name ?? ''));

      if (kept && (entry.attributes ?? 0) & ATTR_DIRECTORY) {
        if (name[0] !== 0x2e) {
          await sendBytes(
            system,
            folders,
            LB_ADDSTRING,
            0,
            text(await translated(system, name, 'ansi'))
          );
        }
      } else if (parts.some((part) => matches(part, name))) {
        await sendBytes(
          system,
          files,
          LB_ADDSTRING,
          0,
          text(await translated(system, name, 'ansi'))
        );
      }
    }
  }

  if (kept) {
    if (kept === WITH_FOLDERS) {
      await fillPath(system, hwnd, folders);
      await api(system, 'USER', 'DlgDirList', [W(hwnd), D(0), W(0), W(STC_DIRECTORY), W(0)]);

      const depth = dialogOf(system, hwnd)?.depth ?? 0;

      await send(system, folders, LB_SETCURSEL, (depth - 1) & 0xffff, 0);
      await send(system, folders, LB_SETTOPINDEX, fromTop ? 0 : Math.max(depth - 2, 0), 0);
    } else {
      await setItemText(system, hwnd, STC_DIRECTORY, []);
    }

    shared(system).redrawOff = 0;
    await send(system, folders, WM_SETREDRAW, 1, 0);

    const rect = (await api(system, 'USER', 'GetWindowRect', [W(folders), buffer(8)])).buffers[0];
    const value = (i: number) => ((rect[i] | (rect[i + 1] << 8)) << 16) >> 16;
    const inset = [value(0) + 1, value(2) + 1, value(4) - 1, value(6) - 1];
    const points: number[] = [];

    for (let i = 0; i < 4; i += 2) {
      const point = [
        inset[i] & 0xff,
        (inset[i] >> 8) & 0xff,
        inset[i + 1] & 0xff,
        (inset[i + 1] >> 8) & 0xff,
      ];
      const back = await api(system, 'USER', 'ScreenToClient', [W(hwnd), B(point)]);

      points.push(...back.buffers[0]);
    }

    await api(system, 'USER', 'InvalidateRect', [W(hwnd), B(points), W(0)]);
  }

  await send(system, files, WM_SETREDRAW, 1, 0);
  await api(system, 'USER', 'InvalidateRect', [W(files), D(0), W(1)]);

  return answer;
}

/**
 * COMMDLG's own match of a name to a spec (seg2 `0283`): `*` and `*.*` match
 * all; a `*` the rest of the name's part, to its period; a `?` any one
 * character, a period too.
 */
function matches(pattern: number[], name: number[]) {
  const asText = textOf(pattern);

  if (asText === '*' || asText === '*.*') {
    return true;
  }

  let p = 0;
  let n = 0;
  const at = (bytes: number[], i: number) => bytes[i] ?? 0;

  while (at(name, n) !== 0 && at(pattern, p) !== 0) {
    const c = at(pattern, p);

    if (c === 0x2a) {
      while (at(pattern, p) !== 0x2e && at(pattern, p) !== 0) {
        p++;
      }

      if (at(pattern, p) === 0x2e) {
        p++;
      }

      while (at(name, n) !== 0x2e && at(name, n) !== 0) {
        n++;
      }

      if (at(name, n) === 0x2e) {
        n++;
      }
    } else if (c === 0x3f) {
      n++;
      p++;
    } else {
      if (c !== at(name, n)) {
        return false;
      }

      p++;
      n++;
    }
  }

  return at(name, n) === 0 && (at(pattern, p) === 0 || at(pattern, p) === 0x2a);
}

/** The current folder's path put at the folders' list's top, a row each (seg2 `0180`): the root, then each folder, as DOS has them. */
async function fillPath(system: any, hwnd: number, folders: number) {
  const path = currentDirectory(system) ?? [];
  const ansi = await translated(system, path, 'ansi');
  const lowered = ansi.map((b) => ansiLowerByte(b));

  withDialog(system, hwnd, (data) => {
    data.scratch = lowered;
    data.depth = 0;
  });

  const root = ansi.indexOf(0x5c);

  if (root < 0) {
    return;
  }

  const rows = [ansi.slice(0, root + 1)];
  let part: number[] = [];

  for (const byte of ansi.slice(root + 1)) {
    if (byte === 0x5c) {
      if (part.length) {
        rows.push(part);
      }

      part = [];
    } else {
      part.push(byte);
    }
  }

  if (part.length) {
    rows.push(part);
  }

  for (const row of rows) {
    const depth = dialogOf(system, hwnd)?.depth ?? 0;

    await sendBytes(system, folders, LB_INSERTSTRING, depth, text(row));
    withDialog(system, hwnd, (data) => data.depth++);
  }
}

/**
 * A spec taken (seg2 `4ae2`): lowered; with a folder before it, the folder
 * gone to and the spec the name; the files' list filled. Nought, or what
 * changing the folder answered. The spec is changed as COMMDLG changes it.
 */
export async function applySpec(system: any, spec: number[], hwnd: number) {
  lower(spec);

  const whole = terminated(spec);
  const last = whole.lastIndexOf(0x5c);
  const initialising = commdlgState(system).initialising;

  if (last < 0 && !whole.includes(0x3a)) {
    withDialog(system, hwnd, (data) => (data.filter = whole.slice()));

    if (!initialising) {
      await refresh(system, hwnd, spec, 0);
    }

    return 0;
  }

  const first = whole.indexOf(0x5c);
  let folder: number[];
  let name: number[];

  /* Only a root, or a drive, before the spec (seg2 `4b87`). */
  const rooted = first === last && (last < 0 || last === 0 || (last === 2 && whole[1] === 0x3a));

  if (rooted) {
    const at = last < 0 ? 2 : last + 1;

    if (whole[at] === 0x2e) {
      folder = whole.slice();

      const ofn = dialogOf(system, hwnd)?.ofn;
      const defext = ofn ? (new Ofn(system, ofn).string(LPSTRDEFEXT) ?? []) : [];
      const appended = whole.slice();

      addExtension(appended, defext, true);
      name = terminated(appended.slice(whole.length));
      spec.splice(0, spec.length, ...appended);
    } else {
      folder = whole.slice(0, at);
      name = whole.slice(at);
    }
  } else {
    folder = whole.slice(0, last);
    name = whole.slice(last + 1);
    spec[last] = 0;
  }

  const answer = await changeDirectory(system, folder, true);

  if (answer) {
    return answer;
  }

  withDialog(system, hwnd, (data) => (data.filter = name.slice()));
  await setItemText(system, hwnd, EDT_NAME, name);
  await selectDrive(system, hwnd, currentDrive(system) + 0x61);

  if (!initialising) {
    const drives = await item(system, hwnd, CMB_DRIVES);

    await send(system, hwnd, WM_COMMAND, CMB_DRIVES, ((TAKE << 16) | drives) >>> 0);
  }

  return 0;
}

/** The name's path taken off, the name alone left (seg2 `30b4`). */
export async function stripPath(system: any, hwnd: number) {
  let typed = await itemText(system, hwnd, EDT_NAME, 0xff);

  if (!typed.length) {
    return;
  }

  typed.push(0);

  const parsed = parseFile(typed);
  let offset = parsed[0];
  const where = parsed[1];

  if (offset < 0) {
    if (typed[where] === 0x3b) {
      typed[where] = 0;
      [offset] = parseFile(typed);
      typed[where] = 0x3b;

      if (offset < 0) {
        typed[0] = 0;
      }
    } else {
      typed[0] = 0;
    }
  }

  if (offset > 0) {
    typed = typed.slice(offset);
  }

  if (offset !== 0) {
    await setItemText(system, hwnd, EDT_NAME, terminated(typed));
  }
}

// ---------------------------------------------------------------------
// The drives.

/**
 * The drives' combo box filled (seg2 `4827`): each drive DOS will select, its
 * letter lowered, and a fixed drive's label after it; each item's data its
 * picture.
 */
export async function fillDrives(system: any, hwnd: number) {
  const combo = await item(system, hwnd, CMB_DRIVES);

  shared(system).redrawOff |= 2;
  await send(system, combo, WM_SETREDRAW, 0, 0);
  await send(system, combo, CB_RESETCONTENT, 0, 0);

  const current = currentDrive(system);
  const drives: number[] = [];

  for (let drive = 0; drive < 26; drive++) {
    if (system.dos.files.query(String.fromCharCode(0x41 + drive))) {
      drives.push(drive);
    }
  }

  for (let index = 0; index < drives.length; index++) {
    const drive = drives[index];
    const letter = 0x41 + drive;
    const kind = await driveType(system, drive);

    if (kind < 2) {
      continue;
    }

    let name = [letter, 0x3a];

    if (kind !== 2 && driveReady(system, letter)) {
      const label = volumeLabel(system.dos, String.fromCharCode(letter)) ?? '';

      name.push(0x20);
      name = [...name, ...(await translated(system, bytesOf(label), 'ansi'))];
    }

    lower(name);
    await sendBytes(system, combo, CB_INSERTSTRING, index, text(name));
    await send(system, combo, CB_SETITEMDATA, index, picture(kind));

    if (drive === current) {
      await send(system, combo, CB_SETCURSEL, index, 0);
    }
  }

  shared(system).redrawOff &= ~2;
  await send(system, combo, WM_SETREDRAW, 1, 0);
  driveReady(system, current + 0x61);
}

/**
 * A drive's picture (seg2 `551f`): a fixed drive's 4, a floppy's 3, a
 * network drive's 6. No CD-ROM is found (MSCDEX, seg2 `558a`) and no RAM
 * drive (seg2 `55c0`).
 */
function picture(kind: number) {
  switch (kind) {
    case 1:
      return 0;
    case 2:
      return 3;
    case 4:
      return 6;
    default:
      return 4;
  }
}

/** The drives' combo box's item for a drive chosen, by its letter (seg2 `4732`); none where there is none. */
export async function selectDrive(system: any, hwnd: number, letter: number) {
  const wanted = letter | 0x60;
  const count = (await sendItem(system, hwnd, CMB_DRIVES, CB_GETCOUNT, 0, 0)) & 0xffff;
  let at = 0;

  while (at < count) {
    const name = await listText(system, hwnd, CMB_DRIVES, CB_GETLBTEXT, at);

    if (name[0] === wanted) {
      break;
    }

    at++;
  }

  await sendItem(system, hwnd, CMB_DRIVES, CB_SETCURSEL, at === count ? 0xffff : at, 0);
}

/** The drives listed again as the box is activated (seg2 `2107`); where the drive shown is gone, the current one chosen and listed. */
export async function refreshDrives(system: any, hwnd: number) {
  const combo = await item(system, hwnd, CMB_DRIVES);
  const at = (await send(system, combo, CB_GETCURSEL, 0, 0)) & 0xffff;
  const shown = stringOf(await sendBytes(system, combo, CB_GETLBTEXT, at, buffer(256)));

  await fillDrives(system, hwnd);

  const found = (await sendBytes(system, combo, CB_FINDSTRING, 0xffff, text(shown))).value & 0xffff;

  if (found === 0xffff) {
    await selectDrive(system, hwnd, currentDrive(system) + 0x61);
    await refresh(system, hwnd, null, WITH_FOLDERS);
  }
}

// ---------------------------------------------------------------------
// The boxes COMMDLG puts up.

async function windowText(system: any, hwnd: number, size: number) {
  return stringOf(await api(system, 'USER', 'GetWindowText', [W(hwnd), buffer(size), W(size)]));
}

/**
 * An error said (seg2 `1a26`): COMMDLG's string for DOS's error, filled with
 * the name or its drive's letter, under the box's caption; for a name not
 * valid, the name given the focus.
 */
export async function showError(system: any, hwnd: number, file: number[], code: number) {
  const name = file.slice(0, 0x100);
  const table: Record<number, [number, boolean]> = {
    2: [0x187, false],
    3: [0x188, false],
    4: [0x191, false],
    5: [0x184, true],
    0x13: [0x18f, true],
    0x20: [0x18a, false],
    0x41: [0x18b, false],
    0x52: [0x190, true],
    0x53: [0x18d, false],
    0x60: [0x193, false],
    0x61: [0x183, true],
    0x62: [0x18e, false],
    0x63: [0x18c, false],
  };
  const [id, drive] = table[code & 0xffff] ?? [0x189, false];

  lower(name);

  const value = drive ? (name.length ? [name[0]] : []) : name;
  const message = filled(commdlgString(id), value);
  const caption = await windowText(system, hwnd, 0xc0);

  await api(system, 'USER', 'MessageBox', [
    W(hwnd),
    text(message),
    text(caption),
    W(MB_ICONEXCLAMATION),
  ]);

  if (id === 0x189) {
    const edit = await item(system, hwnd, EDT_NAME);

    await post(system, hwnd, WM_NEXTDLGCTL, edit, 1);
  }
}

/** A drive that cannot be read said so, with Retry and Cancel, unless the box is just made (seg2 `405f`). Whether Retry was chosen. */
export async function showDriveError(system: any, hwnd: number, letter: number) {
  const id =
    shared(system).dosError === DISK_CHANGE
      ? 0x185
      : (await driveType(system, letter - 0x61)) === 2
        ? 0x184
        : 0x194;
  const message = filled(commdlgString(id), [letter]);
  const caption = await windowText(system, hwnd, 0xc0);

  if (shared(system).firstActivate) {
    return false;
  }

  const answer = await word(system, 'USER', 'MessageBox', [
    W(hwnd),
    text(message),
    text(caption),
    W(MB_ICONEXCLAMATION | MB_RETRYCANCEL),
  ]);

  return answer === IDRETRY;
}

/** The overwrite prompt (seg2 `4d23`): Yes, No preferred. Whether Yes. */
export async function overwritePrompt(system: any, hwnd: number, path: number[]) {
  const given = path[2] === 0x5c && path[3] === 0x5c ? path.slice(2) : path;
  const ansi = await translated(system, given, 'ansi');
  const message = filled(commdlgString(0x101), ansi);
  const caption = await windowText(system, hwnd, 0x40);
  const answer = await word(system, 'USER', 'MessageBox', [
    W(hwnd),
    text(message),
    text(caption),
    W(MB_YESNO | MB_ICONEXCLAMATION | MB_DEFBUTTON2),
  ]);

  return answer === IDYES;
}

/** The create prompt (seg2 `2062`): Yes or No; its answer. */
export async function createPrompt(system: any, hwnd: number, path: number[]) {
  const given = (path[2] === 0x5c && path[3] === 0x5c ? path.slice(2) : path).slice(0, 0x100);
  const message = filled(commdlgString(0x192), given);
  const caption = await windowText(system, hwnd, 0x100);

  return await word(system, 'USER', 'MessageBox', [
    W(hwnd),
    text(message),
    text(caption),
    W(MB_YESNO | MB_ICONQUESTION),
  ]);
}

// ---------------------------------------------------------------------
// The rows drawn.

/** The colours read again, and the pictures made for them where they changed (seg2 `43ee`, `0d58`). */
export async function colorsAndPictures(system: any) {
  const before = shared(system).colors.slice();

  await readColorsNow(system);

  const after = shared(system).colors;

  if (before[0] !== after[0] || before[1] !== after[1] || !shared(system).pictures) {
    await makePictures(system);
  }
}

/**
 * The pictures made from bitmap 576 of the installation's `COMMDLG.DLL`: its
 * blue made the window's colour, and beside it again with the blue made the
 * highlight's (seg2 `0d58`; `pictures.ts`), selected into a memory device
 * context kept for drawing them.
 */
async function makePictures(system: any) {
  const state = shared(system);
  const [window, highlight] = state.colors;
  const bitmap = await pictures(system, window, highlight);

  if (!bitmap) {
    return;
  }

  if (state.pictures) {
    const [memory, old] = state.pictures;
    const previous = SelectObject.call(system, memory, old);

    DeleteObject.call(system, previous);
    DeleteDC.call(system, memory);
  }

  const memory = CreateCompatibleDC.call(system, 0);
  const handle = system.handles.allocate(bitmap);
  const old = SelectObject.call(system, memory, handle);

  state.pictures = [memory, old];
}

/** A row's height (seg2 `4dcc`): the dialog's font's, measured once; the folders' and drives' rows as high as a picture at least. */
export async function measureItem(system: any, hwnd: number, far: number) {
  const state = shared(system);

  if (!state.itemHeight) {
    const hdc = await word(system, 'USER', 'GetDC', [W(hwnd)]);
    let font = (await send(system, hwnd, WM_GETFONT, 0, 0)) & 0xffff;

    if (!font) {
      font = await word(system, 'GDI', 'GetStockObject', [W(0x0d)]);
    }

    const old = await word(system, 'GDI', 'SelectObject', [W(hdc), W(font)]);
    const metrics = (await api(system, 'GDI', 'GetTextMetrics', [W(hdc), buffer(31)])).buffers[0];

    await api(system, 'GDI', 'SelectObject', [W(hdc), W(old)]);
    await api(system, 'USER', 'ReleaseDC', [W(hwnd), W(hdc)]);

    const height = metrics[0] | (metrics[1] << 8);

    state.textHeight = height;
    state.itemHeight = Math.max(height, PICTURES_HEIGHT);
  }

  const bytes = readFar(system, far, 4);
  const control = bytes[2] | (bytes[3] << 8);
  const height = control === LST_FILES ? state.textHeight : state.itemHeight;

  writeFar(system, ((far & 0xffff0000) | (((far & 0xffff) + 8) & 0xffff)) >>> 0, [
    height & 0xff,
    (height >> 8) & 0xff,
  ]);
}

/**
 * A row drawn (seg2 `4e8a`): its text lowered, in the window's colours or
 * the highlight's, the folders' highlighted only with the focus; a folder's
 * picture indented by its depth, a drive's; the files' grey in Save As; the
 * focus's rectangle.
 */
export async function drawItem(system: any, hwnd: number, far: number, save: boolean) {
  const bytes = readFar(system, far, 26);
  const value = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const control = value(2);

  if (control !== LST_FILES && control !== LST_FOLDERS && control !== CMB_DRIVES) {
    return;
  }

  const index = value(4);
  const state = value(8);
  const hdc = value(12);
  const rect = bytes.slice(14, 22);
  const left = (value(14) << 16) >> 16;
  const top = (value(16) << 16) >> 16;
  const message = control === CMB_DRIVES ? CB_GETLBTEXT : LB_GETTEXT;
  const called = await api(system, 'USER', 'SendDlgItemMessage', [
    W(hwnd),
    W(control),
    W(message),
    W(index),
    buffer(256),
  ]);
  const row = stringOf(called);

  if (!row.length) {
    await api(system, 'USER', 'DefWindowProc', [W(hwnd), W(WM_DRAWITEM), W(0), D(far)]);
    return;
  }

  for (let i = 0; i < row.length; i++) {
    row[i] = ansiLowerByte(row[i]);
  }

  const shares = shared(system);
  const [window, highlight, windowText, highlightText, grayText] = shares.colors;
  const height = control === LST_FILES ? shares.textHeight : shares.itemHeight;
  const selected = state & (ODS_SELECTED | ODS_FOCUS);
  const [background, foreground] =
    save && control === LST_FILES
      ? [window, grayText]
      : selected & ODS_SELECTED && (control !== LST_FOLDERS || selected & ODS_FOCUS)
        ? [highlight, highlightText]
        : [window, windowText];
  const oldBackground = (await api(system, 'GDI', 'SetBkColor', [W(hdc), D(background)])).value;
  const oldForeground = (await api(system, 'GDI', 'SetTextColor', [W(hdc), D(foreground)])).value;
  const width = PICTURES_WIDTH >> 3;
  const depth = dialogOf(system, hwnd)?.depth ?? 0;
  let indent = 1;
  let pictureIndex = 0;
  let pictureWidth = -4;

  if (control === CMB_DRIVES) {
    const data = (await sendItem(system, hwnd, CMB_DRIVES, CB_GETITEMDATA, index, 0)) & 0xffff;

    pictureIndex = data + (selected & ODS_SELECTED ? 8 : 0);
    pictureWidth = width;
  } else if (control === LST_FOLDERS) {
    const level = (index > depth ? depth : index) + 1;
    const kind = Math.sign(index - depth + 1) + 1;

    indent = level;
    pictureIndex = kind + (selected & ODS_FOCUS ? 8 : 0);
    pictureWidth = width;
  }

  const x = (indent + 1) * 4 + pictureWidth + left;
  const y = Math.trunc((height - shares.textHeight) / 2) + top;

  if (save && control === LST_FILES && grayText === 0) {
    /* No grey: the row filled with the window's colour, and the text greyed
     * by USER (seg2 `5179`). */
    const brush = await word(system, 'GDI', 'CreateSolidBrush', [D(background)]);
    const mode = await word(system, 'GDI', 'SetBkMode', [W(hdc), W(1)]);
    const chosen = brush || (await word(system, 'GDI', 'GetStockObject', [W(0)]));
    const old = await word(system, 'GDI', 'SelectObject', [W(hdc), W(chosen)]);

    await api(system, 'USER', 'FillRect', [W(hdc), B(rect), W(brush)]);
    await api(system, 'GDI', 'SelectObject', [W(hdc), W(old)]);

    if (brush) {
      await api(system, 'GDI', 'DeleteObject', [W(brush)]);
    }

    const black = await word(system, 'GDI', 'GetStockObject', [W(4)]);

    await api(system, 'USER', 'GrayString', [
      W(hdc),
      W(black),
      D(0),
      text(row),
      W(0),
      W(left + 4),
      W(top),
      W(0),
      W(0),
    ]);
    await api(system, 'GDI', 'SetBkMode', [W(hdc), W(mode)]);
  } else {
    await api(system, 'GDI', 'ExtTextOut', [
      W(hdc),
      W(x),
      W(y),
      W(ETO_OPAQUE_CLIPPED),
      B(rect),
      text(row),
      W(row.length),
      D(0),
    ]);
  }

  if (control !== LST_FILES && shares.pictures) {
    const [memory] = shares.pictures;
    const px = indent * 4 + left;
    const py = Math.trunc((shares.itemHeight - PICTURES_HEIGHT) / 2) + top;

    await api(system, 'GDI', 'BitBlt', [
      W(hdc),
      W(px),
      W(py),
      W(width),
      W(PICTURES_HEIGHT),
      W(memory),
      W(pictureIndex * width),
      W(0),
      D(SRCCOPY),
    ]);
  }

  await api(system, 'GDI', 'SetTextColor', [W(hdc), D(oldForeground)]);
  await api(system, 'GDI', 'SetBkColor', [W(hdc), D(oldBackground)]);

  if (state & ODS_FOCUS) {
    await api(system, 'USER', 'DrawFocusRect', [W(hdc), B(rect)]);
  }
}
