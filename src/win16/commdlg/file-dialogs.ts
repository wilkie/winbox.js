'use strict';

import { W, api, word } from './api.js';
import { FILE_OPEN_DIALOG } from './file-open-dialog.js';
import { MULTI_FILE_OPEN_DIALOG } from './multi-file-open-dialog.js';
import { COMMDLG_STRINGS } from './strings.js';
import { colorsAndPictures } from './file-lists.js';
import { instance, setError, waitCursor } from './state.js';
import { procAddressOf } from './proc-address.js';
import { parseDialogTemplate } from '../user/dialog-template.js';
import { dialogBoxTemplate, memoryTemplate, resourceTemplate } from '../user/dialogs.js';

/**
 * `GetOpenFileName` and `GetSaveFileName`: COMMDLG's Open and Save As
 * boxes, and the procedures they run, WinBox's own. As
 * `crates/winbox-win16/src/commdlg/file_dialogs.rs`.
 *
 * **Read out of `COMMDLG.DLL`** seg2, and **recorded** by `ofnerr` and
 * `ofnopen`: the common start (`09eb`), `FileOpenDlgProc` and
 * `FileSaveDlgProc` (`42a3`, `446a`), their `WM_INITDIALOG` (`1153`),
 * `WM_COMMAND` (`31f4`) and OK (`22e7`), the lists (`039b`, `0180`), the
 * drives (`4827`), and the owner-drawn items (`4dcc`, `4e8a`). Each step
 * asks KERNEL, USER and GDI what the file asks them (`api.ts`), in its
 * order. The templates and strings are WinBox's own; the folders' and
 * drives' pictures are the installation's `COMMDLG.DLL`'s, read as data, and
 * are not drawn without it.
 */

// OPENFILENAME's fields, by their offsets.
export const LSTRUCTSIZE = 0x00;
export const HWNDOWNER = 0x04;
export const HINSTANCE = 0x06;
export const LPSTRFILTER = 0x08;
export const LPSTRCUSTOMFILTER = 0x0c;
export const NMAXCUSTFILTER = 0x10;
export const NFILTERINDEX = 0x14;
export const LPSTRFILE = 0x18;
export const NMAXFILE = 0x1c;
export const LPSTRFILETITLE = 0x20;
export const NMAXFILETITLE = 0x24;
export const LPSTRINITIALDIR = 0x28;
export const LPSTRTITLE = 0x2c;
export const FLAGS = 0x30;
export const NFILEOFFSET = 0x34;
export const NFILEEXTENSION = 0x36;
export const LPSTRDEFEXT = 0x38;
export const LPFNHOOK = 0x40;
export const LPTEMPLATENAME = 0x44;

// Its flags.
export const OFN_READONLY = 0x0001;
export const OFN_OVERWRITEPROMPT = 0x0002;
export const OFN_HIDEREADONLY = 0x0004;
export const OFN_NOCHANGEDIR = 0x0008;
export const OFN_SHOWHELP = 0x0010;
export const OFN_ENABLEHOOK = 0x0020;
export const OFN_ENABLETEMPLATE = 0x0040;
export const OFN_ENABLETEMPLATEHANDLE = 0x0080;
export const OFN_NOVALIDATE = 0x0100;
export const OFN_ALLOWMULTISELECT = 0x0200;
export const OFN_EXTENSIONDIFFERENT = 0x0400;
export const OFN_PATHMUSTEXIST = 0x0800;
export const OFN_FILEMUSTEXIST = 0x1000;
export const OFN_CREATEPROMPT = 0x2000;
export const OFN_SHAREAWARE = 0x4000;
export const OFN_NOREADONLYRETURN = 0x8000;
export const OFN_NOTESTFILECREATE = 0x00010000;
/**
 * The types', the drives' combo box dropped, and the folders' selection
 * moved but not taken: kept in the program's flags (seg2 `3925`, `3df9`,
 * `3bdd`), and cleared as the dialog starts (seg2 `138d`).
 */
export const TYPES_DROPPED = 0x10000000;
export const DRIVES_DROPPED = 0x20000000;
export const FOLDER_MOVED = 0x40000000;

// The extended errors.
export const CDERR_STRUCTSIZE = 0x0001;
export const CDERR_NOTEMPLATE = 0x0003;
export const CDERR_NOHINSTANCE = 0x0004;
export const CDERR_FINDRESFAILURE = 0x0006;
export const CDERR_NOHOOK = 0x000b;
export const CDERR_DIALOGFAILURE = 0xffff;
export const FNERR_SUBCLASSFAILURE = 0x3001;
export const FNERR_INVALIDFILENAME = 0x3002;
export const FNERR_BUFFERTOOSMALL = 0x3003;

// The dialog's controls (`dlgs.h`).
export const IDOK = 1;
export const IDCANCEL = 2;
export const IDABORT = 3;
export const PSH_HELP = 0x040e;
export const CHX_READONLY = 0x0410;
export const STC_DIRECTORY = 0x0440;
export const STC_TYPES = 0x0441;
export const LST_FILES = 0x0460;
export const LST_FOLDERS = 0x0461;
export const CMB_TYPES = 0x0470;
export const CMB_DRIVES = 0x0471;
export const EDT_NAME = 0x0480;

// Messages.
export const WM_ACTIVATE = 0x0006;
export const WM_KILLFOCUS = 0x0008;
export const WM_SETREDRAW = 0x000b;
export const WM_GETTEXT = 0x000d;
export const WM_GETTEXTLENGTH = 0x000e;
export const WM_SYSCOLORCHANGE = 0x0015;
export const WM_NEXTDLGCTL = 0x0028;
export const WM_DRAWITEM = 0x002b;
export const WM_MEASUREITEM = 0x002c;
export const WM_GETFONT = 0x0031;
export const WM_INITDIALOG = 0x0110;
export const WM_COMMAND = 0x0111;
export const EM_SETSEL = 0x0401;
export const EM_LIMITTEXT = 0x0415;
export const BM_SETSTYLE = 0x0404;
export const LB_ADDSTRING = 0x0401;
export const LB_INSERTSTRING = 0x0402;
export const LB_RESETCONTENT = 0x0405;
export const LB_SETCURSEL = 0x0407;
export const LB_GETSEL = 0x0408;
export const LB_GETCURSEL = 0x0409;
export const LB_GETTEXT = 0x040a;
export const LB_GETTOPINDEX = 0x040f;
export const LB_FINDSTRING = 0x0410;
export const LB_GETSELCOUNT = 0x0411;
export const LB_GETSELITEMS = 0x0412;
export const LB_SETTOPINDEX = 0x0418;
export const LB_SETCARETINDEX = 0x041f;
export const LB_GETCARETINDEX = 0x0420;
export const CB_LIMITTEXT = 0x0401;
export const CB_ADDSTRING = 0x0403;
export const CB_GETCOUNT = 0x0406;
export const CB_GETCURSEL = 0x0407;
export const CB_GETLBTEXT = 0x0408;
export const CB_INSERTSTRING = 0x040a;
export const CB_RESETCONTENT = 0x040b;
export const CB_FINDSTRING = 0x040c;
export const CB_SETCURSEL = 0x040e;
export const CB_SHOWDROPDOWN = 0x040f;
export const CB_GETITEMDATA = 0x0410;
export const CB_SETITEMDATA = 0x0411;
export const CB_SETEXTENDEDUI = 0x0415;

// Notifications.
export const LBN_SELCHANGE = 1;
export const LBN_DBLCLK = 2;
export const LBN_SETFOCUS = 4;
export const LBN_KILLFOCUS = 5;
export const CBN_SELCHANGE = 1;
export const CBN_DROPDOWN = 7;
export const CBN_CLOSEUP = 8;
export const EN_CHANGE = 0x0300;
/** COMMDLG's own notification: a selection to be taken now (seg2 `1712`). */
export const TAKE = 0x8000;

export const GWL_WNDPROC = -4;
export const GCL_WNDPROC = -24;
export const SW_HIDE = 0;
export const SWP_NOZORDER = 0x0004;
export const MB_ICONEXCLAMATION = 0x0030;
export const MB_YESNO = 0x0004;
export const MB_ICONQUESTION = 0x0020;
export const MB_DEFBUTTON2 = 0x0100;
export const MB_RETRYCANCEL = 0x0005;
export const IDYES = 6;
export const IDRETRY = 4;

/** `COMMDLG`'s ordinals for the procedures it hands out. */
export const FILE_OPEN_DLG_PROC = 6;
export const FILE_SAVE_DLG_PROC = 7;
export const DW_LB_SUBCLASS = 29;
export const DW_OK_SUBCLASS = 31;

/** The pictures' size: 8 pictures of 16 by 16 (bitmap 576), kept so the rows are as high without the file. */
export const PICTURES_WIDTH = 128;
export const PICTURES_HEIGHT = 16;

/** What an Open or Save As box keeps, as COMMDLG keeps it in the block it allocates for it (seg2 `115c`). */
export type FileDialog = {
  /** The program's structure. */
  ofn: number;
  /** The directory to go back to with `OFN_NOCHANGEDIR` (`+4`). */
  saved: number[];
  /** The name being worked on (`+105h`). */
  scratch: number[];
  /** The files' list's specs (`+205h`). */
  filter: number[];
  /** The last spec chosen, which the custom filter is given (`+305h`). */
  spec: number[];
  /** The folders' list's rows that are the current folder's path (`+40Bh`). */
  depth: number;
};

/** COMMDLG's own for its file boxes, in its data segment. As `file_dialogs.rs`'s `Shared`. */
export type Shared = {
  dialogs: Map<number, FileDialog>;
  hook: number;
  okFromFolders: boolean;
  redrawOff: number;
  firstActivate: boolean;
  prompting: boolean;
  textHeight: number;
  itemHeight: number;
  listProc: number;
  buttonProc: number;
  users: number;
  pictures: [number, number] | null;
  colors: number[];
  dosError: number;
};

/** COMMDLG's state: its error where the file is not loaded, whether a box is being made, and its file boxes'. */
export function commdlgState(system: any) {
  return (system._commdlg ??= { error: 0, initialising: false });
}

export function shared(system: any): Shared {
  return (commdlgState(system).files ??= {
    dialogs: new Map(),
    hook: 0,
    okFromFolders: false,
    redrawOff: 0,
    firstActivate: false,
    prompting: false,
    textHeight: 0,
    itemHeight: 0,
    listProc: 0,
    buttonProc: 0,
    users: 0,
    pictures: null,
    colors: [0, 0, 0, 0, 0],
    dosError: 0,
  });
}

export const bytesOfString = (value: string) => Array.from(value, (c) => c.charCodeAt(0) & 0xff);

export function commdlgString(id: number) {
  return bytesOfString(COMMDLG_STRINGS.get(id) ?? '');
}

/** A string with its first `%s` or `%c` filled, as `wsprintf` fills it. */
export function filled(format: number[], value: number[]) {
  for (const second of [0x73, 0x63]) {
    for (let at = 0; at + 1 < format.length; at++) {
      if (format[at] === 0x25 && format[at + 1] === second) {
        return [...format.slice(0, at), ...value, ...format.slice(at + 2)];
      }
    }
  }

  return format.slice();
}

/** ASCII letters lowered, as COMMDLG lowers them (seg2 `5625`). */
export function lower(text: number[]) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] >= 0x41 && text[i] <= 0x5a) {
      text[i] += 0x20;
    }
  }
}

export const hasWildcard = (text: number[]) => text.includes(0x2a) || text.includes(0x3f);

export function terminated(text: number[]) {
  const end = text.indexOf(0);

  return end < 0 ? text.slice() : text.slice(0, end);
}

/** The structure's fields. */
export class Ofn {
  declare far: number;
  declare system: any;

  constructor(system: any, far: number) {
    this.system = system;
    this.far = far >>> 0;
  }

  at(offset: number): [number, number] {
    return [(this.far >>> 16) & 0xffff, ((this.far & 0xffff) + offset) & 0xffff];
  }

  word(offset: number) {
    const [segment, at] = this.at(offset);

    return this.system.machine.cpu.core.read16(segment, at);
  }

  dword(offset: number) {
    return (this.word(offset) | (this.word(offset + 2) << 16)) >>> 0;
  }

  setWord(offset: number, value: number) {
    const [segment, at] = this.at(offset);

    this.system.machine.cpu.core.write16(segment, at, value & 0xffff);
  }

  setDword(offset: number, value: number) {
    this.setWord(offset, value & 0xffff);
    this.setWord(offset + 2, (value >>> 16) & 0xffff);
  }

  flags() {
    return this.dword(FLAGS);
  }

  setFlags(value: number) {
    this.setDword(FLAGS, value >>> 0);
  }

  /** A string field's string; null for a null pointer. */
  string(offset: number): number[] | null {
    const far = this.dword(offset);

    return far ? readString(this.system, far) : null;
  }

  /** A string field's bytes written, its nought with them. */
  write(offset: number, bytes: number[]) {
    writeFar(this.system, this.dword(offset), [...bytes, 0]);
  }

  /** A name too long for the program's buffer: its length in the buffer's first two bytes and a nought (seg2 `23d4`). */
  writeSize(offset: number, length: number) {
    writeFar(this.system, this.dword(offset), [length & 0xff, (length >> 8) & 0xff, 0]);
  }
}

/** The bytes of a string at a far pointer, without its nought. */
export function readString(system: any, far: number) {
  const core = system.machine.cpu.core;
  const bytes: number[] = [];

  for (let at = far & 0xffff; bytes.length < 0x10000; at = (at + 1) & 0xffff) {
    const byte = core.read8((far >>> 16) & 0xffff, at);

    if (!byte) {
      break;
    }

    bytes.push(byte);
  }

  return bytes;
}

export function readFar(system: any, far: number, length: number) {
  const core = system.machine.cpu.core;

  return Array.from({ length }, (_, i) =>
    core.read8((far >>> 16) & 0xffff, ((far & 0xffff) + i) & 0xffff)
  );
}

export function writeFar(system: any, far: number, bytes: number[]) {
  const core = system.machine.cpu.core;

  bytes.forEach((byte, i) =>
    core.write8((far >>> 16) & 0xffff, ((far & 0xffff) + i) & 0xffff, byte & 0xff)
  );
}

/** The custom filter's pattern, after its description; and a filter's, at the offset the types' list keeps for it. */
export function afterString(system: any, far: number, offset: number) {
  return readString(system, ((far & 0xffff0000) | (((far & 0xffff) + offset) & 0xffff)) >>> 0);
}

export function customPattern(system: any, custom: number) {
  return afterString(system, custom, readString(system, custom).length + 1);
}

// ---------------------------------------------------------------------
// The start: GetOpenFileName and GetSaveFileName (seg2 `09eb`).

/**
 * Shows COMMDLG's Open box (seg2 `0c17`).
 *
 * @param {Types.FARPTR} lpofn - The program's `OPENFILENAME`.
 * @returns {Types.BOOL} Whether a name was chosen.
 */
export async function GetOpenFileName(this: any, lpofn: number) {
  return await start(this, lpofn, false);
}

/**
 * Shows COMMDLG's Save As box (seg2 `0c48`).
 *
 * @param {Types.FARPTR} lpofn - The program's `OPENFILENAME`.
 * @returns {Types.BOOL} Whether a name was chosen.
 */
export async function GetSaveFileName(this: any, lpofn: number) {
  return await start(this, lpofn, true);
}

async function start(system: any, far: number, save: boolean) {
  const ofn = new Ofn(system, far);

  /* The structure's size first: the error is set and the call refused
   * before anything else (seg2 `09fc`). */
  if (ofn.dword(LSTRUCTSIZE) !== 0x48) {
    setError(system, CDERR_STRUCTSIZE);
    return 0;
  }

  await waitCursor(system, true);
  setError(system, 0);
  await picturesUsed(system);

  const flags = ofn.flags();
  let template: any = null;
  let code = 0;

  if (flags & OFN_ENABLETEMPLATEHANDLE) {
    template = memoryTemplate(system, ((ofn.word(HINSTANCE) | 1) << 16) >>> 0);
  } else if (flags & OFN_ENABLETEMPLATE) {
    const name = ofn.dword(LPTEMPLATENAME);
    const hinstance = ofn.word(HINSTANCE);

    if (!name) {
      code = CDERR_NOTEMPLATE;
    } else if (!hinstance) {
      code = CDERR_NOHINSTANCE;
    } else {
      /* A name, or with a segment of nought a number, as USER reads one. */
      const named = name >>> 16 ? String.fromCharCode(...readString(system, name)) : name & 0xffff;

      template = await resourceTemplate(system, hinstance, named);

      if (!template) {
        code = CDERR_FINDRESFAILURE;
      }
    }
  } else {
    template = builtIn(!!(flags & OFN_ALLOWMULTISELECT));
  }

  let answer = 0;

  if (code) {
    setError(system, code);
  } else {
    const previous = await word(system, 'KERNEL', 'SetErrorMode', [W(0x8003)]);

    if (flags & OFN_ENABLEHOOK) {
      shared(system).hook = ofn.dword(LPFNHOOK);
    }

    let result = await dialogBox(system, template, ofn.word(HWNDOWNER), far, save);

    shared(system).hook = 0;

    if ((result << 16) >> 16 === -1) {
      setError(system, CDERR_DIALOGFAILURE);
      result = 0;
    }

    await word(system, 'KERNEL', 'SetErrorMode', [W(previous)]);
    answer = result;
  }

  picturesLetGo(system);
  await waitCursor(system, false);

  return answer === 1 ? 1 : 0;
}

/** COMMDLG's template, WinBox's own: 1536, or 1537 for several files. */
function builtIn(multiple: boolean) {
  const bytes = multiple ? MULTI_FILE_OPEN_DIALOG : FILE_OPEN_DIALOG;

  return parseDialogTemplate((at: number) => bytes[at] ?? 0);
}

/** `DialogBoxIndirectParam` with COMMDLG's instance, and its procedure for the box (seg2 `0b9f`): what `EndDialog` was given. */
async function dialogBox(system: any, template: any, owner: number, ofn: number, save: boolean) {
  const proc = procAddressOf(system, save ? FILE_SAVE_DLG_PROC : FILE_OPEN_DLG_PROC);

  return (await dialogBoxTemplate(system, instance(system), template, owner, proc, ofn)) & 0xffff;
}

// ---------------------------------------------------------------------
// The pictures (seg2 `0fb3`, `0fe2`, `0d58`).

/** A box starting: with the first, the system's colours read and the pictures made (seg2 `0fb3`). */
async function picturesUsed(system: any) {
  const state = shared(system);

  state.users++;

  if (state.users === 1) {
    await colorsAndPictures(system);
  }
}

/** A box ended (seg2 `0fe2`). */
function picturesLetGo(system: any) {
  const state = shared(system);

  state.users = Math.max(0, state.users - 1);
}

/** COLOR_WINDOW, COLOR_HIGHLIGHT, COLOR_WINDOWTEXT, COLOR_HIGHLIGHTTEXT and COLOR_GRAYTEXT (seg2 `0f54`). */
export async function readColorsNow(system: any) {
  const colors: number[] = [];

  for (const index of [5, 0x0d, 8, 0x0e, 0x11]) {
    colors.push((await api(system, 'USER', 'GetSysColor', [W(index)])).value >>> 0);
  }

  shared(system).colors = colors;
}
