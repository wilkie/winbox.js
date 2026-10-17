'use strict';

import {
  B,
  D,
  W,
  api,
  buffer,
  item,
  send,
  sendItem,
  sendItemBytes,
  setItemText,
  text,
  word,
} from './api.js';
import {
  CB_GETITEMDATA,
  CB_INSERTSTRING,
  CB_LIMITTEXT,
  CB_SETCURSEL,
  CB_SETEXTENDEDUI,
  CB_SETITEMDATA,
  CB_ADDSTRING,
  CDERR_NOHOOK,
  CHX_READONLY,
  CMB_DRIVES,
  CMB_TYPES,
  DW_LB_SUBCLASS,
  DW_OK_SUBCLASS,
  EDT_NAME,
  EM_LIMITTEXT,
  FNERR_INVALIDFILENAME,
  FNERR_SUBCLASSFAILURE,
  type FileDialog,
  GCL_WNDPROC,
  GWL_WNDPROC,
  IDOK,
  LB_SETCURSEL,
  LPFNHOOK,
  LPSTRCUSTOMFILTER,
  LPSTRFILE,
  LPSTRFILTER,
  LPSTRINITIALDIR,
  LPSTRTITLE,
  LST_FILES,
  LST_FOLDERS,
  NFILTERINDEX,
  NMAXCUSTFILTER,
  OFN_CREATEPROMPT,
  OFN_ENABLEHOOK,
  OFN_ENABLETEMPLATE,
  OFN_ENABLETEMPLATEHANDLE,
  OFN_FILEMUSTEXIST,
  OFN_HIDEREADONLY,
  OFN_NOCHANGEDIR,
  OFN_NOVALIDATE,
  OFN_PATHMUSTEXIST,
  OFN_READONLY,
  OFN_SHOWHELP,
  Ofn,
  PSH_HELP,
  STC_TYPES,
  SWP_NOZORDER,
  SW_HIDE,
  TAKE,
  WM_ACTIVATE,
  WM_COMMAND,
  WM_DRAWITEM,
  WM_INITDIALOG,
  WM_KILLFOCUS,
  WM_MEASUREITEM,
  WM_SYSCOLORCHANGE,
  afterString,
  commdlgState,
  commdlgString,
  customPattern,
  hasWildcard,
  lower,
  readString,
  shared,
  writeFar,
} from './file-dialogs.js';
import { command } from './file-command.js';
import {
  changeDirectory,
  colorsAndPictures,
  currentDirectory,
  currentDrive,
  drawItem,
  fillDrives,
  measureItem,
  refreshDrives,
  selectDrive,
} from './file-lists.js';
import { parseFile, EMPTY } from './parse-file.js';
import { procAddressOf } from './proc-address.js';
import { callHook, setError, waitCursor } from './state.js';
import { EndDialog } from '../user/dialogs.js';

/**
 * The file boxes' procedures, `FileOpenDlgProc` and `FileSaveDlgProc`
 * (`COMMDLG.DLL` seg2 `42a3`, `446a`), their `WM_INITDIALOG` (seg2 `1153`),
 * and the subclassed folders' list and OK button (seg2 `10a5`, `100f`). As
 * `file_init.rs`.
 */

/** The box's block changed. */
export function withDialog(system: any, hwnd: number, change: (data: FileDialog) => void) {
  const data = shared(system).dialogs.get(hwnd & 0xffff);

  if (data) {
    change(data);
  }
}

/** The box's block, as it is. */
export function dialogOf(system: any, hwnd: number): FileDialog | undefined {
  return shared(system).dialogs.get(hwnd & 0xffff);
}

/**
 * COMMDLG's Open box's procedure (seg2 `42a3`).
 *
 * @returns {Types.BOOL} Whether it took the message.
 */
export async function FileOpenDlgProc(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return await dialogProc(this, hwnd, message, wParam, lParam, false);
}

/**
 * COMMDLG's Save As box's procedure (seg2 `446a`).
 *
 * @returns {Types.BOOL} Whether it took the message.
 */
export async function FileSaveDlgProc(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return await dialogProc(this, hwnd, message, wParam, lParam, true);
}

async function dialogProc(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number,
  save: boolean
) {
  const data = dialogOf(system, hwnd);
  const sharedHook = shared(system).hook;

  /* The program's hook first: each message it answers is not COMMDLG's.
   * Before the box has its block, the hook kept as the box was asked for is
   * sent what comes before `WM_INITDIALOG` (seg2 `42b3`, `430c`). */
  if (data) {
    const hook = new Ofn(system, data.ofn).dword(LPFNHOOK);

    if (hook) {
      const answer = await callHook(system, hook, hwnd, message, wParam, lParam);

      if (answer) {
        return answer;
      }
    }
  } else if (sharedHook && message !== WM_INITDIALOG) {
    const answer = await callHook(system, sharedHook, hwnd, message, wParam, lParam);

    if (answer) {
      return answer;
    }
  }

  switch (message) {
    case WM_INITDIALOG: {
      shared(system).hook = 0;

      /* Save As's caption and its types' label, unless the program's
       * template is used (seg2 `4523`). */
      if (
        save &&
        !(new Ofn(system, lParam).flags() & (OFN_ENABLETEMPLATE | OFN_ENABLETEMPLATEHANDLE))
      ) {
        await api(system, 'USER', 'SetWindowText', [W(hwnd), text(commdlgString(0x181))]);
        await setItemText(system, hwnd, STC_TYPES, commdlgString(0x182));
      }

      commdlgState(system).initialising = true;

      try {
        return await init(system, hwnd, wParam, lParam);
      } finally {
        commdlgState(system).initialising = false;
        await waitCursor(system, false);
      }
    }
    case WM_COMMAND:
      return await command(system, hwnd, wParam, lParam, save);
    case WM_ACTIVATE: {
      const state = shared(system);

      if (!state.prompting) {
        if (state.firstActivate) {
          state.firstActivate = false;
        } else if (wParam) {
          await refreshDrives(system, hwnd);
        }
      }

      return 0;
    }
    case WM_SYSCOLORCHANGE:
      await colorsAndPictures(system);
      return 1;
    case WM_MEASUREITEM:
      await measureItem(system, hwnd, lParam);
      return 1;
    case WM_DRAWITEM:
      if (save || !shared(system).redrawOff) {
        await drawItem(system, hwnd, lParam, save);
      }

      return 1;
  }

  return 0;
}

/** `WM_INITDIALOG` (seg2 `1153`): the box's block, the controls set up from the structure, the lists filled, and the hook told. */
async function init(system: any, hwnd: number, wParam: number, far: number) {
  const ofn = new Ofn(system, far);
  const data: FileDialog = {
    ofn: far >>> 0,
    saved: [],
    scratch: [],
    filter: [],
    spec: [],
    depth: 0,
  };

  /* USER's procedures, which the subclasses hand on to (seg2 `1192`). */
  const listProc = await classProc(system, hwnd, LST_FOLDERS);
  const buttonProc = await classProc(system, hwnd, IDOK);

  shared(system).listProc = listProc;
  shared(system).buttonProc = buttonProc;

  if (!listProc || !buttonProc) {
    return await fail(system, hwnd, FNERR_SUBCLASSFAILURE);
  }

  let flags = ofn.flags();

  if (flags & OFN_NOCHANGEDIR) {
    data.saved = currentDirectory(system) ?? [];
  }

  /* The program's file name, lowered, checked (seg2 `1220`). */
  const given = ofn.string(LPSTRFILE);

  if (given && given.length && !(flags & OFN_NOVALIDATE)) {
    lower(given);

    if (given[2] === 0x5c && given[3] === 0x5c && given[1] === 0x3a) {
      given.splice(0, 2);
    }

    /* Changed in the program's own buffer, as the parser changes it. */
    const name = [...given, 0];
    const [offset, at] = parseFile(name);

    writeFar(system, ofn.dword(LPSTRFILE), name);

    if (offset < 0 && offset !== EMPTY && name[at] !== 0x3b) {
      return await fail(system, hwnd, FNERR_INVALIDFILENAME);
    }
  }

  const initial = ofn.string(LPSTRINITIALDIR);

  if (initial) {
    await changeDirectory(system, initial, true);
  }

  if (flags & OFN_ENABLEHOOK) {
    if (!ofn.dword(LPFNHOOK)) {
      return await fail(system, hwnd, CDERR_NOHOOK);
    }
  } else {
    ofn.setDword(LPFNHOOK, 0);
  }

  /* The block is the box's from now: its hook is sent all it is sent. */
  flags = (flags & 0x8fffffff) >>> 0;
  ofn.setFlags(flags);
  shared(system).dialogs.set(hwnd & 0xffff, data);

  if (!(flags & OFN_SHOWHELP)) {
    const help = await item(system, hwnd, PSH_HELP);

    await api(system, 'USER', 'ShowWindow', [W(help), W(SW_HIDE)]);
    await api(system, 'USER', 'EnableWindow', [W(help), W(0)]);
  }

  if (flags & OFN_CREATEPROMPT) {
    flags |= OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST;
  } else if (flags & OFN_FILEMUSTEXIST) {
    flags |= OFN_PATHMUSTEXIST;
  }

  ofn.setFlags(flags);

  if (flags & OFN_HIDEREADONLY) {
    const check = await item(system, hwnd, CHX_READONLY);

    await api(system, 'USER', 'ShowWindow', [W(check), W(SW_HIDE)]);
    await api(system, 'USER', 'EnableWindow', [W(check), W(0)]);
  } else {
    await api(system, 'USER', 'CheckDlgButton', [
      W(hwnd),
      W(CHX_READONLY),
      W(flags & OFN_READONLY ? 1 : 0),
    ]);
  }

  await sendItem(system, hwnd, EDT_NAME, EM_LIMITTEXT, 0x100, 0);
  await sendItem(system, hwnd, CMB_TYPES, CB_SETEXTENDEDUI, 1, 0);
  await sendItem(system, hwnd, CMB_DRIVES, CB_SETEXTENDEDUI, 1, 0);

  const file = ofn.string(LPSTRFILE);

  withDialog(system, hwnd, (block) => {
    block.spec = file && hasWildcard(file) ? file.slice() : [];
  });

  /* The custom filter, first among the types (seg2 `1587`). */
  const custom = ofn.dword(LPSTRCUSTOMFILTER);
  const customGiven = !!custom && readString(system, custom).length > 0;

  if (customGiven) {
    const description = readString(system, custom);

    await sendItemBytes(system, hwnd, CMB_TYPES, CB_INSERTSTRING, 0, text(description));
    await sendItem(system, hwnd, CMB_TYPES, CB_SETITEMDATA, 0, description.length + 1);
    await sendItem(system, hwnd, CMB_TYPES, CB_LIMITTEXT, ofn.word(NMAXCUSTFILTER), 0);

    const pattern = customPattern(system, custom);

    withDialog(system, hwnd, (block) => {
      if (!block.spec.length) {
        block.spec = pattern.slice();
      }
    });
  } else {
    ofn.setDword(NFILTERINDEX, (ofn.dword(NFILTERINDEX) - 1) >>> 0);
  }

  /* The types (seg2 `1646`). */
  const filter = ofn.dword(LPSTRFILTER);

  if (filter) {
    const last = await addFilters(system, hwnd, filter);
    const index = ofn.dword(NFILTERINDEX);

    if (index > last || (index << 16) >> 16 < 0) {
      ofn.setDword(NFILTERINDEX, 0);
    }
  } else {
    ofn.setDword(NFILTERINDEX, 0);
  }

  if (filter || customGiven) {
    const index = ofn.word(NFILTERINDEX);

    await sendItem(system, hwnd, CMB_TYPES, CB_SETCURSEL, index, 0);

    const types = await item(system, hwnd, CMB_TYPES);

    await send(system, hwnd, WM_COMMAND, CMB_TYPES, ((TAKE << 16) | types) >>> 0);

    const now = ofn.string(LPSTRFILE) ?? [];

    if (!now.length) {
      const chosen = ofn.word(NFILTERINDEX);
      let pattern: number[];

      if (chosen === 0 && customGiven) {
        pattern = customPattern(system, custom);
      } else {
        const offset =
          (await sendItem(system, hwnd, CMB_TYPES, CB_GETITEMDATA, chosen, 0)) & 0xffff;

        pattern = afterString(system, filter, offset);
      }

      if (pattern.length) {
        lower(pattern);
        withDialog(system, hwnd, (block) => {
          if (!block.spec.length) {
            block.spec = pattern.slice();
          }
        });
        await setItemText(system, hwnd, EDT_NAME, pattern);
      }
    }
  }

  /* The drives, the current one chosen, and the lists filled for it (seg2
   * `1818`). */
  const drive = currentDrive(system) + 0x61;

  await fillDrives(system, hwnd);
  await selectDrive(system, hwnd, drive);

  shared(system).firstActivate = true;
  shared(system).prompting = false;

  const drives = await item(system, hwnd, CMB_DRIVES);

  await send(system, hwnd, WM_COMMAND, CMB_DRIVES, ((TAKE << 16) | drives) >>> 0);

  const named = ofn.string(LPSTRFILE);

  if (named && named.length) {
    await setItemText(system, hwnd, EDT_NAME, named);
  }

  /* The folders' list and OK subclassed (seg2 `18ad`). */
  const folders = await item(system, hwnd, LST_FOLDERS);
  const button = await item(system, hwnd, IDOK);

  await api(system, 'USER', 'SetWindowLong', [
    W(folders),
    W(GWL_WNDPROC),
    D(procAddressOf(system, DW_LB_SUBCLASS)),
  ]);
  await api(system, 'USER', 'SetWindowLong', [
    W(button),
    W(GWL_WNDPROC),
    D(procAddressOf(system, DW_OK_SUBCLASS)),
  ]);

  const title = ofn.string(LPSTRTITLE);

  if (title && title.length) {
    await api(system, 'USER', 'SetWindowText', [W(hwnd), text(title)]);
  }

  /* The files' rows' height, until a row is measured (seg2 `191c`). */
  if (!shared(system).itemHeight) {
    const files = await item(system, hwnd, LST_FILES);
    const rect = (await api(system, 'USER', 'GetClientRect', [W(files), buffer(8)])).buffers[0];
    const bottom = ((rect[6] | (rect[7] << 8)) << 16) >> 16;
    const rows = Math.trunc(bottom / 8);

    shared(system).textHeight = rows === 0 ? 8 : rows & 0xffff;
  }

  /* COMMDLG's own template: the name as wide as the files' list (seg2 `195f`). */
  if (!(flags & (OFN_ENABLETEMPLATE | OFN_ENABLETEMPLATEHANDLE))) {
    const files = await item(system, hwnd, LST_FILES);
    const name = await item(system, hwnd, EDT_NAME);
    const list = (await api(system, 'USER', 'GetWindowRect', [W(files), buffer(8)])).buffers[0];
    const rect = (await api(system, 'USER', 'GetWindowRect', [W(name), buffer(8)])).buffers[0];

    rect[0] = list[0];
    rect[1] = list[1];
    rect[4] = list[4];
    rect[5] = list[5];

    const left = (await api(system, 'USER', 'ScreenToClient', [W(hwnd), B(rect.slice(0, 4))]))
      .buffers[0];
    const right = (await api(system, 'USER', 'ScreenToClient', [W(hwnd), B(rect.slice(4, 8))]))
      .buffers[0];
    const value = (bytes: number[], at: number) => ((bytes[at] | (bytes[at + 1] << 8)) << 16) >> 16;
    const x = value(left, 0);
    const y = value(left, 2);

    await api(system, 'USER', 'SetWindowPos', [
      W(name),
      W(0),
      W(x),
      W(y),
      W(value(right, 0) - x),
      W(value(right, 2) - y),
      W(SWP_NOZORDER),
    ]);
  }

  const hook = ofn.dword(LPFNHOOK);

  if (hook) {
    return await callHook(system, hook, hwnd, WM_INITDIALOG, wParam, far);
  }

  return 1;
}

/** A class's procedure, by one of the box's controls (`GetClassLong` with `GCL_WNDPROC`). */
async function classProc(system: any, hwnd: number, id: number) {
  const control = await item(system, hwnd, id);

  return (await api(system, 'USER', 'GetClassLong', [W(control), W(GCL_WNDPROC)])).value >>> 0;
}

/** The box refused as it starts: the error set and the box ended with nought, its block let go. */
async function fail(system: any, hwnd: number, code: number) {
  setError(system, code);
  shared(system).dialogs.delete(hwnd & 0xffff);
  await EndDialog.call(system, hwnd, 0);

  return 0;
}

/** The types from the program's filter: each description added, its pattern's offset from the filter's start kept as its data (seg2 `469c`). The last one's index. */
async function addFilters(system: any, hwnd: number, filter: number) {
  let offset = 0;
  let last = 0;

  for (;;) {
    const description = afterString(system, filter, offset);

    if (!description.length) {
      return last;
    }

    last =
      (await sendItemBytes(system, hwnd, CMB_TYPES, CB_ADDSTRING, 0, text(description))).value &
      0xffff;
    offset = (offset + description.length + 1) & 0xffff;
    await sendItem(system, hwnd, CMB_TYPES, CB_SETITEMDATA, last, offset);

    const pattern = afterString(system, filter, offset);

    offset = (offset + pattern.length + 1) & 0xffff;
  }
}

/**
 * The folders' list subclassed (`dwLBSubclass`, seg2 `10a5`): losing the
 * focus to anything but OK, its selection goes back to the current folder.
 *
 * @returns {Types.LRESULT} The list box's answer.
 */
export async function dwLBSubclass(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const system = this;

  if (message === WM_KILLFOCUS) {
    const dialog = await word(system, 'USER', 'GetParent', [W(hwnd)]);
    const ok = await item(system, dialog, IDOK);
    const toOk = (wParam & 0xffff) === ok;

    shared(system).okFromFolders = toOk;

    const data = dialogOf(system, dialog);

    if (!toOk && data) {
      await send(system, hwnd, LB_SETCURSEL, (data.depth - 1) & 0xffff, 0);
    }
  }

  return await callWindowProc(system, shared(system).listProc, hwnd, message, wParam, lParam);
}

/**
 * OK subclassed (`dwOKSubclass`, seg2 `100f`): losing the focus after it
 * took it from the folders' list, their selection goes back to the current
 * folder.
 *
 * @returns {Types.LRESULT} The button's answer.
 */
export async function dwOKSubclass(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const system = this;

  if (message === WM_KILLFOCUS && shared(system).okFromFolders) {
    const dialog = await word(system, 'USER', 'GetParent', [W(hwnd)]);
    const data = dialogOf(system, dialog);

    if (data) {
      await sendItem(system, dialog, LST_FOLDERS, LB_SETCURSEL, (data.depth - 1) & 0xffff, 0);
    }

    shared(system).okFromFolders = false;
  }

  return await callWindowProc(system, shared(system).buttonProc, hwnd, message, wParam, lParam);
}

async function callWindowProc(
  system: any,
  proc: number,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return (
    await api(system, 'USER', 'CallWindowProc', [
      D(proc),
      W(hwnd),
      W(message),
      W(wParam),
      D(lParam),
    ])
  ).value;
}
