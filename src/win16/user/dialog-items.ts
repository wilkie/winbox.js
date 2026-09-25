'use strict';

import { FALSE, TRUE } from '../consts.js';
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

/**
 * A control's text as a number: leading blanks, a minus sign when signed,
 * then digits and nothing else. What fails -- no digits, something after
 * them, or a value that does not fit -- answers 0 and says so through
 * `lpfTranslated`.
 */
export async function GetDlgItemInt(
  this: any,
  hwndDlg: number,
  id: number,
  lpfTranslated: number,
  fSigned: number
) {
  const hwnd = GetDlgItem.call(this, hwndDlg, id);
  const window = hwnd ? this.handles.resolve(hwnd) : null;
  const text = String(window?.window?.control?.text ?? window?.caption ?? '');
  const match = (fSigned ? /^\s*(-?\d+)$/ : /^\s*(\d+)$/).exec(text);
  const value = match ? Number(match[1]) : NaN;
  const fits = fSigned ? value >= -32768 && value <= 32767 : value >= 0 && value <= 65535;
  const ok = match !== null && fits;

  if (lpfTranslated) {
    const core = this.machine.cpu.core;

    core.write16((lpfTranslated >>> 16) & 0xffff, lpfTranslated & 0xffff, ok ? TRUE : FALSE);
  }

  return ok ? value & 0xffff : 0;
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
