'use strict';

import {
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
  BM_SETSTYLE,
  CBN_CLOSEUP,
  CBN_DROPDOWN,
  CBN_SELCHANGE,
  CB_GETCURSEL,
  CB_GETITEMDATA,
  CB_GETLBTEXT,
  CB_SHOWDROPDOWN,
  CMB_DRIVES,
  CMB_TYPES,
  DRIVES_DROPPED,
  EDT_NAME,
  EM_SETSEL,
  EN_CHANGE,
  FNERR_BUFFERTOOSMALL,
  FOLDER_MOVED,
  HWNDOWNER,
  IDABORT,
  IDCANCEL,
  IDOK,
  LBN_DBLCLK,
  LBN_KILLFOCUS,
  LBN_SELCHANGE,
  LBN_SETFOCUS,
  LB_FINDSTRING,
  LB_GETCARETINDEX,
  LB_GETCURSEL,
  LB_GETSEL,
  LB_GETSELCOUNT,
  LB_GETSELITEMS,
  LB_GETTEXT,
  LB_GETTOPINDEX,
  LB_SETCARETINDEX,
  LB_SETTOPINDEX,
  LPFNHOOK,
  LPSTRCUSTOMFILTER,
  LPSTRFILE,
  LPSTRFILTER,
  LST_FILES,
  LST_FOLDERS,
  NFILTERINDEX,
  NMAXCUSTFILTER,
  OFN_ALLOWMULTISELECT,
  OFN_ENABLEHOOK,
  OFN_NOCHANGEDIR,
  OFN_NOVALIDATE,
  Ofn,
  PSH_HELP,
  TAKE,
  TYPES_DROPPED,
  WM_COMMAND,
  WM_GETTEXT,
  afterString,
  commdlgState,
  customPattern,
  hasWildcard,
  lower,
  readFar,
  readString,
  shared,
  terminated,
  writeFar,
} from './file-dialogs.js';
import { dialogOf, withDialog } from './file-init.js';
import {
  applySpec,
  changeDirectory,
  currentDrive,
  driveReady,
  refresh,
  selectDrive,
  showDriveError,
  stripPath,
} from './file-lists.js';
import { nameTaken } from './file-ok.js';
import { callHook, message as registered, setError, waitCursor } from './state.js';
import { EndDialog } from '../user/dialogs.js';

/**
 * The file boxes' `WM_COMMAND` (`COMMDLG.DLL` seg2 `31f4`): OK, Cancel,
 * Help, and what each list, combo box and the name tell the box. As
 * `file_command.rs`.
 */

/** What the box does with a command: its answer, nought for one it leaves be. */
export async function command(
  system: any,
  hwnd: number,
  id: number,
  lParam: number,
  save: boolean
) {
  const code = (lParam >>> 16) & 0xffff;
  const control = lParam & 0xffff;

  switch (id & 0xffff) {
    case LST_FILES:
      return await files(system, hwnd, code, control);
    case IDOK:
      return await ok(system, hwnd, save);
    case IDCANCEL:
      return await end(system, hwnd, IDCANCEL, 0);
    /* A hook ends the box with what it gives (seg2 `33a6`). */
    case IDABORT:
      return await end(system, hwnd, IDABORT, lParam & 0xffff);
    case PSH_HELP:
      return await help(system, hwnd);
    case LST_FOLDERS:
      return await folders(system, hwnd, code);
    case CMB_TYPES:
      return await types(system, hwnd, code, lParam);
    case CMB_DRIVES:
      return await drives(system, hwnd, code, lParam);
    case EDT_NAME:
      return await name(system, hwnd, code, control);
  }

  return 0;
}

function flagsOf(system: any, hwnd: number) {
  const data = dialogOf(system, hwnd);

  return data ? new Ofn(system, data.ofn).flags() : 0;
}

function changeFlags(system: any, hwnd: number, change: (flags: number) => number) {
  const data = dialogOf(system, hwnd);

  if (data) {
    const ofn = new Ofn(system, data.ofn);

    ofn.setFlags(change(ofn.flags()) >>> 0);
  }
}

function hookOf(system: any, hwnd: number) {
  const data = dialogOf(system, hwnd);

  return data ? new Ofn(system, data.ofn).dword(LPFNHOOK) : 0;
}

async function tellHook(system: any, hwnd: number, msg: number, wParam: number, lParam: number) {
  const hook = hookOf(system, hwnd);

  return hook ? await callHook(system, hook, hwnd, msg, wParam, lParam) : 0;
}

/** OK (seg2 `3225`): a dropped combo box closed, or the folders' list's row gone into, rather than the name taken when they have the focus. */
async function ok(system: any, hwnd: number, save: boolean) {
  const flags = flagsOf(system, hwnd);

  if (shared(system).okFromFolders) {
    shared(system).okFromFolders = false;
    return await folderChosen(system, hwnd);
  }

  const focus = await word(system, 'USER', 'GetFocus', []);

  if (focus === (await item(system, hwnd, LST_FOLDERS)) && flags & FOLDER_MOVED) {
    shared(system).okFromFolders = false;
    return await folderChosen(system, hwnd);
  }

  if (focus === (await item(system, hwnd, CMB_DRIVES)) && flags & DRIVES_DROPPED) {
    await sendItem(system, hwnd, CMB_DRIVES, CB_SHOWDROPDOWN, 0, 0);
    return 0;
  }

  if (focus === (await item(system, hwnd, CMB_TYPES)) && flags & TYPES_DROPPED) {
    await sendItem(system, hwnd, CMB_TYPES, CB_SHOWDROPDOWN, 0, 0);
    return await typeTaken(system, hwnd);
  }

  if (!(await nameTaken(system, hwnd, save))) {
    await sendItem(system, hwnd, EDT_NAME, EM_SETSEL, 0, 0x7fff0000);
    return 1;
  }

  const data = dialogOf(system, hwnd);

  if (!data) {
    return 1;
  }

  const ofn = new Ofn(system, data.ofn);
  const file = ofn.dword(LPSTRFILE);
  let result = 1;

  if (
    file &&
    !readFar(system, (((file >>> 16) << 16) | (((file & 0xffff) + 2) & 0xffff)) >>> 0, 1)[0]
  ) {
    if (!(ofn.flags() & OFN_NOVALIDATE)) {
      setError(system, FNERR_BUFFERTOOSMALL);
      result = 0;
    }
  }

  return await end(system, hwnd, IDOK, result);
}

/**
 * The box ended (seg2 `33ad`): the type chosen and the spec written back,
 * the hook asked with `FILEOKSTRING` for OK, the block let go, the folder
 * gone back to with `OFN_NOCHANGEDIR`, and `EndDialog`.
 */
async function end(system: any, hwnd: number, id: number, result: number) {
  const data = dialogOf(system, hwnd);

  if (!data) {
    return 0;
  }

  const ofn = new Ofn(system, data.ofn);
  const index = (await sendItem(system, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0)) & 0xffff;

  ofn.setDword(NFILTERINDEX, index);

  const custom = ofn.dword(LPSTRCUSTOMFILTER);

  if (custom) {
    const description = readString(system, custom).length + 1;

    if (description + data.spec.length < ofn.dword(NMAXCUSTFILTER)) {
      writeFar(
        system,
        ((custom & 0xffff0000) | (((custom & 0xffff) + description) & 0xffff)) >>> 0,
        [...data.spec, 0]
      );
    }
  }

  if (!custom || !readString(system, custom).length) {
    ofn.setDword(NFILTERINDEX, (ofn.dword(NFILTERINDEX) + 1) >>> 0);
  }

  if (id === IDOK) {
    const fileOk = registered(system, 'commdlg_FileNameOK');

    if (await tellHook(system, hwnd, fileOk, 0, data.ofn)) {
      await waitCursor(system, false);
      return 0;
    }
  }

  shared(system).dialogs.delete(hwnd & 0xffff);

  const flags = ofn.flags();

  if (flags & OFN_ENABLEHOOK) {
    shared(system).hook = ofn.dword(LPFNHOOK);
  }

  if (flags & OFN_NOCHANGEDIR && data.saved.length) {
    await changeDirectory(system, data.saved, false);
  }

  await EndDialog.call(system, hwnd, (result << 16) >> 16);
  return 1;
}

/** Help (seg2 `420d`): the owner sent `HELPMSGSTRING`, with the box and the structure. */
async function help(system: any, hwnd: number) {
  const data = dialogOf(system, hwnd);

  if (!data) {
    return 0;
  }

  const owner = new Ofn(system, data.ofn).word(HWNDOWNER);

  if (owner) {
    await send(system, owner, registered(system, 'commdlg_help'), hwnd, data.ofn);
  }

  return 0;
}

/** The files' list (seg2 `3640`): a double click is OK; a selection puts its name, lowered, a period after one with none, in the name. */
async function files(system: any, hwnd: number, code: number, control: number) {
  if (code === LBN_DBLCLK) {
    await send(system, hwnd, WM_COMMAND, IDOK, 0);
    return 1;
  }

  const data = dialogOf(system, hwnd);

  if (!data || code !== LBN_SELCHANGE) {
    return 0;
  }

  const ofn = new Ofn(system, data.ofn);
  const hook = ofn.dword(LPFNHOOK);
  let index = 0;
  let kind = 0;

  if (ofn.flags() & OFN_ALLOWMULTISELECT) {
    await severalChosen(system, hwnd, control);

    if (hook) {
      const caret = (await send(system, control, LB_GETCARETINDEX, 0, 0)) & 0xffff;

      if (caret & 0x8000) {
        index = caret;
        kind = 0xffff;
      } else {
        index = caret;
        kind = (await send(system, control, LB_GETSEL, caret, 0)) ? 2 : 1;
      }
    }
  } else {
    const at = (await send(system, control, LB_GETCURSEL, 0, 0)) & 0xffff;
    const chosen = stringOf(await sendBytes(system, control, LB_GETTEXT, at, buffer(256)));

    if (!chosen.includes(0x2e)) {
      chosen.push(0x2e);
    }

    lower(chosen);
    await setItemText(system, hwnd, EDT_NAME, chosen);

    if (hook) {
      index = (await send(system, control, LB_GETCURSEL, 0, 0)) & 0xffff;
    }
  }

  if (hook) {
    await tellHook(
      system,
      hwnd,
      registered(system, 'commdlg_LBSelChangedNotify'),
      LST_FILES,
      ((kind << 16) | index) >>> 0
    );
  }

  await sendItem(system, hwnd, EDT_NAME, EM_SETSEL, 0, 0x7fff0000);
  return 1;
}

/** Several files chosen: their names, each with a period where it has none, a space between, lowered, in the name (seg2 `368a`). */
async function severalChosen(system: any, hwnd: number, control: number) {
  const count = (await send(system, control, LB_GETSELCOUNT, 0, 0)) & 0xffff;

  if (!count) {
    await setItemText(system, hwnd, EDT_NAME, []);
    return;
  }

  const items = await sendBytes(system, control, LB_GETSELITEMS, count, buffer(count * 2));
  const got = items.value & 0xffff;
  const indices: number[] = [];

  for (let i = 0; i < got && i * 2 + 1 < items.buffers[0].length; i++) {
    indices.push(items.buffers[0][i * 2] | (items.buffers[0][i * 2 + 1] << 8));
  }

  let names: number[] = [];

  for (const index of indices) {
    const chosen = stringOf(await sendBytes(system, control, LB_GETTEXT, index, buffer(256)));

    if (!chosen.includes(0x2e)) {
      chosen.push(0x2e);
    }

    names = [...names, ...chosen, 0x20];

    if (names.length > 0x7f1) {
      break;
    }
  }

  if (names[names.length - 1] === 0x20) {
    names.pop();
  }

  lower(names);
  await setItemText(system, hwnd, EDT_NAME, names);
}

/** The name (seg2 `3563`): as it changes, the files' list scrolled to the first file it begins. */
async function name(system: any, hwnd: number, code: number, control: number) {
  if (code !== EN_CHANGE) {
    return 0;
  }

  const list = await item(system, hwnd, LST_FILES);
  const caret = (await send(system, list, LB_GETCARETINDEX, 0, 0)) & 0xffff;
  const typed = stringOf(await sendBytes(system, control, WM_GETTEXT, 0x100, buffer(0x100)));
  const found = (await sendBytes(system, list, LB_FINDSTRING, caret, text(typed))).value & 0xffff;

  if (found !== 0xffff) {
    const top = (await send(system, list, LB_GETTOPINDEX, 0, 0)) & 0xffff;
    const rect = (await api(system, 'USER', 'GetClientRect', [W(list), buffer(8)])).buffers[0];
    const bottom = rect[6] | (rect[7] << 8);
    const height = Math.max(shared(system).textHeight, 1);

    if (top > found || Math.trunc(bottom / height) + top <= found) {
      await send(system, list, LB_SETCARETINDEX, found, 0);
      await send(system, list, LB_SETTOPINDEX, found, 0);
    }
  }

  return 1;
}

/** The types' combo box (seg2 `391f`): with the extended interface, a selection made while it is dropped is taken as it closes. */
async function types(system: any, hwnd: number, code: number, lParam: number) {
  switch (code) {
    case CBN_SELCHANGE:
      if (flagsOf(system, hwnd) & TYPES_DROPPED) {
        return 1;
      }

      changeFlags(system, hwnd, (flags) => flags & ~TYPES_DROPPED);
      return await typeTaken(system, hwnd);
    case CBN_DROPDOWN:
      changeFlags(system, hwnd, (flags) => flags | TYPES_DROPPED);
      return 1;
    case CBN_CLOSEUP:
      await post(system, hwnd, WM_COMMAND, CMB_TYPES, ((TAKE << 16) | (lParam & 0xffff)) >>> 0);
      return 1;
    case TAKE:
      changeFlags(system, hwnd, (flags) => flags & ~TYPES_DROPPED);
      return await typeTaken(system, hwnd);
  }

  return 0;
}

/** A type taken (seg2 `398f`): its pattern the files' spec, and the name's, where the name is nothing or a wildcard. */
async function typeTaken(system: any, hwnd: number) {
  const index = (await sendItem(system, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0)) & 0xffff;

  if (index & 0x8000) {
    return 0;
  }

  await waitCursor(system, true);

  const data = dialogOf(system, hwnd);

  if (!data) {
    return 0;
  }

  const ofn = new Ofn(system, data.ofn);
  const custom = ofn.dword(LPSTRCUSTOMFILTER);
  let pattern: number[];

  if (index === 0 && custom && readString(system, custom).length) {
    pattern = customPattern(system, custom);
  } else {
    const offset = (await sendItem(system, hwnd, CMB_TYPES, CB_GETITEMDATA, index, 0)) & 0xffff;

    pattern = afterString(system, ofn.dword(LPSTRFILTER), offset);
  }

  if (pattern.length) {
    const typed = await itemText(system, hwnd, EDT_NAME, 0xff);
    const replace = !typed.length || hasWildcard(typed);
    const spec = pattern.slice();

    if (replace) {
      lower(spec);
      await setItemText(system, hwnd, EDT_NAME, spec);
      await sendItem(system, hwnd, EDT_NAME, EM_SETSEL, 0, 0x7fff0000);
    }

    await applySpec(system, spec, hwnd);

    if (!commdlgState(system).initialising) {
      const kept = terminated(spec);

      withDialog(system, hwnd, (block) => (block.spec = kept));
    }
  }

  await tellHook(system, hwnd, registered(system, 'commdlg_LBSelChangedNotify'), CMB_TYPES, index);
  await waitCursor(system, false);
  return 1;
}

/** The folders' list (seg2 `3b94`). */
async function folders(system: any, hwnd: number, code: number) {
  switch (code) {
    /* A row other than the current folder's chosen: kept to be gone into by
     * OK, the name's path taken off. */
    case LBN_SELCHANGE: {
      if (!(flagsOf(system, hwnd) & FOLDER_MOVED)) {
        const at = (await sendItem(system, hwnd, LST_FOLDERS, LB_GETCURSEL, 0, 0)) & 0xffff;
        const depth = dialogOf(system, hwnd)?.depth ?? 0;

        if (((depth - at - 1) & 0xffff) !== 0) {
          await stripPath(system, hwnd);
          changeFlags(system, hwnd, (flags) => flags | FOLDER_MOVED);
        }
      }

      return 1;
    }
    case LBN_SETFOCUS: {
      const ok = await item(system, hwnd, IDOK);

      await api(system, 'USER', 'EnableWindow', [W(ok), W(1)]);

      const cancel = await item(system, hwnd, IDCANCEL);

      await send(system, cancel, BM_SETSTYLE, 0, 1);
      return 0;
    }
    case LBN_KILLFOCUS:
      if (dialogOf(system, hwnd) && flagsOf(system, hwnd) & FOLDER_MOVED) {
        changeFlags(system, hwnd, (flags) => flags & ~FOLDER_MOVED);
      } else {
        shared(system).okFromFolders = false;
      }

      return 0;
    case LBN_DBLCLK:
      return await folderChosen(system, hwnd);
  }

  return 0;
}

/** A folder's row gone into (seg2 `3c7e`): the path to it made from the rows above it, or its name below the current folder. */
export async function folderChosen(system: any, hwnd: number) {
  changeFlags(system, hwnd, (flags) => flags & ~FOLDER_MOVED);

  const at = (await sendItem(system, hwnd, LST_FOLDERS, LB_GETCURSEL, 0, 0)) & 0xffff;
  const depth = dialogOf(system, hwnd)?.depth ?? 0;
  let path: number[];
  let row: number;

  if (depth <= at) {
    path = await listText(system, hwnd, LST_FOLDERS, LB_GETTEXT, at);
    row = depth;
  } else {
    path = await listText(system, hwnd, LST_FOLDERS, LB_GETTEXT, 0);

    for (let each = 1; each <= at; each++) {
      path = [...path, ...(await listText(system, hwnd, LST_FOLDERS, LB_GETTEXT, each)), 0x5c];
    }

    if (at) {
      path.pop();
    }

    row = at;
  }

  withDialog(system, hwnd, (block) => (block.scratch = path.slice()));

  if (path.length && (await changeDirectory(system, path, true))) {
    return 0;
  }

  await refresh(system, hwnd, null, 0x10);
  await tellHook(system, hwnd, registered(system, 'commdlg_LBSelChangedNotify'), LST_FOLDERS, row);
  return 1;
}

/** The drives' combo box (seg2 `3df3`). */
async function drives(system: any, hwnd: number, code: number, lParam: number) {
  switch (code) {
    case CBN_SELCHANGE:
      await stripPath(system, hwnd);

      if (flagsOf(system, hwnd) & DRIVES_DROPPED) {
        return 1;
      }

      return await driveTaken(system, hwnd);
    case CBN_DROPDOWN:
      changeFlags(system, hwnd, (flags) => flags | DRIVES_DROPPED);
      return 1;
    case CBN_CLOSEUP:
      await post(system, hwnd, WM_COMMAND, CMB_DRIVES, ((TAKE << 16) | (lParam & 0xffff)) >>> 0);
      return 1;
    case TAKE:
      return await driveTaken(system, hwnd);
  }

  return 0;
}

/** A drive taken (seg2 `3e5a`): gone to, and its folders and files listed; a drive that cannot be read said so, and the current one taken again. */
async function driveTaken(system: any, hwnd: number) {
  await waitCursor(system, true);
  changeFlags(system, hwnd, (flags) => flags & ~DRIVES_DROPPED);

  const at = (await sendItem(system, hwnd, CMB_DRIVES, CB_GETCURSEL, 0, 0)) & 0xffff;
  const chosen = await listText(system, hwnd, CMB_DRIVES, CB_GETLBTEXT, at);

  if (!chosen.length) {
    await waitCursor(system, false);
    return 1;
  }

  let letter = chosen[0];
  let current = currentDrive(system) + 0x61;
  const data = dialogOf(system, hwnd);
  let spec: number[] | null = null;

  /* As the box starts, the spec is the program's file name where it has a
   * wildcard, else the type's pattern (seg2 `3eae`). */
  if (commdlgState(system).initialising && data) {
    const ofn = new Ofn(system, data.ofn);
    const file = ofn.string(LPSTRFILE) ?? [];

    if (hasWildcard(file)) {
      spec = file;
    } else {
      const index = (await sendItem(system, hwnd, CMB_TYPES, CB_GETCURSEL, 0, 0)) & 0xffff;

      if (!(index & 0x8000)) {
        const custom = ofn.dword(LPSTRCUSTOMFILTER);

        if (index === 0 && custom && readString(system, custom).length) {
          spec = customPattern(system, custom);
        } else {
          const offset =
            (await sendItem(system, hwnd, CMB_TYPES, CB_GETITEMDATA, index, 0)) & 0xffff;

          spec = afterString(system, ofn.dword(LPSTRFILTER), offset);
        }
      }
    }

    if (spec) {
      lower(spec);
    }
  }

  let tried = driveReady(system, letter);

  for (;;) {
    if (tried && (await refresh(system, hwnd, spec, 0x4010))) {
      const index = (await sendItem(system, hwnd, CMB_DRIVES, CB_GETCURSEL, 0, 0)) & 0xffff;

      await tellHook(
        system,
        hwnd,
        registered(system, 'commdlg_LBSelChangedNotify'),
        CMB_DRIVES,
        index
      );
      break;
    }

    /* Not read: said so, unless the box is just made; Retry tries it again,
     * Cancel goes back to the current drive and lists it whatever it answers
     * (seg2 `405f`). */
    if (await showDriveError(system, hwnd, letter)) {
      tried = driveReady(system, letter);

      if (tried) {
        await selectDrive(system, hwnd, letter);
      }

      continue;
    }

    if (letter === current && (await changeDirectory(system, [0x5c], true))) {
      current = 0x63;
    }

    letter = current;
    driveReady(system, letter);
    await selectDrive(system, hwnd, letter);
    tried = true;
  }

  await waitCursor(system, false);
  return 1;
}
