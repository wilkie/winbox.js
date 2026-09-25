'use strict';

import { NULL } from '../consts.js';

import { User, MDICREATESTRUCT } from '../user.js';

import { CreateWindow } from './CreateWindow.js';
import { backgroundOf } from './raster-desktop.js';
import { RasterWindow } from './raster-window.js';

/**
 * The **DefWindowProc** function calls the default window procedure. The
 * default window procedure provides default processing for any window messges
 * that an application does not process. This function ensures that every
 * message is processed. It should be called with the same parameters as those
 * received by the window procedure.
 *
 * **See also**:
 * {@link User.DefDlgProc DefDlgProc}
 *
 * @static
 * @function DefWindowProc
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window that received the message.
 * @param {Types.UINT} uMsg - Specifies the message.
 * @param {Types.WPARAM} wParam - Specifies 16 bits of additional
 *                                message-dependent information.
 * @param {Types.LPARAM} lParam - Specifies 32 bits of additional
 *                                message-dependent information.
 *
 * @return {Types.LRESULT} The return value is the result of the message
 *                         processing and depends on the message sent.
 */
export async function DefWindowProc(hwnd, uMsg, wParam, lParam) {
  const dialog = this.handles.resolve(hwnd);

  if (!dialog) {
    return 0;
  }

  const windowClass = this.handles.retrieve(dialog.options.windowClass);
  if (windowClass.lpszClassName.toUpperCase() === 'MDICLIENT') {
    // This is an MDI client
    switch (uMsg) {
      case User.WM_MDICREATE:
        const hi = (lParam >> 16) & 0xffff;
        const lo = lParam & 0xffff;
        const struct = new MDICREATESTRUCT();
        struct.loadFromMemory(this.machine.memory, hi >> 3, lo);

        // Create the window and return the new hWnd
        return await CreateWindow.bind(this)(
          struct.szClass,
          struct.szTitle,
          struct.style,
          struct.x,
          struct.y,
          struct.cx,
          struct.cy,
          hwnd,
          NULL,
          struct.hOwner,
          struct.lParam
        );
    }
  }

  // Perform default actions
  switch (uMsg) {
    case User.WM_PAINT:
      /* What `BeginPaint` and `EndPaint` would do: the window is painted, its
       * background erased if it was due to be. */
      if (dialog instanceof RasterWindow) {
        const erase = dialog.window.needsErase;

        dialog.window.needsErase = false;
        dialog.window.needsPaint = false;

        if (erase) {
          await this.scheduler.callWndProc(windowClass, hwnd, User.WM_ERASEBKGND, 0, 0);
        }
      }

      return 0;

    case User.WM_ERASEBKGND:
      /* On the raster desktop: the class's brush, a system colour's or its
       * own, over what shows of the client area. */
      if (dialog instanceof RasterWindow) {
        const background = backgroundOf(this, windowClass.hbrBackground);

        if (background) {
          dialog.desktop.erase(dialog.window, background.colorref);
        }

        return 1;
      }

      // Paint the update region with the window class' brush
      const brush = this.handles.resolve(windowClass.hbrBackground);
      if (brush) {
        // TODO: only affect update region
        const surface = dialog.surface;
        const old = surface.brush;
        surface.brush = brush;
        surface.fillRect(0, 0, dialog.innerWidth, dialog.innerHeight);
        surface.brush = old;
      }
      return 0;
  }

  return 0;
}
