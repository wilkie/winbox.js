'use strict';

import { LoadCursor, SetCursor } from './cursor-api.js';
import { SendMessage } from './SendMessage.js';
import { RasterWindow } from './raster-window.js';

/**
 * `WM_SETCURSOR`: the window under the mouse asked for the cursor as each
 * mouse message is taken for it, and what `DefWindowProc` answers.
 * **Recorded** by `setcur`:
 *
 * * Taking a mouse message, the window it is for is sent `WM_SETCURSOR`
 *   first, naming itself, the hit-test code in the low word and the mouse
 *   message in the high: `WM_MOUSEMOVE`, 200h, over the caption or a border
 *   as over the client area. A move is made up when a window is shown,
 *   moved or destroyed under the cursor, and so asks too; a repaint does not.
 *   Over the desktop, the program is asked nothing and the cursor is the
 *   arrow.
 * * `DefWindowProc` asks a child's parent first, naming the child; the
 *   parent leaves a child's client area to the child. In its own client area
 *   a window shows its class's cursor; a class with none leaves the cursor
 *   as it was. A border shows the sizing cursor its side calls for; the
 *   caption, the system menu box and the maximize box, the arrow.
 *
 * Not measured: with the mouse captured, a press on nothing (`HTERROR`),
 * and a child's own border.
 */

export const WM_SETCURSOR = 0x0020;

const HTCLIENT = 1;

const IDC_ARROW = 32512;
const IDC_SIZENWSE = 32642;
const IDC_SIZENESW = 32643;
const IDC_SIZEWE = 32644;
const IDC_SIZENS = 32645;

/** The cursor each border shows, by hit-test code. */
const BORDERS = new Map([
  [10, IDC_SIZEWE],
  [11, IDC_SIZEWE],
  [12, IDC_SIZENS],
  [15, IDC_SIZENS],
  [13, IDC_SIZENWSE],
  [17, IDC_SIZENWSE],
  [14, IDC_SIZENESW],
  [16, IDC_SIZENESW],
]);

const WS_CHILD = 0x40000000;

async function show(system: any, id: number) {
  SetCursor.call(system, await LoadCursor.call(system, 0, id));
}

/** Before a mouse message taken is handed over: the window asked for the cursor. */
export async function askForCursor(system: any, message: any) {
  const kind = message?.message ?? 0;
  const client = kind >= 0x200 && kind <= 0x209;
  const nonclient = kind >= 0xa0 && kind <= 0xa9;

  if ((!client && !nonclient) || system.rasterInput?.capture) {
    return;
  }

  if (!message.hwnd || message.hwnd === system.desktopWindow) {
    await show(system, IDC_ARROW);
    return;
  }

  const hit = client ? HTCLIENT : message.wParam & 0xffff;
  const mouse = client ? kind : kind - 0xa0 + 0x200;

  await SendMessage.call(
    system,
    message.hwnd,
    WM_SETCURSOR,
    message.hwnd,
    ((mouse << 16) | hit) >>> 0
  );
}

/** What `DefWindowProc` does with `WM_SETCURSOR`; its answer, whether it set one. */
export async function defaultSetCursor(system: any, hwnd: number, wParam: number, lParam: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return 0;
  }

  const parent = window.window.parent?.hwnd;

  if (window.window.style & WS_CHILD && parent) {
    if (await SendMessage.call(system, parent, WM_SETCURSOR, wParam, lParam)) {
      return 1;
    }
  }

  const hit = (lParam << 16) >> 16;

  if (hit === HTCLIENT) {
    const windowClass = system.handles.retrieve(window.options.windowClass);
    const cursor = windowClass?.hCursor ?? 0;

    if (wParam !== hwnd || !cursor) {
      return 0;
    }

    SetCursor.call(system, cursor);
    return 1;
  }

  await show(system, BORDERS.get(hit) ?? IDC_ARROW);
  return 1;
}
