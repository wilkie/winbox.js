'use strict';

import { syncPaint, WM_SYNCPAINT } from './erase.js';
import { SendMessage } from './SendMessage.js';

import { NULL } from '../consts.js';

import { User, MDICREATESTRUCT, PAINTSTRUCT } from '../user.js';
import { BeginPaint } from './BeginPaint.js';
import { EndPaint } from './EndPaint.js';

import { CreateWindow } from './CreateWindow.js';
import { copyText, stringAt } from './control-classes.js';
import { DestroyWindow } from './DestroyWindow.js';
import {
  SC_CLOSE,
  SC_KEYMENU,
  SC_MAXIMIZE,
  SC_MINIMIZE,
  SC_MOVE,
  SC_RESTORE,
  SC_SIZE,
  trackMenu,
} from './menu-loop.js';
import { ShowWindow } from './ShowWindow.js';
import { SetFocus } from './SetFocus.js';
import { HTBOTTOMRIGHT, HTLEFT, trackWindow } from './track-loop.js';
import { backgroundOf } from './raster-desktop.js';
import { RasterWindow } from './raster-window.js';
import { WM_ICONERASEBKGND, WM_PAINTICON } from './paint-icon.js';
import { setFocus } from './dialogs.js';
import { trackScrollBar } from './scroll-track.js';
import { defaultControlColour } from './ctlcolor.js';
import { windowPosChanged } from './window-state.js';
import { hitTest } from './raster-input.js';
import { deliverActivation } from './activation.js';
import { CHARARRAY, Struct } from '../types.js';

/** The buffer `DefWindowProc` reads a caption into. */
class CaptionText extends Struct {
  constructor() {
    super([['text', CHARARRAY + 80]]);
  }
}

/**
 * A window asked for its text by USER, `WM_GETTEXT` for `count` characters:
 * 79 for its caption, 80 for its icon's title (`showmin`).
 */
export async function askText(system: any, hwnd: number, dialog: any, count: number) {
  const windowClass = system.handles.retrieve(dialog.options.windowClass);

  if (windowClass) {
    await system.scheduler.callWndProc(windowClass, hwnd, User.WM_GETTEXT, count, [
      new CaptionText(),
    ]);
  }
}

/**
 * A caption about to be drawn is asked of its window first, with
 * `WM_GETTEXT` for 79 characters at most (`showseq`: after every
 * `WM_NCACTIVATE` and `WM_NCPAINT` of a window with a caption).
 */
async function askCaption(system: any, hwnd: number, dialog: any) {
  if (!(dialog instanceof RasterWindow) || !dialog.window.visible) {
    return;
  }

  /* A window minimized draws no caption (`showmin`). */
  if ((dialog.window.style & WS_CAPTION) !== WS_CAPTION || dialog.window.state === 'minimized') {
    return;
  }

  await askText(system, hwnd, dialog, 0x4f);
}

const WS_CAPTION = 0x00c00000;

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
      case User.WM_MDICREATE: {
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
      /* `BeginPaint` and `EndPaint`: the window is painted, its background
       * erased with the paint's own DC if it was due to be. */
      if (dialog instanceof RasterWindow) {
        const paint: any = new PAINTSTRUCT();

        await BeginPaint.call(this, hwnd, paint);
        EndPaint.call(this, hwnd, paint);
      }

      return 0;

    /* Activated, the window takes the focus (`USER.EXE` seg1 `5e84`). */
    case User.WM_ACTIVATE:
      /* A window made active takes the focus -- none, if it is minimized
       * (`showsq2`: the window that had it told it went nowhere). */
      if (wParam & 0xffff && dialog instanceof RasterWindow) {
        if (dialog.window.state === 'minimized') {
          await SetFocus.call(this, 0);
        } else {
          await setFocus(this, hwnd);
        }
      }

      return 0;

    case WM_PAINTICON:
      /* As `WM_PAINT`, its background by `WM_ICONERASEBKGND`, and then the
       * class's icon drawn in the middle of the window (seg1 `580f`). */
      if (dialog instanceof RasterWindow) {
        const paint: any = new PAINTSTRUCT();

        await BeginPaint.call(this, hwnd, paint);
        dialog.desktop.drawIcon(dialog.window);
        EndPaint.call(this, hwnd, paint);
      }

      return 0;

    /* The caption drawn active or not, as it is told, the window's
     * activation unchanged: activating sends it, and so does `FlashWindow`. */
    case User.WM_NCACTIVATE:
      if (dialog instanceof RasterWindow) {
        dialog.window.lit = wParam !== 0;
        await askCaption(this, hwnd, dialog);

        if (dialog.window.visible) {
          dialog.desktop.paintFrame(dialog.window);
        }
      }

      return 1;

    /* The frame: drawn as USER draws every window's. */
    /* Drawn now what another task uncovered (seg1 `6151`); see `erase.ts`. */
    case WM_SYNCPAINT:
      await syncPaint(this, hwnd);
      return 0;

    case User.WM_NCPAINT:
      if (dialog instanceof RasterWindow && dialog.window.visible) {
        await askCaption(this, hwnd, dialog);
        dialog.desktop.paintFrame(dialog.window);
      }

      return 0;

    case WM_ICONERASEBKGND:
      /* A child's parent's class brush; the desktop's behind a top-level
       * window (seg1 `5881`). */
      if (dialog instanceof RasterWindow) {
        dialog.desktop.eraseIcon(dialog.window);
      }

      return 1;

    /* A control's colours, as USER answers them for a parent that leaves
     * them (seg1 `5f9c`): see `ctlcolor.ts`. */
    case User.WM_CTLCOLOR:
      return defaultControlColour(this, wParam & 0xffff, (Number(lParam) >>> 16) & 0xffff);

    case User.WM_ERASEBKGND:
      /* On the raster desktop: the class's brush, a system colour's or its
       * own, over what shows of the client area. With no brush nothing is
       * drawn and the answer is nought, the erase not done (seg1 `6355`);
       * see `erase.ts`. */
      if (dialog instanceof RasterWindow) {
        const background = backgroundOf(this, windowClass.hbrBackground);

        /* A hollow brush -- `NULL_BRUSH` -- is a brush, and paints
         * nothing: what was there shows. Jewel Thief of the corpus gives
         * its logo's class one, and the dialog's white shows round it. */
        if (background?.hollow) {
          return 1;
        }

        if (background) {
          dialog.desktop.erase(dialog.window, background.colorref);

          return 1;
        }

        return 0;
      }

      return 0;
  }

  return 0;
}

const HTCAPTION = 2;
const HTSYSMENU = 3;
const HTMINBUTTON = 8;
const HTMAXBUTTON = 9;
const HTMENU = 5;
const HTHSCROLL = 6;
const HTVSCROLL = 7;
const SC_VSCROLL = 0xf070;
const SC_HSCROLL = 0xf080;
const WM_CANCELMODE = 0x001f;
const VK_MENU = 0x12;
const VK_F4 = 0x73;
const VK_F10 = 0x79;

/** A window's top-level window made active, if it is not, as a click makes it. */
async function activateByClick(system, window) {
  const desktop = system.rasterDesktop;
  let top = window;

  while (top.parent) {
    top = top.parent;
  }

  if (top.active) {
    return;
  }

  desktop.show(top);

  if (desktop.pendingActivation) {
    desktop.pendingActivation.click = true;
  }

  await deliverActivation(system);
}

/**
 * What `DefWindowProc` does for a window on the raster desktop that it does
 * nowhere else, or `undefined` for a message it leaves to the rest.
 */
async function rasterDefault(system, dialog, hwnd, uMsg, wParam, lParam) {
  /* A press on a scroll bar is a system command to the window, pressed once
   * or twice alike (`USER.EXE` seg1 `01cb`, `0314`). */
  if (
    (uMsg === User.WM_NCLBUTTONDOWN || uMsg === User.WM_NCLBUTTONDBLCLK) &&
    (wParam === HTVSCROLL || wParam === HTHSCROLL)
  ) {
    const command = (wParam === HTVSCROLL ? SC_VSCROLL : SC_HSCROLL) | wParam;

    await SendMessage.call(system, hwnd, User.WM_SYSCOMMAND, command, lParam);
    return 0;
  }

  switch (uMsg) {
    /* An icon may be restored (`iconclk`). */
    case User.WM_QUERYOPEN:
      return 1;

    /* The window's menu, open, ends (`iconclk`). */
    case WM_CANCELMODE:
      if (dialog.desktop.menuOwner === dialog.window) {
        dialog.desktop.menuCancelled = true;
      }

      return 0;

    /* Where on the window a point of the screen is: an icon all caption (`iconkid`). */
    case User.WM_NCHITTEST:
      return hitTest(dialog.desktop, dialog.window, (lParam << 16) >> 16, lParam >> 16);

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

      const x = (lParam << 16) >> 16;
      const y = lParam >> 16;

      /* The caption: its window made active, as a click makes it, and then
       * moved by `SC_MOVE` with `HTCAPTION`, the point as it came
       * (`iconclk`). The frame's edges and corners size it. */
      if (wParam === HTCAPTION) {
        await activateByClick(system, dialog.window);
        await SendMessage.call(system, hwnd, User.WM_SYSCOMMAND, SC_MOVE | HTCAPTION, lParam);
        return 0;
      }

      if (wParam >= HTLEFT && wParam <= HTBOTTOMRIGHT && dialog.window.state === 'normal') {
        await trackWindow(system, hwnd, { mode: 'size', keyboard: false, x, y, hit: wParam });
        return 0;
      }

      /* Not measured: Windows shows the box pressed until the button is
       * released over it; here, the press is enough. */
      if (wParam === HTMINBUTTON) {
        return rasterDefault(system, dialog, hwnd, User.WM_SYSCOMMAND, SC_MINIMIZE, 0);
      }

      if (wParam === HTMAXBUTTON) {
        return rasterDefault(
          system,
          dialog,
          hwnd,
          User.WM_SYSCOMMAND,
          dialog.window.state === 'maximized' ? SC_RESTORE : SC_MAXIMIZE,
          0
        );
      }

      return undefined;
    }

    case User.WM_NCLBUTTONDBLCLK:
      /* A double click on the caption maximizes the window, or restores it;
       * on an icon, it restores it. */
      if (wParam === HTCAPTION) {
        const state = dialog.window.state;

        return rasterDefault(
          system,
          dialog,
          hwnd,
          User.WM_SYSCOMMAND,
          state === 'normal' ? SC_MAXIMIZE : SC_RESTORE,
          0
        );
      }

      return undefined;

    case User.WM_SYSCOMMAND:
      switch (wParam & 0xfff0) {
        case SC_KEYMENU: {
          /* A child has no menu: the keys are for the window it lies in, as
           * Alt and a letter reach Notepad's menu from its edit control. */
          if (dialog.window.parent) {
            let top = dialog.window.parent;

            while (top.parent) {
              top = top.parent;
            }

            return top.hwnd
              ? await SendMessage.call(system, top.hwnd, User.WM_SYSCOMMAND, wParam, lParam)
              : 0;
          }

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

        /* The scroll bar followed until let go, unless something has the
         * mouse or the window is disabled (seg1 `037c`). */
        case SC_VSCROLL:
        case SC_HSCROLL:
          if (!system.rasterInput?.capture && !(dialog.window.style & User.WS_DISABLED)) {
            await trackScrollBar(system, hwnd, wParam & 0x0f, (lParam << 16) >> 16, lParam >> 16);
          }

          return 0;

        case SC_MOVE:
          /* From the caption, the mouse moves it: not a window maximized. An
           * icon let go where it was pressed opens its system menu, as Alt
           * and Space would (`iconclk`). */
          if ((wParam & 0x0f) === HTCAPTION) {
            if (dialog.window.state === 'maximized') {
              return 0;
            }

            const moved = await trackWindow(system, hwnd, {
              mode: 'move',
              keyboard: false,
              x: (lParam << 16) >> 16,
              y: lParam >> 16,
            });

            if (!moved && dialog.window.state === 'minimized') {
              await SendMessage.call(system, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, 0x20);
            }

            return 0;
          }

          await trackWindow(system, hwnd, { mode: 'move', keyboard: true });
          return 0;

        case SC_SIZE:
          await trackWindow(system, hwnd, { mode: 'size', keyboard: true });
          return 0;

        case SC_MINIMIZE:
          await ShowWindow.call(system, hwnd, User.SW_MINIMIZE);
          return 0;

        case SC_MAXIMIZE:
          await ShowWindow.call(system, hwnd, User.SW_SHOWMAXIMIZED);
          return 0;

        case SC_RESTORE:
          await ShowWindow.call(system, hwnd, User.SW_RESTORE);
          return 0;

        case SC_CLOSE: {
          const windowClass = system.handles.retrieve(dialog.options.windowClass);

          await system.scheduler.callWndProc(windowClass, hwnd, User.WM_CLOSE, 0, 0);
          return 0;
        }
      }

      return 0;

    /* Whether Alt is alone so far: any other key pressed while it is down
     * makes its release nothing, as Alt and a letter is the letter's menu. */
    case User.WM_SYSKEYDOWN:
    case User.WM_KEYDOWN:
      system._altAlone = uMsg === User.WM_SYSKEYDOWN && wParam === VK_MENU;

      /* Alt+F4 is the system menu's Close, as the menu itself says. */
      if (uMsg === User.WM_SYSKEYDOWN && wParam === VK_F4) {
        return rasterDefault(system, dialog, hwnd, User.WM_SYSCOMMAND, SC_CLOSE, 0);
      }

      return undefined;

    /* Alt released alone, or F10: into the menu bar from the keyboard. */
    case User.WM_SYSKEYUP:
    case User.WM_KEYUP:
      if (uMsg === User.WM_SYSKEYUP && wParam === VK_MENU) {
        const alone = !!system._altAlone;

        system._altAlone = false;

        return alone
          ? rasterDefault(system, dialog, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, 0)
          : undefined;
      }

      if (wParam === VK_F10) {
        return rasterDefault(system, dialog, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, 0);
      }

      return undefined;

    case User.WM_SYSCHAR:
      return rasterDefault(system, dialog, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, wParam);

    case User.WM_CLOSE:
      await DestroyWindow.call(system, hwnd);
      return 0;

    /* The window's text: its caption, redrawn when it changes. */
    case User.WM_SETTEXT:
      dialog.caption = stringAt(system, lParam);
      return 1;

    /* The window is to be made: TRUE, or `CreateWindow` gives it up
     * (`showsq2`). */
    case User.WM_NCCREATE:
      return 1;

    case User.WM_GETTEXT:
      return copyText(system, dialog.caption ?? '', lParam, wParam);

    case User.WM_GETTEXTLENGTH:
      return String(dialog.caption ?? '').length;

    /* `WM_MOVE` and `WM_SIZE`, as the flags say the window moved and was
     * sized (`defer`); see `positionRaster`. */
    case User.WM_WINDOWPOSCHANGED:
      await windowPosChanged(system, hwnd, windowPosFlags(system, lParam));
      return 0;
  }

  return undefined;
}

/** The flags of a `WINDOWPOS`: one winbox.js laid out, or one at a far pointer. */
function windowPosFlags(system: any, lParam: any) {
  if (lParam instanceof Array) {
    return lParam[0].flags;
  }

  return system.machine.cpu.core.read16(
    (lParam >>> 16) & 0xffff,
    ((lParam & 0xffff) + 12) & 0xffff
  );
}
