'use strict';

import {
  CloseClipboard,
  EmptyClipboard,
  GetClipboardData,
  OpenClipboard,
  SetClipboardData,
} from './clipboard.js';
import { editState, selection } from './edit.js';
import { SendMessage } from './SendMessage.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { type ControlState } from './controls.js';

/**
 * An edit control's `WM_CUT`, `WM_COPY`, `WM_PASTE` and `WM_CLEAR`.
 *
 * **Recorded** by `editclip`, a single-line and a multi-line control:
 *
 * * `WM_COPY` puts the selection on the clipboard as `CF_TEXT`, the control
 *   opening and emptying it, and so its owner. Nothing selected, the
 *   clipboard is left as it was. The parent is told nothing.
 * * `WM_CLEAR` takes the selection out; `WM_CUT` copies it and takes it out.
 * * `WM_PASTE` puts `CF_TEXT` in place of the selection, the caret after it.
 *   A single-line control takes the text only to its first line break; a
 *   multi-line one takes it all.
 *
 * What the text does, and what the parent is told, is each control's: see
 * `pasteText` and `mlPasteText`.
 */

export const WM_CUT = 0x0300;
export const WM_COPY = 0x0301;
export const WM_PASTE = 0x0302;
export const WM_CLEAR = 0x0303;

const CF_TEXT = 1;
const ES_MULTILINE = 0x0004;

export async function editClipboard(
  system: any,
  hwnd: number,
  control: ControlState,
  message: number,
  put: (text: string | null) => Promise<void>
) {
  const [start, end] = selection(editState(control));

  if (message === WM_COPY || message === WM_CUT) {
    if (end > start) {
      await copy(system, hwnd, control.text.slice(start, end));
    }
  }

  if (message === WM_CUT || message === WM_CLEAR) {
    await put(null);
    return;
  }

  if (message === WM_PASTE) {
    let text = await paste(system, hwnd);

    if (!(control.style & ES_MULTILINE)) {
      const stop = text.search(/[\r\n]/);

      text = stop < 0 ? text : text.slice(0, stop);
    }

    await put(text);
  }
}

const VK_INSERT = 0x2d;
const VK_DELETE = 0x2e;

/**
 * The clipboard's keys, as USER's edit controls take them (`USER.EXE` seg28
 * `0a93`, `0c88`-`0d54`; the multi-line control's alike, seg30): Control and
 * Insert copy, by `WM_COPY` sent to the control; Shift and Insert paste;
 * Shift and Delete copy as Control and Insert does and take the selection out
 * -- with nothing selected, a backspace. The characters Control and C, V and
 * X make are these three (seg28 `0959`-`0a1f`, seg30 `1796`-`17ce`). Whether
 * the key was one of them.
 *
 * Not modelled: `ES_READONLY`, which these controls do not keep, and which
 * takes only the copy.
 */
export async function clipboardKey(
  system: any,
  hwnd: number,
  control: ControlState,
  key: number,
  shift: boolean,
  ctrl: boolean,
  put: (text: string | null) => Promise<unknown>,
  backspace: () => Promise<unknown>
) {
  if (key === VK_INSERT && ctrl && !shift) {
    await SendMessage.call(system, hwnd, WM_COPY, 0, 0);
  } else if (key === VK_INSERT && shift && !ctrl) {
    await editClipboard(system, hwnd, control, WM_PASTE, put as any);
  } else if (key === VK_DELETE && shift && !ctrl) {
    const [start, end] = selection(editState(control));

    if (start === end) {
      await backspace();
      return true;
    }

    await SendMessage.call(system, hwnd, WM_COPY, 0, 0);
    await editClipboard(system, hwnd, control, WM_CLEAR, put as any);
  } else {
    return false;
  }

  return true;
}

/**
 * A control character typed: Control and C, V or X, as the clipboard's keys
 * (`clipboardKey`). Whether it was one of them.
 */
export async function clipboardCharacter(
  system: any,
  hwnd: number,
  control: ControlState,
  code: number,
  put: (text: string | null) => Promise<unknown>,
  backspace: () => Promise<unknown>
) {
  const [start, end] = selection(editState(control));

  switch (code) {
    case 0x03:
      return clipboardKey(system, hwnd, control, VK_INSERT, false, true, put, backspace);
    case 0x16:
      return clipboardKey(system, hwnd, control, VK_INSERT, true, false, put, backspace);
    case 0x18:
      /* Nothing selected: only a beep (`0a2c`). */
      return start === end
        ? true
        : clipboardKey(system, hwnd, control, VK_DELETE, true, false, put, backspace);
    default:
      return false;
  }
}

/** Text put on the clipboard as `CF_TEXT`, by the control. */
async function copy(system: any, hwnd: number, text: string) {
  const handle = GlobalAlloc.call(system, 0x2002, text.length + 1);
  const far = globalPointer.call(system, handle);
  const core = system.machine.cpu.core;

  for (let i = 0; i <= text.length; i++) {
    core.write8(
      far >>> 16,
      ((far & 0xffff) + i) & 0xffff,
      i < text.length ? text.charCodeAt(i) & 0xff : 0
    );
  }

  if (!OpenClipboard.call(system, hwnd)) {
    return;
  }

  await EmptyClipboard.call(system);
  SetClipboardData.call(system, CF_TEXT, handle);
  await CloseClipboard.call(system);
}

/** The clipboard's `CF_TEXT`, or nothing. */
async function paste(system: any, hwnd: number) {
  if (!OpenClipboard.call(system, hwnd)) {
    return '';
  }

  const handle = await GetClipboardData.call(system, CF_TEXT);
  const far = handle ? globalPointer.call(system, handle) : 0;
  let text = '';

  if (far) {
    const core = system.machine.cpu.core;

    for (let i = 0; i < 0xffff; i++) {
      const byte = core.read8(far >>> 16, ((far & 0xffff) + i) & 0xffff);

      if (!byte) {
        break;
      }

      text += String.fromCharCode(byte);
    }
  }

  await CloseClipboard.call(system);

  return text;
}
