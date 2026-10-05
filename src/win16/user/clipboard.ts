'use strict';

import { DeleteObject } from '../gdi/DeleteObject.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { AnsiToOem, OemToAnsi } from '../keyboard/oem.js';
import { SendMessage } from './SendMessage.js';

/**
 * The clipboard: one for the system, opened by a window at a time, holding
 * a block for each format put on it, and a chain of viewers told when it
 * changes.
 *
 * **Recorded** by `clip`, with an owner, a viewer and a second viewer:
 *
 * * It opens for one window at a time: opened, another window's
 *   `OpenClipboard` answers nought. Closing it when it is not open answers
 *   nought, and so does `GetClipboardData`.
 * * `EmptyClipboard` makes the window that opened it the owner, and sends
 *   the owner before it `WM_DESTROYCLIPBOARD`.
 * * `SetClipboardData` answers the handle it was given. A format given no
 *   handle is rendered when it is asked for: its owner is sent
 *   `WM_RENDERFORMAT`, and puts the data on then.
 * * Closed, the clipboard makes `CF_OEMTEXT` from `CF_TEXT`, or `CF_TEXT`
 *   from `CF_OEMTEXT`, if it has one and not the other, listed after the
 *   formats put on: the text through the keyboard driver's tables when it is
 *   asked for. While it is open, only what was put on is there.
 *   `EnumClipboardFormats` lists them in the order they were put on.
 * * `SetClipboardViewer` sends the new viewer `WM_DRAWCLIPBOARD` and answers
 *   the one before, which it is to pass that message on to. Closing the
 *   clipboard sends the first viewer `WM_DRAWCLIPBOARD` if anything was put
 *   on or taken off, and not otherwise.
 * * `ChangeClipboardChain` sends the first viewer `WM_CHANGECBCHAIN`, the
 *   window leaving and the one after it, and answers what it answered.
 *
 * Documented, and not recorded: `EmptyClipboard` frees what was on it, a
 * bitmap or a palette with `DeleteObject` and anything else with
 * `GlobalFree`; an owner destroyed is not asked to render what it has not.
 */

const CF_TEXT = 1;
const CF_BITMAP = 2;
const CF_OEMTEXT = 7;

/** A format the clipboard makes from another when it is asked for. */
const MADE = -1;
const CF_PALETTE = 9;

const WM_RENDERFORMAT = 0x0305;
const WM_DESTROYCLIPBOARD = 0x0307;
const WM_DRAWCLIPBOARD = 0x0308;
const WM_CHANGECBCHAIN = 0x030d;

interface Clipboard {
  open: number;
  owner: number;
  viewer: number;
  changed: boolean;

  /** Each format's handle, null for one its owner renders, or `MADE`; in the order put on. */
  formats: Map<number, number | null>;
}

function clipboardOf(system: any): Clipboard {
  return (system._clipboard ??= {
    open: 0,
    owner: 0,
    viewer: 0,
    changed: false,
    formats: new Map(),
  });
}

/** @returns {Types.BOOL} Whether it opened, for no other window having it open. */
export function OpenClipboard(this: any, hwnd: number) {
  const clipboard = clipboardOf(this);

  if (clipboard.open) {
    return 0;
  }

  clipboard.open = hwnd || 0xffff;

  return 1;
}

/** @returns {Types.BOOL} Whether it was open. */
export async function CloseClipboard(this: any) {
  const clipboard = clipboardOf(this);

  if (!clipboard.open) {
    return 0;
  }

  clipboard.open = 0;

  if (clipboard.changed) {
    clipboard.changed = false;

    /* Each text format made from the other it lacks. */
    const formats = clipboard.formats;

    if (formats.has(CF_TEXT) && !formats.has(CF_OEMTEXT)) {
      formats.set(CF_OEMTEXT, MADE);
    } else if (formats.has(CF_OEMTEXT) && !formats.has(CF_TEXT)) {
      formats.set(CF_TEXT, MADE);
    }

    if (clipboard.viewer) {
      await SendMessage.call(this, clipboard.viewer, WM_DRAWCLIPBOARD, 0, 0);
    }
  }

  return 1;
}

/** @returns {Types.BOOL} Whether it was open to be emptied. */
export async function EmptyClipboard(this: any) {
  const clipboard = clipboardOf(this);

  if (!clipboard.open) {
    return 0;
  }

  if (clipboard.owner) {
    await SendMessage.call(this, clipboard.owner, WM_DESTROYCLIPBOARD, 0, 0);
  }

  for (const [format, handle] of clipboard.formats) {
    if (!handle || handle === MADE) {
      continue;
    }

    if (format === CF_BITMAP || format === CF_PALETTE) {
      DeleteObject.call(this, handle);
    } else {
      GlobalFree.call(this, handle);
    }
  }

  clipboard.formats.clear();
  clipboard.owner = clipboard.open === 0xffff ? 0 : clipboard.open;
  clipboard.changed = true;

  return 1;
}

/** @returns {Types.HANDLE} The handle given, or nought. */
export function SetClipboardData(this: any, uFormat: number, hData: number) {
  const clipboard = clipboardOf(this);

  if (!clipboard.open) {
    return 0;
  }

  clipboard.formats.set(uFormat & 0xffff, hData || null);
  clipboard.changed = true;

  return hData;
}

/** @returns {Types.HANDLE} A format's data, rendered by its owner if it had none, or nought. */
export async function GetClipboardData(this: any, uFormat: number) {
  const clipboard = clipboardOf(this);
  const format = uFormat & 0xffff;

  if (!clipboard.open || !clipboard.formats.has(format)) {
    return 0;
  }

  if (clipboard.formats.get(format) === null && clipboard.owner) {
    await SendMessage.call(this, clipboard.owner, WM_RENDERFORMAT, format, 0);
  }

  if (clipboard.formats.get(format) === MADE) {
    clipboard.formats.set(format, await madeText(this, format));
  }

  return clipboard.formats.get(format) ?? 0;
}

/** One text format made from the other, in a block of its own. */
async function madeText(system: any, format: number) {
  const source = await GetClipboardData.call(system, format === CF_OEMTEXT ? CF_TEXT : CF_OEMTEXT);
  const from = source ? globalPointer.call(system, source) : 0;

  if (!from) {
    return 0;
  }

  const core = system.machine.cpu.core;
  let length = 0;

  while (core.read8(from >>> 16, ((from & 0xffff) + length) & 0xffff) && length < 0xffff) {
    length++;
  }

  const made = GlobalAlloc.call(system, 0x2002, length + 1);
  const to = globalPointer.call(system, made);

  await (format === CF_OEMTEXT ? AnsiToOem : OemToAnsi).call(system, from, to);

  return made;
}

/** @returns {Types.INT} How many formats are on it. */
export function CountClipboardFormats(this: any) {
  return clipboardOf(this).formats.size;
}

/** @returns {Types.UINT} The format after the one given, nought for the first; nought after the last. */
export function EnumClipboardFormats(this: any, uFormat: number) {
  const clipboard = clipboardOf(this);

  if (!clipboard.open) {
    return 0;
  }

  const order = [...clipboard.formats.keys()];

  if (!uFormat) {
    return order[0] ?? 0;
  }

  const at = order.indexOf(uFormat & 0xffff);

  return at < 0 ? 0 : (order[at + 1] ?? 0);
}

/** @returns {Types.BOOL} Whether a format is on it. */
export function IsClipboardFormatAvailable(this: any, uFormat: number) {
  return clipboardOf(this).formats.has(uFormat & 0xffff) ? 1 : 0;
}

/** @returns {Types.HWND} The window that emptied it last. */
export function GetClipboardOwner(this: any) {
  return clipboardOf(this).owner;
}

/** @returns {Types.HWND} The window that has it open. */
export function GetOpenClipboardWindow(this: any) {
  const open = clipboardOf(this).open;

  return open === 0xffff ? 0 : open;
}

/** @returns {Types.HWND} The first viewer. */
export function GetClipboardViewer(this: any) {
  return clipboardOf(this).viewer;
}

/** @returns {Types.HWND} The viewer before, to pass its messages on to. */
export async function SetClipboardViewer(this: any, hwnd: number) {
  const clipboard = clipboardOf(this);
  const before = clipboard.viewer;

  clipboard.viewer = hwnd;

  if (hwnd) {
    await SendMessage.call(this, hwnd, WM_DRAWCLIPBOARD, 0, 0);
  }

  return before;
}

/** @returns {Types.BOOL} What the first viewer answered `WM_CHANGECBCHAIN`. */
export async function ChangeClipboardChain(this: any, hwndRemove: number, hwndNext: number) {
  const clipboard = clipboardOf(this);
  const first = clipboard.viewer;

  if (!first) {
    return 0;
  }

  const answer = await SendMessage.call(
    this,
    first,
    WM_CHANGECBCHAIN,
    hwndRemove,
    hwndNext & 0xffff
  );

  if (first === hwndRemove) {
    clipboard.viewer = hwndNext;
  }

  return answer;
}
