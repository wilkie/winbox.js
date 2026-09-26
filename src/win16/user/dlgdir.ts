'use strict';

import { searchDirectory } from '../../dos/syscall/find.js';
import { chdir, resolveDirectory } from '../../dos/syscall/directory.js';
import { selectDisk } from '../../dos/syscall/selectDisk.js';
import { GetTextExtent } from '../gdi/GetTextExtent.js';
import { SelectObject } from '../gdi/SelectObject.js';
import { translateText } from '../keyboard/oem.js';
import { User } from '../user.js';
import { ansiLowerByte, ansiUpperByte } from './ansi.js';
import { stringAt } from './control-classes.js';
import { GetDC } from './GetDC.js';
import { GetDlgItem } from './GetDlgItem.js';
import { InvalidateRect } from './InvalidateRect.js';
import { PostMessage } from './PostMessage.js';
import { ReleaseDC } from './ReleaseDC.js';
import { SendMessage } from './SendMessage.js';

/**
 * A directory listed into a list box or a combo box, and an entry chosen
 * from one turned back into a path: `DlgDirList`, `DlgDirListComboBox`,
 * `LB_DIR`, `CB_DIR`, `LB_ADDFILE` and the `DlgDirSelect` family.
 *
 * **Read out of `USER.EXE`**, seg37, which asks DOS for all of it through
 * INT 21h: the drive (0Eh, 19h), the directory (3Bh, 47h), and the entries
 * (1Ah, 4Eh, 4Fh). Here those are the DOS calls' own code, called directly.
 *
 * An entry's text: a directory's name in brackets, `[system]`, `[..]`; a
 * file's bare, `readme.txt`; a drive's letter between dashes in brackets,
 * `[-c-]`. Each is lowered, a name through `OemToAnsi` first, as DOS names
 * are OEM characters.
 *
 * Not followed: a negative static control identifier, which asks for the
 * entries with their size, date, time and attributes after tabs (seg37
 * `01f2`, `0a7d`); and the disk transfer area `LB_DIR` leaves pointing into
 * USER's own data (seg37 `e17`), where this leaves the program's alone.
 */

export const LB_DIR = 0x040e;
export const LB_ADDFILE = 0x0417;

const DDL_DIRECTORY = 0x0010;
const DDL_POSTMSGS = 0x2000;
const DDL_DRIVES = 0x4000;
const DDL_EXCLUSIVE = 0x8000;

const WM_SETREDRAW = 0x000b;
const LB_RESETCONTENT = 0x0405;
const LB_GETCURSEL = 0x0409;
const LB_GETTEXT = 0x040a;
const CB_RESETCONTENT = 0x040b;
const CB_DIR = 0x0405;

const lower = (text: string) =>
  Array.from(text, (c) => String.fromCharCode(ansiLowerByte(c.charCodeAt(0) & 0xff))).join('');
const upper = (text: string) =>
  Array.from(text, (c) => String.fromCharCode(ansiUpperByte(c.charCodeAt(0) & 0xff))).join('');

/**
 * Fills a list with a directory's entries (seg37 `0832`), each added as
 * `add` adds it -- sorted, as `LB_ADDSTRING` sorts -- and the drives, if
 * asked for, appended after them. The bits of `attributes` that DOS knows
 * choose what it finds; with `DDL_EXCLUSIVE`, only what has one of the
 * attributes asked for is kept, so that ordinary files are not. The entry
 * `.` is never kept. Answers the last `add`'s answer, or -1 for none.
 */
export async function fillDirectory(
  system: any,
  attributes: number,
  spec: string,
  add: (text: string, append: boolean) => Promise<number>
) {
  const dos = system.dos;
  let answer = -1;
  let asked = attributes & 0xffff;

  if (asked !== (DDL_DRIVES | DDL_EXCLUSIVE)) {
    const oem = await translateText(system, spec.substring(0, 0x80), 'oem');
    const found = await searchDirectory(dos, oem, asked & 0x5fff);

    if (found) {
      asked ^= DDL_EXCLUSIVE;

      for (const info of found) {
        const kind = info.attributes ?? 0;

        if (!(asked & (kind | DDL_EXCLUSIVE)) || (kind & DDL_DIRECTORY && info.name === '.')) {
          continue;
        }

        const name = kind & DDL_DIRECTORY ? `[${info.name}]` : info.name;

        answer = await add(lower(await translateText(system, name, 'ansi')), false);

        if (answer < -1) {
          break;
        }
      }
    }
  }

  /* Each drive letter DOS will make current (seg37 `0943`), in order. */
  if (answer !== -2 && attributes & DDL_DRIVES) {
    for (let drive = 0; drive < 26; drive++) {
      const letter = String.fromCharCode(0x41 + drive);

      if (dos.files.query(letter)) {
        answer = await add(lower(`[-${letter}-]`), true);

        if (answer < 0) {
          break;
        }
      }
    }
  }

  return answer;
}

/** A single file's entry, added (seg37 `0a1a`): the index, or -1 when there is none. */
export async function addFile(
  system: any,
  spec: string,
  add: (text: string, append: boolean) => Promise<number>
) {
  const oem = await translateText(system, spec.substring(0, 0x80), 'oem');
  const found = await searchDirectory(system.dos, oem, 0x0f);

  if (!found?.length) {
    return -1;
  }

  const info = found[0];
  const name = (info.attributes ?? 0) & DDL_DIRECTORY ? `[${info.name}]` : info.name;

  return add(lower(await translateText(system, name, 'ansi')), false);
}

/**
 * A path made to fit a static control (seg37 `0000`): as it is if it fits;
 * else its drive and `\...\` and as many of its last parts as fit after
 * them; else the drive and `\...` alone.
 */
async function fitPath(system: any, hwnd: number, path: string) {
  const window = system.handles.resolve(hwnd);
  const width = window?.innerWidth ?? 0;
  const hdc = GetDC.call(system, hwnd);
  const font = await SendMessage.call(system, hwnd, User.WM_GETFONT, 0, 0);

  if (font) {
    SelectObject.call(system, hdc, font);
  }

  const measure = (text: string) => GetTextExtent.call(system, hdc, text, text.length) & 0xffff;

  try {
    if (measure(path) <= width) {
      return path;
    }

    const prefix = `${path[0]}:\\...\\`;
    const room = width - measure(prefix);

    for (let at = path.indexOf('\\', 3); at >= 0; at = path.indexOf('\\', at + 1)) {
      const tail = path.substring(at + 1);

      if (measure(tail) <= room) {
        return prefix + tail;
      }
    }

    return prefix.substring(0, prefix.length - 1);
  } finally {
    ReleaseDC.call(system, hwnd, hdc);
  }
}

/** Writes a string and its null at a far pointer. */
function writeString(system: any, far: number, text: string) {
  const core = system.machine.cpu.core;

  for (let i = 0; i <= text.length; i++) {
    core.write8((far >>> 16) & 0xffff, ((far & 0xffff) + i) & 0xffff, i < text.length ? text.charCodeAt(i) : 0);
  }
}

/**
 * `DlgDirList` and `DlgDirListComboBox` (seg37 `0150`): a path taken apart
 * and gone to, the current directory shown, the list filled.
 *
 * The path, upper-cased where it lies, may begin with a drive, which is made
 * current, and may end with a file name. Without a wildcard `*` it is tried
 * as a directory first. Otherwise it must hold a wildcard, or end in `\`, or
 * nothing is done; the directory before its last separator is gone to, and
 * the name after it -- `*.*` when there is none -- is written back over the
 * path. Answers FALSE when the path would not do.
 *
 * The static control is given the drive and directory, lowered, shortened to
 * fit. The list is emptied and given the files as `uFileType` asks, less the
 * directories and drives, which come after in a pass of their own with `*.*`
 * and `DDL_EXCLUSIVE`, so that they are listed whatever the name asked for.
 */
async function dirList(
  system: any,
  hDlg: number,
  lpPathSpec: any,
  nIDListBox: number,
  nIDStaticPath: number,
  uFileType: number,
  isList: boolean
) {
  const dos = system.dos;
  const dialog = system.handles.resolve(hDlg) ? hDlg : 0;

  if (!dialog && (nIDStaticPath || nIDListBox)) {
    return 0;
  }

  const list = nIDListBox ? GetDlgItem.call(system, dialog, nIDListBox) : 0;

  // A negative identifier asks for the entries' details, which are not followed.
  if (nIDStaticPath & 0x8000) {
    nIDStaticPath = 0;
  }

  const current = dos.files.drive;
  let drive = current;
  let wild = true;
  let spec = '*.*';
  let listSpec: any = lpPathSpec;
  const text = lpPathSpec ? stringAt(system, lpPathSpec) : '';

  if (lpPathSpec && text) {
    if (text.length > 0x80) {
      return 0;
    }

    const upperText = upper(text);

    writeString(system, lpPathSpec, upperText);

    let path = await translateText(system, upperText, 'oem');

    if (path[1] === ':') {
      const index = path.charCodeAt(0) - 0x41;

      selectDisk.call(dos, index);

      if (index < 0 || index > 25 || !dos.files.query(String.fromCharCode(0x41 + index))) {
        selectDisk.call(dos, current.charCodeAt(0) - 0x41);
        return 0;
      }

      drive = String.fromCharCode(0x41 + index);
      path = path.substring(2);
    }

    let done = false;

    if (path && !path.includes('*')) {
      try {
        await chdir.call(dos, path);
        done = true;
      } catch {
        // Not a directory: a name to look for.
      }
    }

    if (path && !done) {
      wild = path.endsWith('\\');

      let separator = -1;

      for (let at = path.length - 1; at >= 0; at--) {
        const c = path[at];

        if (c === '\\' || c === '/' || c === ':') {
          separator = at;
          break;
        }

        if (c === '*' || c === '?') {
          wild = true;
        }
      }

      if (!wild) {
        selectDisk.call(dos, current.charCodeAt(0) - 0x41);
        return 0;
      }

      if (separator >= 0) {
        const directory = separator === 0 ? path[0] : path.substring(0, separator);

        try {
          await chdir.call(dos, directory);
        } catch {
          selectDisk.call(dos, current.charCodeAt(0) - 0x41);
          return 0;
        }
      }

      spec = path.substring(separator + 1);
    }

    writeString(system, lpPathSpec, await translateText(system, spec, 'ansi'));
  } else if (lpPathSpec) {
    listSpec = '*.*';
  }

  if (nIDStaticPath) {
    const { parts } = resolveDirectory(dos, `${drive}:`);
    const path = lower(await translateText(system, `${drive}:\\${parts.join('\\')}`, 'ansi'));
    const staticWindow = GetDlgItem.call(system, dialog, nIDStaticPath);

    await SendMessage.call(system, staticWindow, User.WM_SETTEXT, 0, await fitPath(system, staticWindow, path));
  }

  if (!(wild && nIDListBox && system.handles.resolve(list))) {
    return wild ? 1 : 0;
  }

  const post = (uFileType & DDL_POSTMSGS) !== 0;
  const reset = isList ? LB_RESETCONTENT : CB_RESETCONTENT;
  const dir = isList ? LB_DIR : CB_DIR;
  const deliver = (message: number, wParam: number, lParam: any) =>
    post
      ? PostMessage.call(system, list, message, wParam, lParam)
      : SendMessage.call(system, list, message, wParam, lParam);

  if (!post) {
    await SendMessage.call(system, list, WM_SETREDRAW, 0, 0);
  }

  await deliver(reset, 0, 0);

  let type = uFileType & 0xffff;

  if (type === DDL_DRIVES) {
    type |= DDL_EXCLUSIVE;
  }

  if (type !== (DDL_DRIVES | DDL_EXCLUSIVE)) {
    const files = type & ~(DDL_DRIVES | DDL_DIRECTORY) & ~(post ? DDL_POSTMSGS : 0);

    await deliver(dir, files & 0xffff, listSpec);
    type &= DDL_DRIVES | DDL_DIRECTORY;
  }

  if (type) {
    await deliver(dir, type | DDL_EXCLUSIVE, '*.*');
  }

  if (!post) {
    await SendMessage.call(system, list, WM_SETREDRAW, 1, 0);
    await InvalidateRect.call(system, list, null, 1);
  }

  return 1;
}

export function DlgDirList(
  this: any,
  hDlg: number,
  lpPathSpec: number,
  nIDListBox: number,
  nIDStaticPath: number,
  uFileType: number
) {
  return dirList(this, hDlg, lpPathSpec, nIDListBox, nIDStaticPath, uFileType, true);
}

export function DlgDirListComboBox(
  this: any,
  hDlg: number,
  lpPathSpec: number,
  nIDComboBox: number,
  nIDStaticPath: number,
  uFileType: number
) {
  return dirList(this, hDlg, lpPathSpec, nIDComboBox, nIDStaticPath, uFileType, false);
}

/**
 * The selected entry as a path (seg37 `066a`): a directory's brackets become
 * a `\` after it, a drive's `[-c-]` becomes `c:`, and a file name without a
 * dot is given one. Answers whether it was a directory or a drive; FALSE,
 * and nothing written, with nothing selected.
 */
async function selected(system: any, list: number) {
  const index = await SendMessage.call(system, list, LB_GETCURSEL, 0, 0);

  if (index & 0x8000 || !system.handles.resolve(list)) {
    return null;
  }

  const window = system.handles.resolve(list);
  let text: string = window.window?.control?.items?.[index] ?? '';

  text = text.split('\t')[0];

  const directory = text[0] === '[';

  if (directory) {
    text = text[1] === '-' ? `${text[2]}:` : `${text.substring(1, text.length - 1)}\\`;
  } else if (!text.includes('.')) {
    text += '.';
  }

  return { text, directory };
}

/** The list inside a combo box. */
function comboList(system: any, combo: number) {
  return system.handles.resolve(combo)?.window?.control?.combo?.listBox ?? 0;
}

async function select(system: any, list: number, lpString: number, limit: number) {
  const answer = await selected(system, list);

  if (!answer) {
    return 0;
  }

  const text = answer.text.substring(0, Math.max(0, Math.min(limit, 0x80) - 1));

  writeString(system, lpString, text);

  return answer.directory ? 1 : 0;
}

export function DlgDirSelect(this: any, hDlg: number, lpString: number, nIDListBox: number) {
  return select(this, GetDlgItem.call(this, hDlg, nIDListBox), lpString, 0x10000);
}

export function DlgDirSelectEx(this: any, hDlg: number, lpString: number, cbString: number, nIDListBox: number) {
  return select(this, GetDlgItem.call(this, hDlg, nIDListBox), lpString, cbString);
}

export function DlgDirSelectComboBox(this: any, hDlg: number, lpString: number, nIDComboBox: number) {
  return select(this, comboList(this, GetDlgItem.call(this, hDlg, nIDComboBox)), lpString, 0x10000);
}

export function DlgDirSelectComboBoxEx(
  this: any,
  hDlg: number,
  lpString: number,
  cbString: number,
  nIDComboBox: number
) {
  return select(this, comboList(this, GetDlgItem.call(this, hDlg, nIDComboBox)), lpString, cbString);
}
