'use strict';

import { NULL } from '../consts.js';

import { User, MDICREATESTRUCT } from '../user.js';

import { CreateWindow } from './CreateWindow.js';
import { DestroyWindow } from './DestroyWindow.js';
import { SC_CLOSE, SC_KEYMENU, trackMenu } from './menu-loop.js';
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

  /* On the raster desktop: menus, and the commands of the system menu. */
  if (dialog instanceof RasterWindow) {
    const handled = await rasterDefault(this, dialog, hwnd, uMsg, wParam, lParam);

    if (handled !== undefined) {
      return handled;
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

const HTSYSMENU = 3;
const HTMENU = 5;
const VK_MENU = 0x12;
const VK_F10 = 0x79;

/**
 * What `DefWindowProc` does for a window on the raster desktop that it does
 * nowhere else, or `undefined` for a message it leaves to the rest.
 */
async function rasterDefault(system, dialog, hwnd, uMsg, wParam, lParam) {
  switch (uMsg) {
    case User.WM_NCLBUTTONDOWN: {
      /* A press on the menu bar opens that item's menu; on the box, the system menu. */
      if (wParam === HTMENU) {
        const x = lParam & 0xffff;
        const y = (lParam >> 16) & 0xffff;
        const index = dialog.desktop
          .menuBarItems(dialog.window)
          .findIndex(
            (item) => x >= item.left && x < item.right && y >= item.top && y < item.bottom
          );

        if (index >= 0) {
          await trackMenu(system, hwnd, { kind: 'bar', index, keyboard: false, open: true });
        }

        return 0;
      }

      if (wParam === HTSYSMENU) {
        await trackMenu(system, hwnd, { kind: 'system', keyboard: false });
        return 0;
      }

      return undefined;
    }

    case User.WM_SYSCOMMAND:
      switch (wParam & 0xfff0) {
        case SC_KEYMENU: {
          /* Alt and a letter: the item it names; Alt and Space: the system
           * menu; Alt alone: the bar, its first item selected, nothing open. */
          const letter = String.fromCharCode(lParam & 0xff).toUpperCase();

          if (letter === ' ') {
            await trackMenu(system, hwnd, { kind: 'system', keyboard: true });
            return 0;
          }

          const labels = dialog.window.menu ?? [];

          if (!labels.length) {
            return 0;
          }

          if ((lParam & 0xff) === 0) {
            await trackMenu(system, hwnd, { kind: 'bar', index: 0, keyboard: true, open: false });
            return 0;
          }

          const index = labels.findIndex((label) => {
            const at = label.indexOf('&');

            return at >= 0 && label[at + 1]?.toUpperCase() === letter;
          });

          if (index >= 0) {
            await trackMenu(system, hwnd, { kind: 'bar', index, keyboard: true, open: true });
          }

          return 0;
        }

        case SC_CLOSE: {
          const windowClass = system.handles.retrieve(dialog.options.windowClass);

          await system.scheduler.callWndProc(windowClass, hwnd, User.WM_CLOSE, 0, 0);
          return 0;
        }
      }

      return 0;

    /* Alt released alone, or F10: into the menu bar from the keyboard. */
    case User.WM_SYSKEYUP:
    case User.WM_KEYUP:
      if ((uMsg === User.WM_SYSKEYUP && wParam === VK_MENU) || wParam === VK_F10) {
        return rasterDefault(system, dialog, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, 0);
      }

      return undefined;

    case User.WM_SYSCHAR:
      return rasterDefault(system, dialog, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, wParam);

    case User.WM_CLOSE:
      await DestroyWindow.call(system, hwnd);
      return 0;
  }

  return undefined;
}
