'use strict';

import { api, buffer, D, W, word } from '../commdlg/api.js';
import { CursorData } from './cursor-api.js';

/**
 * USER's `DragObject`, ordinal 464: File Manager's and Program Manager's
 * drag of an object over windows that may take it. **Read out** of
 * `USER.EXE` (seg14 `0fbe`, its loop `00f2`-`035b`, its hit test
 * `0000`-`00ef`) and **recorded** by `dragobj`. As the Rust engine's
 * `drag_object.rs`.
 *
 * The drag's `DRAGINFO` is a block of 24h bytes (`GMEM_DDESHARE |
 * GMEM_ZEROINIT`): the source window at 0, the window under the cursor that
 * is asked -- the scope -- at 2, the format at 4, the data at 6 and the
 * point at 0Ah; then, at 12h, a copy of the same made before each step, the
 * scope it had, which the window left is told of.
 */

const GMEM_DDESHARE_ZEROINIT = 0x2040;
const DRAGINFO_SIZE = 0x24;
const PREVIOUS = 0x12;
const SOURCE = 0;
const SCOPE = 2;
const FORMAT = 4;
const DATA = 6;
const POINT = 0x0a;

const WM_DROPOBJECT = 0x022a;
const WM_QUERYDROPOBJECT = 0x022b;
const WM_DRAGLOOP = 0x022d;
const WM_DRAGSELECT = 0x022e;
const WM_DRAGMOVE = 0x022f;
const WM_QUEUESYNC = 0x0023;
const WM_KEYFIRST = 0x0100;
const WM_KEYLAST = 0x0108;
const WM_MOUSEFIRST = 0x0200;
const WM_MOUSELAST = 0x0209;
const WM_LBUTTONUP = 0x0202;
const WM_NCLBUTTONUP = 0x00a2;
const PM_REMOVE = 1;

const GWL_STYLE = 0xfff0;
const GW_HWNDNEXT = 2;
const GW_CHILD = 5;
const WS_VISIBLE = 0x10000000;
const WS_DISABLED = 0x08000000;
const WS_MINIMIZE = 0x20000000;

/** The standard arrow's identifier, which the no-drop cursor looks like in WinBox. */
const IDC_ARROW = 32512;

/**
 * The no-drop cursor: USER loads its own cursor 100 for each drag (`0121`-
 * `0128`) and destroys it at the end (`0344`). WinBox keeps no picture of
 * USER's own cursors; a handle of its own stands for it, drawn as the
 * standard arrow. Nothing a program is told shows the picture.
 */
function noDropCursor(system: any) {
  return system.handles.allocate(new CursorData(IDC_ARROW));
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const signed = (value: number) => (value << 16) >> 16;

async function windowRect(system: any, hwnd: number): Promise<Rect> {
  const called = await api(system, 'USER', 'GetWindowRect', [W(hwnd), buffer(8)]);
  const bytes = called.buffers[0];
  const at = (i: number) => signed(bytes[i] | (bytes[i + 1] << 8));

  return { left: at(0), top: at(2), right: at(4), bottom: at(6) };
}

/** The client area on the screen. */
async function clientRect(system: any, hwnd: number): Promise<Rect> {
  const called = await api(system, 'USER', 'GetClientRect', [W(hwnd), buffer(8)]);
  const bytes = called.buffers[0];
  const at = (i: number) => signed(bytes[i] | (bytes[i + 1] << 8));
  const origin = await api(system, 'USER', 'ClientToScreen', [W(hwnd), buffer(4)]);
  const x = signed(origin.buffers[0][0] | (origin.buffers[0][1] << 8));
  const y = signed(origin.buffers[0][2] | (origin.buffers[0][3] << 8));

  return { left: at(0) + x, top: at(2) + y, right: at(4) + x, bottom: at(6) + y };
}

const inside = (rect: Rect, x: number, y: number) =>
  x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

async function styleOf(system: any, hwnd: number) {
  return (await api(system, 'USER', 'GetWindowLong', [W(hwnd), W(GWL_STYLE)])).value >>> 0;
}

/** The `DRAGINFO`'s memory. */
function memory(system: any, far: number) {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  return {
    read: (at: number) => core.read16(segment, (offset + at) & 0xffff) & 0xffff,
    write: (at: number, value: number) =>
      core.write16(segment, (offset + at) & 0xffff, value & 0xffff),
  };
}

/**
 * The window under the point that takes the object (seg14 `0000`-`00ef`):
 * nought where the point is outside `hwnd` or `hwnd` is disabled. A window
 * that is not minimized and has the point in its client area first asks the
 * first visible child the point is in, unless that child is disabled; a
 * child's nought, or no child, asks the window itself, with `wParam` 1 where
 * the point is outside its client area or it is minimized. Asked, the
 * window is the scope and the point is made its client's
 * (`ScreenToClient`); answering nought, the point goes back to the
 * screen's. What the window answered.
 */
async function hitTest(system: any, hwnd: number, far: number): Promise<number> {
  const info = memory(system, far);
  const x = signed(info.read(POINT));
  const y = signed(info.read(POINT + 2));
  const style = await styleOf(system, hwnd);

  if (!inside(await windowRect(system, hwnd), x, y) || style & WS_DISABLED) {
    return 0;
  }

  let nonClient = 1;

  if (!(style & WS_MINIMIZE) && inside(await clientRect(system, hwnd), x, y)) {
    nonClient = 0;

    let child = await word(system, 'USER', 'GetWindow', [W(hwnd), W(GW_CHILD)]);

    while (child) {
      const childStyle = await styleOf(system, child);

      if (childStyle & WS_VISIBLE && inside(await windowRect(system, child), x, y)) {
        if (!(childStyle & WS_DISABLED)) {
          const answer = await hitTest(system, child, far);

          if (answer) {
            return answer;
          }
        }

        break;
      }

      child = await word(system, 'USER', 'GetWindow', [W(child), W(GW_HWNDNEXT)]);
    }
  }

  const point = await api(system, 'USER', 'ScreenToClient', [
    W(hwnd),
    { b: [x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff] },
  ]);
  const client = point.buffers[0];

  info.write(POINT, client[0] | (client[1] << 8));
  info.write(POINT + 2, client[2] | (client[3] << 8));
  info.write(SCOPE, hwnd);

  const answer =
    (
      await api(system, 'USER', 'SendMessage', [
        W(hwnd),
        W(WM_QUERYDROPOBJECT),
        W(nonClient),
        D(far),
      ])
    ).value & 0xffff;

  if (!answer) {
    info.write(POINT, x);
    info.write(POINT + 2, y);
  }

  return answer;
}

/** The next message for the drag (`01bf`-`0208`): the mouse's, else a queue sync, else a key's; else wait. */
async function nextMessage(system: any): Promise<number[]> {
  for (;;) {
    for (const [first, last] of [
      [WM_MOUSEFIRST, WM_MOUSELAST],
      [WM_QUEUESYNC, WM_QUEUESYNC],
      [WM_KEYFIRST, WM_KEYLAST],
    ]) {
      const called = await api(system, 'USER', 'PeekMessage', [
        buffer(18),
        W(0),
        W(first),
        W(last),
        W(PM_REMOVE),
      ]);

      if (called.value & 0xffff) {
        return called.buffers[0];
      }
    }

    await api(system, 'USER', 'WaitMessage', []);
  }
}

/**
 * The **DragObject** function drags an object: until the left button is
 * released, the windows under the cursor are asked whether they take it,
 * the source is told of each step, and the one that took it is given it.
 *
 * **Read out** (`USER.EXE` seg14 `00f2`-`035b`) and **recorded** by
 * `dragobj`:
 *
 * * The `DRAGINFO` block and USER's no-drop cursor made; nought where
 *   either cannot be. The source, format and data written in it.
 * * The cursor given, where there is one, made the cursor (an icon or a
 *   cursor of another size made a cursor of the system's size first, and
 *   destroyed at the end, `seg13:053e`: WinBox shows the one given).
 * * The source's window captures the mouse and the cursor is shown.
 * * Each mouse message -- or with none a `WM_QUEUESYNC`, or a key's, or
 *   with none of those a wait -- is a step: the block copied to 12h, its
 *   point the message's; the windows asked from `hwndParent` down (see
 *   `hitTest`); the cursor the no-drop one for nought, the given one for 1,
 *   else the handle answered; the source sent `WM_DRAGLOOP` with whether it
 *   is not the no-drop one; a new scope sent `WM_DRAGSELECT` -- the old 0
 *   with the copy, the new 1 with the block -- or the same scope
 *   `WM_DRAGMOVE`. A release of the left button, client or not, is the last
 *   step.
 * * The capture released and the cursor hidden again, the cursor before
 *   put back. Where the last step's cursor was not the no-drop one, the
 *   scope is sent `WM_DROPOBJECT` with the source in `wParam`, and what it
 *   answers is answered; else nought.
 *
 * @param {Types.HWND} hwndParent - The window whose children may take it.
 * @param {Types.HWND} hwndFrom - The window it is dragged from.
 * @param {Types.UINT} wFmt - Its format.
 * @param {Types.DWORD} dwData - Its data.
 * @param {Types.HCURSOR} hCursor - The cursor while it may be dropped.
 *
 * @returns {Types.DWORD} What the window it was dropped on answered, or nought.
 */
export async function DragObject(
  this: any,
  hwndParent: number,
  hwndFrom: number,
  wFmt: number,
  dwData: number,
  hCursor: number
) {
  const system = this;
  const block = await word(system, 'KERNEL', 'GlobalAlloc', [
    W(GMEM_DDESHARE_ZEROINIT),
    D(DRAGINFO_SIZE),
  ]);

  if (!block) {
    return 0;
  }

  const far = (await api(system, 'KERNEL', 'GlobalLock', [W(block)])).value >>> 0;
  const info = memory(system, far);
  const noDrop = noDropCursor(system);
  let answer = 0;

  info.write(SOURCE, hwndFrom);
  info.write(FORMAT, wFmt);
  info.write(DATA, dwData & 0xffff);
  info.write(DATA + 2, (dwData >>> 16) & 0xffff);

  const before = hCursor ? await word(system, 'USER', 'SetCursor', [W(hCursor)]) : 0;

  await word(system, 'USER', 'SetCapture', [W(hwndFrom)]);
  await word(system, 'USER', 'ShowCursor', [W(1)]);

  let last = 0;
  /* The last step's cursor: every drag takes a step before it ends. */
  let shown: number | undefined;

  for (;;) {
    const msg = await nextMessage(system);
    const message = msg[2] | (msg[3] << 8);

    for (let at = 0; at < PREVIOUS; at += 2) {
      info.write(PREVIOUS + at, info.read(at));
    }

    info.write(POINT, msg[14] | (msg[15] << 8));
    info.write(POINT + 2, msg[16] | (msg[17] << 8));

    const taken = await hitTest(system, hwndParent, far);
    let cursor: number;

    if (taken === 0) {
      cursor = noDrop;
      info.write(SCOPE, 0);
    } else {
      cursor = taken === 1 ? hCursor : taken;
    }

    if (cursor) {
      await word(system, 'USER', 'SetCursor', [W(cursor)]);
    }

    await api(system, 'USER', 'SendMessage', [
      W(hwndFrom),
      W(WM_DRAGLOOP),
      W(cursor !== noDrop ? 1 : 0),
      D(far),
    ]);

    const scope = info.read(SCOPE);

    shown = cursor;

    if (scope !== last) {
      if (last) {
        await api(system, 'USER', 'SendMessage', [
          W(last),
          W(WM_DRAGSELECT),
          W(0),
          D((far + PREVIOUS) >>> 0),
        ]);
      }

      last = scope;

      if (last) {
        await api(system, 'USER', 'SendMessage', [W(last), W(WM_DRAGSELECT), W(1), D(far)]);
      }
    } else if (last) {
      await api(system, 'USER', 'SendMessage', [W(last), W(WM_DRAGMOVE), W(0), D(far)]);
    }

    if (message === WM_LBUTTONUP || message === WM_NCLBUTTONUP) {
      break;
    }
  }

  await api(system, 'USER', 'ReleaseCapture', []);
  await word(system, 'USER', 'ShowCursor', [W(0)]);

  if (hCursor) {
    await word(system, 'USER', 'SetCursor', [W(before)]);
  }

  if (shown !== noDrop) {
    answer =
      (
        await api(system, 'USER', 'SendMessage', [
          W(info.read(SCOPE)),
          W(WM_DROPOBJECT),
          W(hwndFrom),
          D(far),
        ])
      ).value >>> 0;
  }

  system.handles.free(noDrop);
  await api(system, 'KERNEL', 'GlobalUnlock', [W(block)]);
  await word(system, 'KERNEL', 'GlobalFree', [W(block)]);

  return answer;
}
