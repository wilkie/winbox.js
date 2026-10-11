'use strict';

import { FALSE, TRUE } from '../consts.js';
import { CHARARRAY, Struct } from '../types.js';
import { User } from '../user.js';

import { BM_GETCHECK, BM_SETCHECK } from './controls.js';
import { GetDlgItem } from './GetDlgItem.js';

/**
 * What a program does to a dialog's controls by their identifiers, and to a
 * window's text: each is a message to the window, as Windows sends it, so a
 * control -- or a program's own window procedure -- answers it.
 */

async function send(system: any, hwnd: number, message: number, wParam: number, lParam: any) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;
  const windowClass = window && system.handles.retrieve(window.options.windowClass);

  return windowClass
    ? await system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam)
    : 0;
}

/** A string argument as the far pointer the program passed. */
function farOf(lpsz: any) {
  return lpsz && lpsz.segment !== undefined
    ? ((lpsz.segment << 16) | lpsz.offset) >>> 0
    : (lpsz ?? 0);
}

/** A window's text into a buffer: `WM_GETTEXT`. */
export async function GetWindowText(this: any, hwnd: number, lpsz: number, cch: number) {
  return (await send(this, hwnd, User.WM_GETTEXT, cch, lpsz)) & 0xffff;
}

export async function GetWindowTextLength(this: any, hwnd: number) {
  return (await send(this, hwnd, User.WM_GETTEXTLENGTH, 0, 0)) & 0xffff;
}

export async function SetDlgItemText(this: any, hwndDlg: number, id: number, lpsz: any) {
  await send(this, GetDlgItem.call(this, hwndDlg, id), User.WM_SETTEXT, 0, farOf(lpsz));
}

export async function GetDlgItemText(
  this: any,
  hwndDlg: number,
  id: number,
  lpsz: number,
  cch: number
) {
  return (
    (await send(this, GetDlgItem.call(this, hwndDlg, id), User.WM_GETTEXT, cch, lpsz)) & 0xffff
  );
}

/** A number as a control's text, in decimal, signed when `fSigned` says so. */
export async function SetDlgItemInt(
  this: any,
  hwndDlg: number,
  id: number,
  uValue: number,
  fSigned: number
) {
  const value = fSigned ? (uValue << 16) >> 16 : uValue & 0xffff;

  await send(this, GetDlgItem.call(this, hwndDlg, id), User.WM_SETTEXT, 0, String(value));
}

/** The buffer `GetDlgItemInt` reads a control's text into: 31 characters and a zero. */
class ItemText extends Struct {
  constructor() {
    super([['text', CHARARRAY + 32]]);
  }
}

/**
 * A control's text as a number, as `USER.EXE` reads it (seg25 `0233`): asked
 * for with `WM_GETTEXT`, 31 characters at most, as `GetDlgItemText` asks
 * (`00d4`) -- so a combo box answers with its edit control's -- then spaces
 * skipped, a minus sign where signed, and digits up to the first that is not
 * one. The flag says a number was read with nothing after it; the digits read
 * are answered either way, negated after the sign. No text, or a number too
 * big for a word (or for 7FFFh, signed), answers 0 and says so.
 */
export async function GetDlgItemInt(
  this: any,
  hwndDlg: number,
  id: number,
  lpfTranslated: number,
  fSigned: number
) {
  const core = this.machine.cpu.core;
  const flag = (value: number) => {
    if (lpfTranslated) {
      core.write16((lpfTranslated >>> 16) & 0xffff, lpfTranslated & 0xffff, value);
    }
  };

  flag(FALSE);

  const buffer: any = new ItemText();
  const hwnd = GetDlgItem.call(this, hwndDlg, id);

  if (!((await send(this, hwnd, User.WM_GETTEXT, 0x1f, [buffer])) & 0xffff)) {
    return 0;
  }

  const text = String(buffer.text ?? '');
  let at = 0;

  while (text[at] === ' ') {
    at++;
  }

  const negative = !!fSigned && text[at] === '-';

  if (negative) {
    at++;
  }

  let value = 0;
  let digits = false;

  for (;;) {
    const code = at < text.length ? text.charCodeAt(at) : 0;

    at++;

    if (code < 0x30 || code > 0x39) {
      if (code === 0 && digits) {
        flag(TRUE);
      }

      break;
    }

    digits = true;

    if (value > 0x1999 || (value === 0x1999 && code > 0x35)) {
      return 0;
    }

    value = value * 10 + code - 0x30;

    if (fSigned && value > 0x7fff) {
      return 0;
    }
  }

  return (negative ? -value : value) & 0xffff;
}

export async function CheckDlgButton(this: any, hwndDlg: number, id: number, uCheck: number) {
  await send(this, GetDlgItem.call(this, hwndDlg, id), BM_SETCHECK, uCheck, 0);
}

export async function IsDlgButtonChecked(this: any, hwndDlg: number, id: number) {
  return (await send(this, GetDlgItem.call(this, hwndDlg, id), BM_GETCHECK, 0, 0)) & 0xffff;
}

/** One radio button checked in a range of identifiers, the others cleared. */
export async function CheckRadioButton(
  this: any,
  hwndDlg: number,
  first: number,
  last: number,
  check: number
) {
  for (let id = first; id <= last; id++) {
    await send(this, GetDlgItem.call(this, hwndDlg, id), BM_SETCHECK, id === check ? 1 : 0, 0);
  }
}
