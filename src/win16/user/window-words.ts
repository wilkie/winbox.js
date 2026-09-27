'use strict';

import { NULL } from '../consts.js';

import { RasterWindow } from './raster-window.js';

/**
 * What a window keeps for a program, and what its class keeps: the words and
 * longs `GetWindowWord`, `GetWindowLong`, `GetClassWord` and `GetClassLong`
 * read and their `Set` forms write.
 *
 * A non-negative offset is into the bytes a program asked for when it
 * registered the class -- `cbWndExtra` a window, `cbClsExtra` the class --
 * which start at zero and are the program's to use. A negative one names
 * something USER keeps: the window's instance, parent, identifier, style and
 * procedure; the class's brush, cursor, icon, module and sizes.
 *
 * Setting a window's procedure is subclassing it: messages go to the new
 * procedure, which passes what it does not handle on to the old one with
 * `CallWindowProc`. USER's own procedures are functions here, not addresses
 * in the guest; a program is given a token for one, which `CallWindowProc`
 * and `SetWindowLong` turn back into it.
 */

const GWL_WNDPROC = -4;
const GWW_HINSTANCE = -6;
const GWW_HWNDPARENT = -8;
const GWW_ID = -12;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;

const GCL_MENUNAME = -8;
const GCW_HBRBACKGROUND = -10;
const GCW_HCURSOR = -12;
const GCW_HICON = -14;
const GCW_HMODULE = -16;
const GCW_CBWNDEXTRA = -18;
const GCW_CBCLSEXTRA = -20;
const GCL_WNDPROC = -24;
const GCW_STYLE = -26;

/** Tokens for USER's own procedures, which have no address to give out. */
const TOKEN = 0xffff0000;

export function procToken(system: any, proc: any) {
  if (typeof proc !== 'function') {
    return proc ?? 0;
  }

  system._procTokens ??= [];

  let at = system._procTokens.indexOf(proc);

  if (at < 0) {
    at = system._procTokens.push(proc) - 1;
  }

  return (TOKEN | at) >>> 0;
}

export function procOf(system: any, value: number) {
  return value >>> 16 === 0xffff ? (system._procTokens?.[value & 0xffff] ?? null) : value;
}

function classOf(system: any, dialog: any) {
  return dialog ? system.handles.retrieve(dialog.options.windowClass) : null;
}

/** A window's extra bytes, as many as its class asked for, all zero to begin with. */
function extraOf(system: any, dialog: any): Uint8Array {
  dialog._extra ??= new Uint8Array(Math.max(0, classOf(system, dialog)?.cbWndExtra ?? 0));

  return dialog._extra;
}

function classExtraOf(windowClass: any): Uint8Array {
  windowClass._extra ??= new Uint8Array(Math.max(0, windowClass.cbClsExtra ?? 0));

  return windowClass._extra;
}

function read(bytes: Uint8Array, at: number, size: number) {
  if (at < 0 || at + size > bytes.length) {
    return 0;
  }

  let value = 0;

  for (let index = size - 1; index >= 0; index--) {
    value = (value << 8) | bytes[at + index];
  }

  return value >>> 0;
}

function write(bytes: Uint8Array, at: number, size: number, value: number) {
  if (at < 0 || at + size > bytes.length) {
    return 0;
  }

  const previous = read(bytes, at, size);

  for (let index = 0; index < size; index++) {
    bytes[at + index] = (value >>> (8 * index)) & 0xff;
  }

  return previous;
}

const signed = (offset: number) => (offset << 16) >> 16;

export function GetWindowWord(this: any, hwnd: number, nOffset: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return 0;
  }

  const offset = signed(nOffset);

  switch (offset) {
    case GWW_HINSTANCE:
      return (dialog._createStruct?.hInstance ?? dialog.data?.hInstance ?? 0) & 0xffff;
    case GWW_HWNDPARENT:
      return dialog instanceof RasterWindow ? (dialog.window.parent?.hwnd ?? 0) : 0;
    case GWW_ID:
      return dialog instanceof RasterWindow
        ? dialog.window.controlId
        : (dialog._createStruct?.hMenu ?? 0);
  }

  return read(extraOf(this, dialog), offset, 2);
}

export function SetWindowWord(this: any, hwnd: number, nOffset: number, wNewWord: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return 0;
  }

  const offset = signed(nOffset);

  if (offset === GWW_ID && dialog instanceof RasterWindow) {
    const previous = dialog.window.controlId;

    dialog.window.controlId = wNewWord & 0xffff;

    return previous;
  }

  if (offset === GWW_HINSTANCE && dialog._createStruct) {
    const previous = dialog._createStruct.hInstance;

    dialog._createStruct.hInstance = wNewWord & 0xffff;

    return previous;
  }

  return write(extraOf(this, dialog), offset, 2, wNewWord & 0xffff);
}

export function GetWindowLong(this: any, hwnd: number, nOffset: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return 0;
  }

  const offset = signed(nOffset);

  switch (offset) {
    case GWL_WNDPROC:
      return procToken(this, dialog.wndProc ?? classOf(this, dialog)?.lpfnWndProc);
    case GWL_STYLE:
      return (
        (dialog instanceof RasterWindow
          ? dialog.window.style
          : (dialog._createStruct?.style ?? 0)) >>> 0
      );
    case GWL_EXSTYLE:
      return dialog instanceof RasterWindow ? dialog.window.exStyle >>> 0 : 0;
  }

  return read(extraOf(this, dialog), offset, 4);
}

export function SetWindowLong(this: any, hwnd: number, nOffset: number, dwNewLong: number) {
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return 0;
  }

  const offset = signed(nOffset);

  if (offset === GWL_WNDPROC) {
    const previous = GetWindowLong.call(this, hwnd, nOffset);

    dialog.wndProc = procOf(this, dwNewLong >>> 0);

    return previous;
  }

  if (offset === GWL_STYLE && dialog instanceof RasterWindow) {
    const previous = dialog.window.style >>> 0;

    dialog.window.style = dwNewLong >>> 0;

    return previous;
  }

  return write(extraOf(this, dialog), offset, 4, dwNewLong >>> 0);
}

/** A class's field, by the index `GetClassWord` or `GetClassLong` names it with. */
function classField(offset: number) {
  switch (offset) {
    case GCL_MENUNAME:
      return 'lpszMenuName';
    case GCW_HBRBACKGROUND:
      return 'hbrBackground';
    case GCW_HCURSOR:
      return 'hCursor';
    case GCW_HICON:
      return 'hIcon';
    case GCW_HMODULE:
      return 'hInstance';
    case GCW_CBWNDEXTRA:
      return 'cbWndExtra';
    case GCW_CBCLSEXTRA:
      return 'cbClsExtra';
    case GCL_WNDPROC:
      return 'lpfnWndProc';
    case GCW_STYLE:
      return 'style';
  }

  return null;
}

function getClass(system: any, hwnd: number, nOffset: number, size: number) {
  const windowClass = classOf(system, system.handles.resolve(hwnd));

  if (!windowClass) {
    return 0;
  }

  const offset = signed(nOffset);
  const field = classField(offset);

  if (field) {
    const value = windowClass[field];

    return field === 'lpfnWndProc'
      ? procToken(system, value)
      : typeof value === 'number'
        ? value
        : 0;
  }

  return read(classExtraOf(windowClass), offset, size);
}

function setClass(system: any, hwnd: number, nOffset: number, value: number, size: number) {
  const windowClass = classOf(system, system.handles.resolve(hwnd));

  if (!windowClass) {
    return 0;
  }

  const offset = signed(nOffset);
  const field = classField(offset);

  if (field) {
    const previous = getClass(system, hwnd, nOffset, size);

    windowClass[field] = field === 'lpfnWndProc' ? procOf(system, value >>> 0) : value;

    return previous;
  }

  return write(classExtraOf(windowClass), offset, size, value);
}

export function GetClassWord(this: any, hwnd: number, nOffset: number) {
  return getClass(this, hwnd, nOffset, 2) & 0xffff;
}

export function SetClassWord(this: any, hwnd: number, nOffset: number, wNewWord: number) {
  return setClass(this, hwnd, nOffset, wNewWord & 0xffff, 2) & 0xffff;
}

export function GetClassLong(this: any, hwnd: number, nOffset: number) {
  return getClass(this, hwnd, nOffset, 4) >>> 0;
}

export function SetClassLong(this: any, hwnd: number, nOffset: number, dwNewLong: number) {
  return setClass(this, hwnd, nOffset, dwNewLong >>> 0, 4) >>> 0;
}

/**
 * A window procedure called with a message, as a subclass passes on what it
 * does not handle to the procedure it replaced.
 */
export async function CallWindowProc(
  this: any,
  lpPrevWndFunc: number,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const proc = procOf(this, lpPrevWndFunc >>> 0);

  return proc ? await this.scheduler.callWindowProc(proc, hwnd, message, wParam, lParam) : NULL;
}
