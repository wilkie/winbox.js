'use strict';

import { api, bytesOf, item, itemText, sendItem, text, W, D, word } from '../commdlg/api.js';
import { parseDialogTemplate } from './dialog-template.js';
import { dialogBoxTemplate } from './dialogs.js';
import { USER_STRINGS } from './strings.js';

/**
 * USER's "Print To File" box: `GetFilePortName`, ordinal 343, which a
 * printer's driver calls for the port `FILE:`. **Read out** of `USER.EXE`
 * (seg1 `9c7c`, the box's procedure `9d0f`, the message helper `9cca`, its
 * dialog 10) and **recorded** by `filport`. As the Rust engine's
 * `print_to_file.rs`.
 *
 * The dialog is WinBox's own, laid out from its controls: no Windows file is
 * shipped and none of its bytes is copied here. `test/win16/print_to_file_test.ts`
 * compares it with `USER.EXE`'s dialog 10 where that is on disk.
 */

// The dialog's template: its style, its box in dialog units, its caption
// and font; then each control.

const WS_POPUP = 0x80000000;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_CAPTION = 0x00c00000;
const WS_BORDER = 0x00800000;
const WS_SYSMENU = 0x00080000;
const WS_TABSTOP = 0x00010000;
const DS_SETFONT = 0x40;
const DS_MODALFRAME = 0x80;
const ES_AUTOHSCROLL = 0x0080;
const BS_DEFPUSHBUTTON = 1;

const CLASS_BUTTON = 0x80;
const CLASS_EDIT = 0x81;
const CLASS_STATIC = 0x82;

/** The edit control the file's name is typed in. */
const ID_NAME = 10;
const ID_LABEL = 101;
const IDOK = 1;
const IDCANCEL = 2;
const IDYES = 6;

const STYLE = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME | DS_SETFONT;
const BOX = { x: 97, y: 60, cx: 200, cy: 52 };
const CAPTION = 'Print To File';
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

const CONTROLS: Control[] = [
  {
    x: 8,
    y: 6,
    cx: 63,
    cy: 10,
    id: ID_LABEL,
    style: WS_CHILD | WS_VISIBLE,
    class: CLASS_STATIC,
    text: '&Output File Name:',
  },
  {
    x: 9,
    y: 18,
    cx: 140,
    cy: 12,
    id: ID_NAME,
    style: WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL,
    class: CLASS_EDIT,
    text: '',
  },
  {
    x: 160,
    y: 6,
    cx: 35,
    cy: 14,
    id: IDOK,
    style: WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
    class: CLASS_BUTTON,
    text: 'OK',
  },
  {
    x: 160,
    y: 25,
    cx: 35,
    cy: 14,
    id: IDCANCEL,
    style: WS_CHILD | WS_VISIBLE | WS_TABSTOP,
    class: CLASS_BUTTON,
    text: 'Cancel',
  },
];

/** The box's `DLGTEMPLATE`, made from its controls. */
export function buildPrintToFileDialog(): Uint8Array {
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

export const PRINT_TO_FILE_DIALOG = buildPrintToFileDialog();

// What the procedure does.

const WM_INITDIALOG = 0x0110;
const WM_COMMAND = 0x0111;
const WM_GETTEXTLENGTH = 0x000e;
const EM_LIMITTEXT = 0x0415;
const EN_CHANGE = 0x0300;

/** The longest name the edit control takes (`9d3b`). */
const NAME_LIMIT = 63;
/** The buffer the name is read into (`9d7a`). */
const NAME_BUFFER = 64;

/** `OpenFile`'s modes: the name tried for writing, then made (`9d8e`, `9dc0`). */
const OF_WRITE = 0x0001;
const OF_SHARE_EXCLUSIVE = 0x0010;
const OF_CREATE = 0x1000;

/** USER's strings: the caption of its questions, the error, the question. */
const STRING_CAPTION = 0x3c;
const STRING_CANNOT_OPEN = 0x3d;
const STRING_OVERWRITE = 0x3e;

/** The message boxes' styles (`9da4`, `9dd1`). */
const MB_YESNO_ASTERISK = 0x0044;
const MB_OK_EXCLAMATION = 0x0030;

/** What `GetFilePortName` answers for Cancel: the spooler's `SP_USERABORT`. */
const SP_USERABORT = -3;

/** USER's words at 4E0h, the `OFSTRUCT` of the box that is up: one at a time. */
interface Box {
  ofs: number;
  /** The task's other windows the box disabled (seg42 `0000`). */
  disabled: number[];
}

/** A USER string as bytes. */
const stringBytes = (id: number) => bytesOf(USER_STRINGS.get(id) ?? '');

/**
 * The message box the procedure asks with (`9cca`): USER's string for the
 * text, 3Ch for the caption, owned by the box.
 */
async function ask(system: any, hDlg: number, textId: number, style: number) {
  return await word(system, 'USER', 'MessageBox', [
    W(hDlg),
    text(stringBytes(textId)),
    text(stringBytes(STRING_CAPTION)),
    W(style),
  ]);
}

/**
 * The task's other top-level windows disabled, as USER makes the box modal
 * to its task (seg42 `0000`-`006d`): each child of the desktop of the
 * running task's that is enabled and is not the box, disabled; and enabled
 * again as it ends (seg42 `0073`).
 */
async function disableTask(system: any, hDlg: number): Promise<number[]> {
  const task = await word(system, 'KERNEL', 'GetCurrentTask', []);
  const desktop = await word(system, 'USER', 'GetDesktopWindow', []);
  const windows: number[] = [];
  let hwnd = await word(system, 'USER', 'GetWindow', [W(desktop), W(5)]);

  while (hwnd) {
    windows.push(hwnd);
    hwnd = await word(system, 'USER', 'GetWindow', [W(hwnd), W(2)]);
  }

  const disabled: number[] = [];

  for (const each of windows) {
    if (
      each !== hDlg &&
      (await word(system, 'USER', 'GetWindowTask', [W(each)])) === task &&
      (await word(system, 'USER', 'IsWindowEnabled', [W(each)]))
    ) {
      await word(system, 'USER', 'EnableWindow', [W(each), W(0)]);
      disabled.push(each);
    }
  }

  return disabled;
}

async function enableTask(system: any, box: Box) {
  for (const each of box.disabled) {
    await word(system, 'USER', 'EnableWindow', [W(each), W(1)]);
  }

  box.disabled = [];
}

/** The box's procedure (`9d0f`). TRUE for what it answers, else nought. */
async function procedure(
  system: any,
  box: Box,
  hDlg: number,
  message: number,
  wParam: number,
  lParam: number
) {
  if (message === WM_INITDIALOG) {
    /* Modal to the task; the name limited to 63; OK disabled until there
     * is a name (`9d2b`-`9d53`). */
    box.disabled = await disableTask(system, hDlg);
    await sendItem(system, hDlg, ID_NAME, EM_LIMITTEXT, NAME_LIMIT, 0);
    await word(system, 'USER', 'EnableWindow', [W(await item(system, hDlg, IDOK)), W(0)]);

    return 1;
  }

  if (message !== WM_COMMAND) {
    return 0;
  }

  const id = wParam & 0xffff;

  if (id === ID_NAME) {
    /* OK enabled while the name is not empty (`9e03`-`9e2e`). */
    if (((lParam >>> 16) & 0xffff) === EN_CHANGE) {
      const ok = await item(system, hDlg, IDOK);

      if (ok) {
        const length = (await sendItem(system, hDlg, ID_NAME, WM_GETTEXTLENGTH, 0, 0)) & 0xffff;

        await word(system, 'USER', 'EnableWindow', [W(ok), W(length)]);
      }
    }

    return 1;
  }

  if (id === IDOK) {
    /* The name tried for writing: there and openable, asked before it is
     * replaced; then made, or the error told (`9d70`-`9df2`). */
    const name = await itemText(system, hDlg, ID_NAME, NAME_BUFFER);
    const tried = await word(system, 'KERNEL', 'OpenFile', [
      text(name),
      D(box.ofs),
      W(OF_WRITE | OF_SHARE_EXCLUSIVE),
    ]);

    if (tried !== 0xffff) {
      await word(system, 'KERNEL', '_lclose', [W(tried)]);

      if ((await ask(system, hDlg, STRING_OVERWRITE, MB_YESNO_ASTERISK)) !== IDYES) {
        return 1;
      }
    }

    const made = await word(system, 'KERNEL', 'OpenFile', [
      text(name),
      D(box.ofs),
      W(OF_CREATE | OF_WRITE),
    ]);

    if (made === 0xffff) {
      await ask(system, hDlg, STRING_CANNOT_OPEN, MB_OK_EXCLAMATION);
      return 1;
    }

    await word(system, 'KERNEL', '_lclose', [W(made)]);
    await enableTask(system, box);
    await api(system, 'USER', 'EndDialog', [W(hDlg), W(1)]);

    return 1;
  }

  if (id === IDCANCEL) {
    await enableTask(system, box);
    await api(system, 'USER', 'EndDialog', [W(hDlg), W(SP_USERABORT)]);

    return 1;
  }

  return 0;
}

/**
 * The **GetFilePortName** function asks for the name of a file for a
 * printer's output to go to, in USER's "Print To File" box, and makes the
 * file. Ordinal 343 of USER, which printers' drivers call for the port
 * `FILE:`.
 *
 * **Read out** (`USER.EXE` seg1 `9c7c`): -1 while a box is already up (the
 * far pointer kept at 4E0h); else `DialogBoxParam` of USER's dialog 10,
 * owned by the active window (108h), and its result -- 1 once the file is
 * made, its `OFSTRUCT` filled by `OpenFile`, or -3 (`SP_USERABORT`) for
 * Cancel. **Recorded** by `filport`.
 *
 * @param {Types.FARPTR} lpofs - The `OFSTRUCT` to fill.
 *
 * @returns {Types.INT} 1, -3 for Cancel, or -1 with a box already up.
 */
export async function GetFilePortName(this: any, lpofs: number) {
  const system = this;

  if (system._printToFile) {
    return 0xffff;
  }

  const box: Box = { ofs: lpofs >>> 0, disabled: [] };

  system._printToFile = box;

  try {
    const owner = await word(system, 'USER', 'GetActiveWindow', []);
    const user = system._modules.instanceFromPath('C:\\WINDOWS\\SYSTEM\\USER.EXE') ?? 0;
    const template = parseDialogTemplate((at) => PRINT_TO_FILE_DIALOG[at] ?? 0);
    const proc = (hDlg: number, message: number, wParam: number, lParam: number) =>
      procedure(system, box, hDlg, message, wParam, lParam);

    return (await dialogBoxTemplate(system, user, template, owner, proc, 0)) & 0xffff;
  } finally {
    system._printToFile = null;
  }
}
