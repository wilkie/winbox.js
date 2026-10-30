'use strict';

import {
  api,
  buffer,
  bytesOf,
  D,
  itemText,
  setItemText,
  text,
  textOf,
  W,
  word,
} from '../commdlg/api.js';
import { segmentSelector } from '../selectors.js';
import { parseDialogTemplate } from '../user/dialog-template.js';
import { dialogBoxTemplate } from '../user/dialogs.js';
import { SHELL_STRINGS } from './strings.js';

/**
 * SHELL's box for finding a program, "Program Not Found": what
 * `ShellExecute` shows where the program a registry association names
 * cannot be started for want of its file. **Read out** of `SHELL.DLL`
 * (the box's procedure, ordinal 101 `FindExeDlgProc`, seg8 `010e`; the
 * routine that shows it, unnamed ordinal 119, seg8 `0570`; `ShellExecute`'s
 * call of it, seg4 `0fee`-`1020`; its dialog 200) and **recorded** by
 * `findexe`. As the Rust engine's `shell/find_program.rs`.
 *
 * The dialog is WinBox's own, laid out from its controls: no Windows file
 * is shipped and none of its bytes is copied here.
 */

const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CAPTION = 0x00c00000;
const WS_BORDER = 0x00800000;
const WS_SYSMENU = 0x00080000;
const WS_GROUP = 0x00020000;
const WS_TABSTOP = 0x00010000;
const DS_SETFONT = 0x40;
const DS_MODALFRAME = 0x80;
const ES_AUTOHSCROLL = 0x0080;
const ES_OEMCONVERT = 0x0400;
const BS_DEFPUSHBUTTON = 1;

const CLASS_BUTTON = 0x80;
const CLASS_EDIT = 0x81;
const CLASS_STATIC = 0x82;

const IDOK = 1;
const IDCANCEL = 2;
/** "&Locate...", the edit control of the folder, "&Help" and the two texts. */
const ID_LOCATE = 201;
const ID_FOLDER = 203;
const ID_HELP = 204;
const ID_TEXT = 205;
const ID_LOCATION = 206;

/** SHELL's ordinal for the box's procedure. */
const FIND_EXE_DLG_PROC = 101;

/** The dialog's number in SHELL's resources (seg8 `0763`). */
export const FIND_PROGRAM_DIALOG_ID = 200;

const STYLE = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT;
const BOX = { x: 20, y: 20, cx: 210, cy: 82 };
const CAPTION = 'Program Not Found';
const FONT_SIZE = 8;
const FONT = 'MS Sans Serif';

interface Control {
  x: number;
  y: number;
  cx: number;
  cy: number;
  id: number;
  style: number;
  class: number;
  text: string;
}

const TEXT_STYLE = WS_CHILD | WS_VISIBLE | WS_GROUP;
const BUTTON_STYLE = WS_CHILD | WS_VISIBLE | WS_TABSTOP;

const CONTROLS: Control[] = [
  {
    x: 5,
    y: 5,
    cx: 134,
    cy: 40,
    id: ID_TEXT,
    style: TEXT_STYLE,
    class: CLASS_STATIC,
    text: "Cannot find %s.\n\nThis program is needed to run files with extension '%s'.",
  },
  {
    x: 5,
    y: 49,
    cx: 134,
    cy: 10,
    id: ID_LOCATION,
    style: TEXT_STYLE,
    class: CLASS_STATIC,
    text: 'Location of %s:',
  },
  {
    x: 3,
    y: 61,
    cx: 134,
    cy: 12,
    id: ID_FOLDER,
    style: WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL | ES_OEMCONVERT,
    class: CLASS_EDIT,
    text: '',
  },
  {
    x: 165,
    y: 6,
    cx: 40,
    cy: 14,
    id: IDOK,
    style: BUTTON_STYLE | BS_DEFPUSHBUTTON,
    class: CLASS_BUTTON,
    text: 'OK',
  },
  {
    x: 165,
    y: 23,
    cx: 40,
    cy: 14,
    id: IDCANCEL,
    style: BUTTON_STYLE,
    class: CLASS_BUTTON,
    text: 'Cancel',
  },
  {
    x: 165,
    y: 40,
    cx: 40,
    cy: 14,
    id: ID_LOCATE,
    style: BUTTON_STYLE,
    class: CLASS_BUTTON,
    text: '&Locate...',
  },
  {
    x: 165,
    y: 61,
    cx: 40,
    cy: 14,
    id: ID_HELP,
    style: BUTTON_STYLE,
    class: CLASS_BUTTON,
    text: '&Help',
  },
];

/** The box's `DLGTEMPLATE`, made from its controls. */
export function buildFindProgramDialog(): Uint8Array {
  const bytes: number[] = [];
  const u8 = (value: number) => bytes.push(value & 0xff);
  const u16 = (value: number) => {
    u8(value);
    u8(value >> 8);
  };
  const u32 = (value: number) => {
    u16(value & 0xffff);
    u16(value >>> 16);
  };
  const string = (value: string) => {
    for (const char of value) {
      u8(char.charCodeAt(0));
    }

    u8(0);
  };

  u32(STYLE >>> 0);
  u8(CONTROLS.length);
  u16(BOX.x);
  u16(BOX.y);
  u16(BOX.cx);
  u16(BOX.cy);
  string(''); // menu
  string(''); // class
  string(CAPTION);
  u16(FONT_SIZE);
  string(FONT);

  for (const control of CONTROLS) {
    u16(control.x);
    u16(control.y);
    u16(control.cx);
    u16(control.cy);
    u16(control.id);
    u32(control.style >>> 0);
    u8(control.class);
    string(control.text);
    u8(0); // no extra data
  }

  return Uint8Array.from(bytes);
}

export const FIND_PROGRAM_DIALOG = buildFindProgramDialog();

// What the procedure and the routine use of SHELL's data (seg13).

/** WIN.INI's section of programs found where they were not (seg13 `0076`). */
const PROGRAMS_SECTION = 'programs';
/** The help file the Help button opens (seg13 `0144`), at its topics. */
const HELP_FILE = 'progman.hlp';
const HELP_TOPIC = 0x1b5e;
const HELP_TOPIC_FROM_LOCATE = 0x1b5f;
const HELP_CONTEXT = 1;
/** The message `GetOpenFileName`'s Help button sends (seg13 `0150`). */
const HELP_MESSAGE = 'commdlg_help';
/** What a program's name is given where it has no extension (seg13 `016e`). */
const PROGRAM_EXTENSION = '.exe';

/** SHELL's string for a folder with no such program (`04ee`). */
const STRING_NOT_FOUND = 0xdf;

const WM_INITDIALOG = 0x0110;
const WM_COMMAND = 0x0111;
const WM_DESTROY = 0x0002;
const MB_ICONHAND = 0x0010;
const OF_EXIST = 0x4000;
const DWL_USER = 8;

/** The size of the routine's buffers and the procedure's (`0189`, `047c`). */
const BUFFER = 0x100;

/**
 * The block the routine hands the box (seg8 `073d`-`075a`): the program's
 * name at 0, the folder at 4 -- the buffer `OK` writes the path into -- and
 * the extension at 8, each a far pointer.
 */
const NAME_AT = 0;
const FOLDER_AT = 4;
const EXTENSION_AT = 8;

function core(system: any) {
  return system.machine.cpu.core;
}

function readFar(system: any, far: number) {
  const bytes: number[] = [];

  for (let at = 0; at < BUFFER; at++) {
    const byte = core(system).read8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff);

    if (!byte) {
      break;
    }

    bytes.push(byte);
  }

  return bytes;
}

function writeFar(system: any, far: number, bytes: number[]) {
  [...bytes, 0].forEach((byte, at) =>
    core(system).write8((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff, byte)
  );
}

function pointerAt(system: any, far: number, at: number) {
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;
  const low = core(system).read16(segment, (offset + at) & 0xffff);
  const high = core(system).read16(segment, (offset + at + 2) & 0xffff);

  return ((high << 16) | low) >>> 0;
}

/** `wsprintf` of SHELL's way: each `%s` taken in turn. */
function filled(template: number[], ...values: number[][]) {
  const out: number[] = [];
  let next = 0;

  for (let at = 0; at < template.length; at++) {
    if (template[at] === 0x25 && template[at + 1] === 0x73) {
      out.push(...(values[next++] ?? []));
      at++;
    } else {
      out.push(template[at]);
    }
  }

  return out;
}

/**
 * SHELL's ordinal 101, **FindExeDlgProc**, the procedure of the box
 * (`SHELL.DLL` seg8 `010e`-`056d`):
 *
 * * `WM_INITDIALOG`: the block kept in the box's `DWL_USER`; the first
 *   text's `%s`s the program and the extension, the second's the program;
 *   the folder's control given the folder. TRUE.
 * * `WM_COMMAND`, TRUE for every one: OK makes the path -- the folder, a
 *   `\` where it ends in neither `:` nor `\`, the program -- and where
 *   `OpenFile` finds it there writes it to WIN.INI's [programs] under the
 *   program's name and ends the box with 1; else tells "Cannot find file
 *   '...'." in a message box captioned as the box and stays. Cancel ends it
 *   with 2. Help opens `progman.hlp`. Locate is `GetOpenFileName`'s, from
 *   COMMDLG loaded for it: not yet followed.
 * * `WM_DESTROY`: COMMDLG freed where it was loaded.
 * * The message `commdlg_help`: Help, from Locate's box. Nought for any other.
 *
 * **Recorded** by `findexe`.
 */
export async function FindExeDlgProc(
  this: any,
  hDlg: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const system = this;

  if (message === WM_INITDIALOG) {
    const block = lParam >>> 0;
    const name = readFar(system, pointerAt(system, block, NAME_AT));
    const folder = readFar(system, pointerAt(system, block, FOLDER_AT));
    const extension = readFar(system, pointerAt(system, block, EXTENSION_AT));

    system._shellHelpMessage = await word(system, 'USER', 'RegisterWindowMessage', [
      text(bytesOf(HELP_MESSAGE)),
    ]);
    await api(system, 'USER', 'SetWindowLong', [W(hDlg), W(DWL_USER), D(block)]);

    const first = await itemText(system, hDlg, ID_TEXT, BUFFER);

    await setItemText(system, hDlg, ID_TEXT, filled(first, name, extension));

    const second = await itemText(system, hDlg, ID_LOCATION, BUFFER);

    await setItemText(system, hDlg, ID_LOCATION, filled(second, name));
    await setItemText(system, hDlg, ID_FOLDER, folder);

    return 1;
  }

  if (message === WM_DESTROY) {
    return 1;
  }

  if (message === WM_COMMAND) {
    const id = wParam & 0xffff;

    if (id === ID_HELP) {
      await help(system, hDlg, HELP_TOPIC);
    } else if (id === IDOK) {
      await accept(system, hDlg);
    } else if (id === IDCANCEL) {
      await api(system, 'USER', 'EndDialog', [W(hDlg), W(id)]);
    }

    return 1;
  }

  if (system._shellHelpMessage && message === system._shellHelpMessage) {
    await help(system, hDlg, HELP_TOPIC_FROM_LOCATE);
    return 1;
  }

  return 0;
}

async function help(system: any, hDlg: number, topic: number) {
  await api(system, 'USER', 'WinHelp', [
    W(hDlg),
    text(bytesOf(HELP_FILE)),
    W(HELP_CONTEXT),
    D(topic),
  ]);
}

/** OK (`0458`-`054d`). */
async function accept(system: any, hDlg: number) {
  const block = (await api(system, 'USER', 'GetWindowLong', [W(hDlg), W(DWL_USER)])).value >>> 0;
  const name = readFar(system, pointerAt(system, block, NAME_AT));
  const folderAt = pointerAt(system, block, FOLDER_AT);
  const path = await itemText(system, hDlg, ID_FOLDER, BUFFER);
  const last = path[path.length - 1];

  if (last !== 0x3a && last !== 0x5c) {
    path.push(0x5c);
  }

  path.push(...name);
  writeFar(system, folderAt, path);

  const found = await word(system, 'KERNEL', 'OpenFile', [text(path), buffer(136), W(OF_EXIST)]);

  if (found === 0xffff) {
    const message = filled(bytesOf(SHELL_STRINGS.get(STRING_NOT_FOUND) ?? ''), path);
    const title = (await api(system, 'USER', 'GetWindowText', [W(hDlg), buffer(BUFFER), W(BUFFER)]))
      .buffers[0];
    const end = title.indexOf(0);

    await word(system, 'USER', 'MessageBox', [
      W(hDlg),
      text(message),
      text(end < 0 ? title : title.slice(0, end)),
      W(MB_ICONHAND),
    ]);

    return;
  }

  await word(system, 'KERNEL', 'WriteProfileString', [
    text(bytesOf(PROGRAMS_SECTION)),
    text(name),
    text(path),
  ]);
  await api(system, 'USER', 'EndDialog', [W(hDlg), W(IDOK)]);
}

/** What the routine answers: the program found, or `ShellExecute`'s error. */
export type Located = { command: string } | { error: number };

/** The answer for the box cancelled (seg8 `0785`). */
const CANCELLED = 15;

/**
 * SHELL's unnamed ordinal 119 (`SHELL.DLL` seg8 `0570`-`078f`), which
 * `ShellExecute` calls once where `WinExec` of a registry association's
 * command answers 2 (seg4 `0fee`-`1020`):
 *
 * * The program is the command up to its first space; its name, past its
 *   last `\` or `:`, given `.exe` where it has no `.`.
 * * Where `OpenFile` finds the program as written, the 2 stands.
 * * WIN.INI's [programs] line for the name, where there is one and the
 *   file it names is there, is the program: the command made of it and the
 *   rest of the command, to be started again.
 * * Else the box, its folder the line's folder, or the root of the drive
 *   Windows is on; OK's path is the program, as above; Cancel answers 15,
 *   anything else 2.
 *
 * **Recorded** by `findexe`.
 */
export async function locateProgram(
  system: any,
  hwnd: number,
  command: string,
  extension: string
): Promise<Located> {
  const space = command.indexOf(' ');
  const program = space >= 0 ? command.slice(0, space) : command;
  const rest = space >= 0 ? command.slice(space) : '';
  const cut = Math.max(program.lastIndexOf('\\'), program.lastIndexOf(':'));
  let name = program.slice(cut + 1);

  if (!name.includes('.')) {
    name += PROGRAM_EXTENSION;
  }

  const exists = async (path: string) =>
    (await word(system, 'KERNEL', 'OpenFile', [text(bytesOf(path)), buffer(136), W(OF_EXIST)])) !==
    0xffff;

  /* The name made `.exe`'s in the program's own string (`061a`-`0635`). */
  const written = name === program.slice(cut + 1) ? program : program.slice(0, cut + 1) + name;

  if (await exists(written)) {
    return { error: 2 };
  }

  const line = await api(system, 'KERNEL', 'GetProfileString', [
    text(bytesOf(PROGRAMS_SECTION)),
    text(bytesOf(name)),
    text([]),
    buffer(BUFFER),
    W(BUFFER),
  ]);
  /* The answer is the fourth argument's buffer, after the three strings. */
  const returned = line.buffers[3];
  let folder = textOf(returned.slice(0, Math.max(0, returned.indexOf(0))));

  if (folder) {
    if (await exists(folder)) {
      return { command: folder + rest };
    }

    const slash = folder.lastIndexOf('\\');

    if (slash >= 0) {
      folder = folder.slice(0, folder[slash - 1] === ':' ? slash + 1 : slash);
    } else if (folder.lastIndexOf(':') >= 0) {
      folder = folder.slice(0, folder.lastIndexOf(':') + 1);
    }
  } else {
    const windows = await api(system, 'KERNEL', 'GetWindowsDirectory', [buffer(0xff), W(0xff)]);

    folder = textOf(windows.buffers[0].slice(0, 3));
  }

  /* The block and its strings, where the routine has its locals. */
  const size = 12 + 3 * BUFFER;
  const handle = await word(system, 'KERNEL', 'GlobalAlloc', [W(0x0042), D(size)]);
  const far = (await api(system, 'KERNEL', 'GlobalLock', [W(handle)])).value >>> 0;
  const at = (offset: number) => ((far & 0xffff0000) | ((far + offset) & 0xffff)) >>> 0;
  const put = (offset: number, value: number) => {
    core(system).write16((far >>> 16) & 0xffff, ((far & 0xffff) + offset) & 0xffff, value & 0xffff);
  };

  [NAME_AT, FOLDER_AT, EXTENSION_AT].forEach((offset, index) => {
    const pointer = at(12 + index * BUFFER);

    put(offset, pointer & 0xffff);
    put(offset + 2, pointer >>> 16);
  });
  writeFar(system, at(12), bytesOf(name));
  writeFar(system, at(12 + BUFFER), bytesOf(folder));
  writeFar(system, at(12 + 2 * BUFFER), bytesOf(extension));

  const shell = system._modules.instanceFromPath('C:\\WINDOWS\\SYSTEM\\SHELL.DLL') ?? 0;
  const template = parseDialogTemplate((offset) => FIND_PROGRAM_DIALOG[offset] ?? 0);
  const proc = shellProcAddress(system);
  const result = (await dialogBoxTemplate(system, shell, template, hwnd, proc, far)) & 0xffff;
  const path = textOf(readFar(system, at(12 + BUFFER)));

  await api(system, 'KERNEL', 'GlobalUnlock', [W(handle)]);
  await word(system, 'KERNEL', 'GlobalFree', [W(handle)]);

  if (result === IDOK) {
    return { command: path + rest };
  }

  return { error: result === IDCANCEL ? CANCELLED : 2 };
}

/** `FindExeDlgProc`'s far address, SHELL's ordinal 101: the box's procedure. */
function shellProcAddress(system: any) {
  const info = system._modules.load(system._modules.fromName('SHELL')).lookup(FIND_EXE_DLG_PROC);

  return ((segmentSelector(info.segment) << 16) | info.offset) >>> 0;
}
