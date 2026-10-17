'use strict';

import { type Arg, D, W, api, bytesOf, item } from './api.js';
import {
  callHook,
  dword,
  freeTemplate,
  instance,
  nextNumber,
  ownTemplate,
  procAddress,
  registered,
  setDword,
  setError,
  setWindowText,
  stateOf,
  string,
  word,
} from './guest-calls.js';
import { FIND_TEMPLATE, REPLACE_TEMPLATE } from './templates.js';

/**
 * COMMDLG's Find and Replace dialogs: `FindText` (11), `ReplaceText` (12)
 * and their procedures, `FindTextDlgProc` (13) and `ReplaceTextDlgProc`
 * (14), which USER calls at COMMDLG's own exports as it would Microsoft's.
 * **Read out** of `COMMDLG.DLL` seg5 and **recorded** by `findrepl`; each
 * step is COMMDLG's, at the address the comments give. Its calls into
 * USER and KERNEL are made through `api.ts`, as a program makes them. The
 * twin of `crates/winbox-win16/src/commdlg/find_replace.rs`.
 */

const WM_CLOSE = 0x0010;
const WM_GETTEXTLENGTH = 0x000e;
const WM_INITDIALOG = 0x0110;
const WM_COMMAND = 0x0111;
const EN_CHANGE = 0x0300;

const IDOK = 1;
const IDCANCEL = 2;
const PSH_REPLACE = 0x400;
const PSH_REPLACE_ALL = 0x401;
const PSH_HELP = 0x40e;
const CHX_WHOLE_WORD = 0x410;
const CHX_MATCH_CASE = 0x411;
const RAD_UP = 0x420;
const RAD_DOWN = 0x421;
const GRP_DIRECTION = 0x430;
const EDT_FIND = 0x480;
const EDT_REPLACE = 0x481;

const FR_DOWN = 0x1;
const FR_WHOLEWORD = 0x2;
const FR_MATCHCASE = 0x4;
const FR_FINDNEXT = 0x8;
const FR_REPLACE = 0x10;
const FR_REPLACEALL = 0x20;
const FR_SHOWHELP = 0x80;
const FR_ENABLEHOOK = 0x100;
const FR_ENABLETEMPLATE = 0x200;
const FR_NOUPDOWN = 0x400;
const FR_NOMATCHCASE = 0x800;
const FR_NOWHOLEWORD = 0x1000;
const FR_ENABLETEMPLATEHANDLE = 0x2000;
const FR_HIDEUPDOWN = 0x4000;
const FR_HIDEMATCHCASE = 0x8000;
const FR_HIDEWHOLEWORD = 0x10000;

const CDERR_STRUCTSIZE = 0x1;
const CDERR_LOADSTRFAILURE = 0x5;
const CDERR_FINDRESFAILURE = 0x6;
const CDERR_LOADRESFAILURE = 0x7;
const CDERR_LOCKRESFAILURE = 0x8;
const CDERR_NOHOOK = 0xb;
const CDERR_REGISTERMSGFAIL = 0xc;
const FRERR_BUFFERLENGTHZERO = 0x4001;

const SW_HIDE = 0;
const SW_SHOWNORMAL = 1;
const SW_SHOW = 5;
const RT_DIALOG = 5;

/** The structure's fields, by offset. */
const HWND_OWNER = 0x04;
const H_INSTANCE = 0x06;
const FLAGS = 0x08;
const FIND_WHAT = 0x0c;
const REPLACE_WITH = 0x10;
const FIND_LENGTH = 0x14;
const REPLACE_LENGTH = 0x16;
const HOOK = 0x1c;
const TEMPLATE_NAME = 0x20;

/** A call's answer, DX:AX. */
const call = async (system: any, module: string, name: string, args: Arg[]) =>
  (await api(system, module, name, args)).value;

const show = (system: any, hwnd: number, how: number) =>
  call(system, 'USER', 'ShowWindow', [W(hwnd), W(how)]);

const enable = (system: any, hwnd: number, on: number) =>
  call(system, 'USER', 'EnableWindow', [W(hwnd), W(on)]);

/** The two calls: Find, or Replace (seg5 `0000`, `019c`). */
async function open(system: any, lpfr: number, replace: boolean): Promise<number> {
  if (!lpfr) {
    return 0;
  }

  const fail = (code: number) => {
    setError(system, code);
    return 0;
  };

  if (dword(system, lpfr) !== 0x24) {
    return fail(CDERR_STRUCTSIZE);
  }

  const owner = word(system, lpfr, HWND_OWNER);
  const isWindow = !!(await call(system, 'USER', 'IsWindow', [W(owner)]));

  if (
    !isWindow ||
    !dword(system, lpfr, FIND_WHAT) ||
    !word(system, lpfr, FIND_LENGTH) ||
    (replace && (!dword(system, lpfr, REPLACE_WITH) || !word(system, lpfr, REPLACE_LENGTH)))
  ) {
    return fail(FRERR_BUFFERLENGTHZERO);
  }

  const flags = dword(system, lpfr, FLAGS);

  if (flags & FR_ENABLEHOOK) {
    if (!dword(system, lpfr, HOOK)) {
      return fail(CDERR_NOHOOK);
    }
  } else {
    setDword(system, lpfr, HOOK, 0);
  }

  /* Replace loads "Close" for Cancel, from its string 40Dh (`0231`). */
  if (replace && string(0x40d) === null) {
    return fail(CDERR_LOADSTRFAILURE);
  }

  const message = registered(system, 'commdlg_FindReplace');

  if (!message) {
    return fail(CDERR_REGISTERMSGFAIL);
  }

  const state = stateOf(system);

  state.find.findMessage = message;

  /* The template: the program's by name, its handle, or COMMDLG's own. */
  const program = word(system, lpfr, H_INSTANCE);
  let handle: number;
  let own = false;

  if (flags & FR_ENABLETEMPLATE) {
    const found =
      (await call(system, 'KERNEL', 'FindResource', [
        W(program),
        D(dword(system, lpfr, TEMPLATE_NAME)),
        D(RT_DIALOG),
      ])) & 0xffff;

    if (!found) {
      return fail(CDERR_FINDRESFAILURE);
    }

    handle = (await call(system, 'KERNEL', 'LoadResource', [W(program), W(found)])) & 0xffff;

    if (!handle) {
      return fail(CDERR_LOADRESFAILURE);
    }
  } else if (flags & FR_ENABLETEMPLATEHANDLE) {
    handle = program;
  } else {
    handle = await ownTemplate(system, replace ? REPLACE_TEMPLATE : FIND_TEMPLATE);
    own = true;
  }

  const template = (await call(system, 'KERNEL', 'LockResource', [W(handle)])) >>> 0;

  if (!template) {
    return fail(CDERR_LOCKRESFAILURE);
  }

  setError(system, 0);
  state.find.pendingHook = dword(system, lpfr, HOOK);

  const dialog =
    (await call(system, 'USER', 'CreateDialogIndirectParam', [
      W(instance(system)),
      D(template),
      W(owner),
      D(procAddress(system, replace ? 14 : 13)),
      D(lpfr),
    ])) & 0xffff;

  await call(system, 'KERNEL', 'GlobalUnlock', [W(handle)]);

  if (own) {
    await freeTemplate(system, handle);
  }

  if (!dialog) {
    state.find.pendingHook = 0;
  }

  return dialog;
}

/**
 * Opens the modeless Find dialog for a program's window.
 *
 * @returns {Types.HWND} The dialog, or nought.
 */
export async function FindText(this: any, lpfr: number) {
  return open(this, lpfr >>> 0, false);
}

/**
 * Opens the modeless Replace dialog for a program's window.
 *
 * @returns {Types.HWND} The dialog, or nought.
 */
export async function ReplaceText(this: any, lpfr: number) {
  return open(this, lpfr >>> 0, true);
}

/** The Find dialog's procedure, COMMDLG's export 13. */
export async function FindTextDlgProc(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return procedure(this, hwnd, message, wParam, lParam >>> 0, false);
}

/** The Replace dialog's procedure, COMMDLG's export 14. */
export async function ReplaceTextDlgProc(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return procedure(this, hwnd, message, wParam, lParam >>> 0, true);
}

/** The two dialogs' procedure (seg5 `036d`, `0582`). */
async function procedure(
  system: any,
  dialog: number,
  message: number,
  wParam: number,
  lParam: number,
  replace: boolean
): Promise<number> {
  const state = stateOf(system);
  const handle = (await call(system, 'USER', 'GetProp', [W(dialog), D(0xa000)])) & 0xffff;
  let lpfr = state.find.structures.get(handle) ?? 0;

  /* Once the dialog has its property, the hook first, through the
   * structure; then the one `FindText` left in COMMDLG's data, but for
   * `WM_INITDIALOG`. Before it, neither: the messages USER sends as it makes
   * the dialog (`WM_SETFONT`, `WM_PARENTNOTIFY`) reach no hook (seg5 `0390`,
   * `03ca`). */
  if (handle) {
    if (lpfr && dword(system, lpfr, FLAGS) & FR_ENABLEHOOK) {
      const answer = await callHook(
        system,
        dword(system, lpfr, HOOK),
        dialog,
        message,
        wParam,
        lParam
      );

      if (answer) {
        return answer;
      }
    }

    const pending = state.find.pendingHook;

    if (pending && message !== WM_INITDIALOG) {
      const answer = await callHook(system, pending, dialog, message, wParam, lParam);

      if (answer) {
        return answer;
      }
    }
  }

  switch (message) {
    case WM_CLOSE:
      await call(system, 'USER', 'SendMessage', [W(dialog), W(WM_COMMAND), W(IDCANCEL), D(0)]);
      return 1;
    case WM_INITDIALOG: {
      const number = nextNumber(system);

      await call(system, 'USER', 'SetProp', [W(dialog), D(0xa000), W(number)]);
      state.find.pendingHook = 0;
      state.find.structures.set(number, lParam);
      lpfr = lParam;
      await start(system, dialog, lpfr, !replace);

      const answer =
        dword(system, lpfr, FLAGS) & FR_ENABLEHOOK
          ? await callHook(system, dword(system, lpfr, HOOK), dialog, message, wParam, lParam)
          : 1;

      if (answer) {
        await show(system, dialog, replace ? SW_SHOW : SW_SHOWNORMAL);
        await call(system, 'USER', 'UpdateWindow', [W(dialog)]);
      }

      return answer;
    }
    case WM_COMMAND:
      return command(system, dialog, lpfr, wParam, lParam, replace);
  }

  return 0;
}

/** `WM_COMMAND` (seg5 `04ce`, `06e2`). */
async function command(
  system: any,
  dialog: number,
  lpfr: number,
  id: number,
  lParam: number,
  replace: boolean
): Promise<number> {
  const notification = (lParam >>> 16) & 0xffff;

  if (id === IDOK) {
    await gather(system, dialog, lpfr, FR_FINDNEXT, !replace);
    await tellOwner(system, lpfr);
  } else if (id === IDCANCEL || id === 3) {
    await end(system, dialog, lpfr);
  } else if (replace && (id === PSH_REPLACE || id === PSH_REPLACE_ALL)) {
    await gather(system, dialog, lpfr, id === PSH_REPLACE ? FR_REPLACE : FR_REPLACEALL, false);

    if ((await tellOwner(system, lpfr)) >>> 0 === 1) {
      await setWindowText(
        system,
        await item(system, dialog, IDCANCEL),
        bytesOf(string(0x40d) ?? '')
      );
    }
  } else if (id === PSH_HELP) {
    const help = registered(system, 'commdlg_help');
    const owner = word(system, lpfr, HWND_OWNER);

    if (help && owner) {
      await call(system, 'USER', 'SendMessage', [W(owner), W(help), W(dialog), D(lpfr)]);
    }
  } else if (id === EDT_FIND) {
    if (notification === EN_CHANGE) {
      const length =
        (await call(system, 'USER', 'SendDlgItemMessage', [
          W(dialog),
          W(EDT_FIND),
          W(WM_GETTEXTLENGTH),
          W(0),
          D(0),
        ])) & 0xffff;

      for (const each of replace ? [IDOK, PSH_REPLACE, PSH_REPLACE_ALL] : [IDOK]) {
        await enable(system, await item(system, dialog, each), length);
      }
    }
  } else {
    return 0;
  }

  return 1;
}

/** The owner sent `FINDMSGSTRING`'s message: its answer. */
async function tellOwner(system: any, lpfr: number) {
  const owner = word(system, lpfr, HWND_OWNER);
  const message = stateOf(system).find.findMessage;

  return call(system, 'USER', 'SendMessage', [W(owner), W(message), W(0), D(lpfr)]);
}

/** The dialog ended (seg5 `0831`): `FR_DIALOGTERM` told, its property taken -- its memory not freed -- and its window destroyed. */
async function end(system: any, dialog: number, lpfr: number) {
  setDword(system, lpfr, FLAGS, (dword(system, lpfr, FLAGS) & ~0x38) | 0x40);
  await tellOwner(system, lpfr);

  const handle = (await call(system, 'USER', 'RemoveProp', [W(dialog), D(0xa000)])) & 0xffff;

  stateOf(system).find.structures.delete(handle);
  await call(system, 'USER', 'DestroyWindow', [W(dialog)]);
}

/** The dialog set from the structure (seg5 `0870`). */
async function start(system: any, dialog: number, lpfr: number, find: boolean) {
  await call(system, 'USER', 'SetDlgItemText', [
    W(dialog),
    W(EDT_FIND),
    D(dword(system, lpfr, FIND_WHAT)),
  ]);
  await call(system, 'USER', 'SendMessage', [
    W(dialog),
    W(WM_COMMAND),
    W(EDT_FIND),
    D((EN_CHANGE << 16) >>> 0),
  ]);

  if (!(dword(system, lpfr, FLAGS) & FR_SHOWHELP)) {
    const help = await item(system, dialog, PSH_HELP);

    await show(system, help, SW_HIDE);
    await enable(system, help, 0);
  }

  /* Whole Word, then Match Case: hidden, disabled, checked. */
  for (const [id, hide, disable, check] of [
    [CHX_WHOLE_WORD, FR_HIDEWHOLEWORD, FR_NOWHOLEWORD, FR_WHOLEWORD],
    [CHX_MATCH_CASE, FR_HIDEMATCHCASE, FR_NOMATCHCASE, FR_MATCHCASE],
  ]) {
    const flags = dword(system, lpfr, FLAGS);

    if (flags & hide) {
      const control = await item(system, dialog, id);

      await show(system, control, SW_HIDE);
      await enable(system, control, 0);
    } else if (flags & disable) {
      await enable(system, await item(system, dialog, id), 0);
    }

    await call(system, 'USER', 'CheckDlgButton', [W(dialog), W(id), W(flags & check ? 1 : 0)]);
  }

  const flags = dword(system, lpfr, FLAGS);

  if (flags & FR_HIDEUPDOWN) {
    await show(system, await item(system, dialog, GRP_DIRECTION), SW_HIDE);

    const up = await item(system, dialog, RAD_UP);

    await show(system, up, SW_HIDE);
    await enable(system, up, 0);

    const down = await item(system, dialog, RAD_DOWN);

    await show(system, down, SW_HIDE);
    await enable(system, down, 0);
  } else if (flags & FR_NOUPDOWN) {
    await enable(system, await item(system, dialog, RAD_UP), 0);
    await enable(system, await item(system, dialog, RAD_DOWN), 0);
  }

  if (find) {
    await call(system, 'USER', 'CheckRadioButton', [
      W(dialog),
      W(RAD_UP),
      W(RAD_DOWN),
      W(flags & FR_DOWN ? RAD_DOWN : RAD_UP),
    ]);
  } else {
    await call(system, 'USER', 'SetDlgItemText', [
      W(dialog),
      W(EDT_REPLACE),
      D(dword(system, lpfr, REPLACE_WITH)),
    ]);
    await call(system, 'USER', 'SendMessage', [
      W(dialog),
      W(WM_COMMAND),
      W(EDT_REPLACE),
      D((EN_CHANGE << 16) >>> 0),
    ]);
  }
}

/** The structure written as a search is asked for (seg5 `0a89`). */
async function gather(system: any, dialog: number, lpfr: number, flag: number, find: boolean) {
  const checked = async (id: number) =>
    !!(await call(system, 'USER', 'IsDlgButtonChecked', [W(dialog), W(id)]));
  let flags = dword(system, lpfr, FLAGS) & ~0x3f;

  setDword(system, lpfr, FLAGS, flags);

  if (await checked(CHX_WHOLE_WORD)) {
    flags |= FR_WHOLEWORD;
    setDword(system, lpfr, FLAGS, flags);
  }

  if (await checked(CHX_MATCH_CASE)) {
    flags |= FR_MATCHCASE;
    setDword(system, lpfr, FLAGS, flags);
  }

  setDword(system, lpfr, FLAGS, flags | flag);
  await call(system, 'USER', 'GetDlgItemText', [
    W(dialog),
    W(EDT_FIND),
    D(dword(system, lpfr, FIND_WHAT)),
    W(word(system, lpfr, FIND_LENGTH)),
  ]);

  if (find) {
    if (await checked(RAD_UP)) {
      return;
    }
  } else {
    await call(system, 'USER', 'GetDlgItemText', [
      W(dialog),
      W(EDT_REPLACE),
      D(dword(system, lpfr, REPLACE_WITH)),
      W(word(system, lpfr, REPLACE_LENGTH)),
    ]);
  }

  setDword(system, lpfr, FLAGS, dword(system, lpfr, FLAGS) | FR_DOWN);
}
