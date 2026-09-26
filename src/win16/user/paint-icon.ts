'use strict';

import { RasterWindow } from './raster-window.js';

/**
 * A minimized window whose class has an icon is painted as an icon: USER
 * sends it `WM_PAINTICON`, with a `wParam` of 1, where another window gets
 * `WM_PAINT` (`USER.EXE` seg1 `4487`, `787e`), and `BeginPaint` sends it
 * `WM_ICONERASEBKGND` where another gets `WM_ERASEBKGND` (seg1 `75e7`,
 * `7a96`). `DefWindowProc` draws the icon and its background (seg1 `580f`,
 * `5881`).
 */

export const WM_PAINTICON = 0x0026;
export const WM_ICONERASEBKGND = 0x0027;

/** Whether a window is painted as an icon. */
export function paintsIcon(system: any, hwnd: number): boolean {
  const dialog = system.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow) || dialog.window.state !== 'minimized') {
    return false;
  }

  return !!system.handles.retrieve(dialog.options.windowClass)?.hIcon;
}

/** The paint message for a window: `WM_PAINTICON`, with its 1, or `WM_PAINT`. */
export function paintMessage(system: any, hwnd: number) {
  return paintsIcon(system, hwnd) ? { message: WM_PAINTICON, wParam: 1 } : { message: 0x000f, wParam: 0 };
}
