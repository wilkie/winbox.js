'use strict';

import { Brush } from '../../raster/brush.js';
import { brushOriginIn } from '../../raster/raster-op.js';
import { realiseBrush } from '../gdi/CreatePatternBrush.js';
import { syncPaint, WM_SYNCPAINT } from './erase.js';
import { SendMessage } from './SendMessage.js';
import { PostMessage } from './PostMessage.js';
import { keyState } from './accelerators.js';

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
import { defaultSetCursor, WM_SETCURSOR } from './set-cursor.js';
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
const WS_MAXIMIZEBOX = 0x00010000;

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
          /* Erased as `FillRect` fills: the brush realised in the window, if
           * it is not already somewhere, and its pattern from there
           * (`brushrlz`). A system colour's number is no brush to realise. */
          const brush =
            windowClass.hbrBackground > 21 ? this.handles.resolve(windowClass.hbrBackground) : null;

          if (brush instanceof Brush) {
            realiseBrush(dialog.window.surface, brush);
          }

          const origin =
            brush instanceof Brush
              ? brushOriginIn({ brush, screenOrigin: (dialog.window.surface as any).screenOrigin })
              : { x: 0, y: 0 };

          dialog.desktop.erase(dialog.window, background.colorref, background.pattern, origin);

          return 1;
        }

        return 0;
      }

      return 0;
  }

  return 0;
}

const HTCAPTION = 2;
const MA_ACTIVATE = 1;
const MA_NOACTIVATE = 3;
const HTSYSMENU = 3;
const HTMINBUTTON = 8;
const HTMAXBUTTON = 9;
const HTMENU = 5;
const HTHSCROLL = 6;
const HTVSCROLL = 7;
const SC_VSCROLL = 0xf070;
const SC_HSCROLL = 0xf080;
const WM_CANCELMODE = 0x001f;
const VK_SHIFT = 0x10;
const VK_MENU = 0x12;
const VK_ESCAPE = 0x1b;
const VK_F4 = 0x73;
const VK_F10 = 0x79;
const WS_SYSMENU = 0x00080000;
const CS_NOCLOSE = 0x0200;

/** A child, as USER tells one: `WS_CHILD` without `WS_POPUP`, and in a parent. */
function isChild(window) {
  return (window.style & (User.WS_CHILD | User.WS_POPUP)) === User.WS_CHILD && !!window.parent;
}

/** The window a child lies in that is not a child itself (`USER.EXE` seg2 `0ab8`). */
function topLevelOf(window) {
  while (isChild(window)) {
    window = window.parent;
  }

  return window;
}

/** `SC_CLOSE` posted to the active window, unless its class has `CS_NOCLOSE`. */
async function closeActive(system) {
  const active = system.rasterDesktop?.active;
  const handle = active && system.handles.resolve(active.hwnd);
  const windowClass = handle && system.handles.retrieve(handle.options?.windowClass);

  if (active && !((windowClass?.style ?? 0) & CS_NOCLOSE)) {
    await PostMessage.call(system, active.hwnd, User.WM_SYSCOMMAND, SC_CLOSE, 0);
  }
}

/**
 * The menu of a window that is not a child, entered from the keyboard:
 * Alt and a letter, the item it names; Alt and Space, the system menu; Alt
 * alone or F10, the bar, its first item selected, nothing open.
 */
async function keyboardMenu(system, window, lParam) {
  const hwnd = window.hwnd;
  const letter = String.fromCharCode(lParam & 0xff).toUpperCase();

  if (letter === ' ') {
    await trackMenu(system, hwnd, { kind: 'system', keyboard: true });
    return 0;
  }

  const labels = window.menu ?? [];

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

    /* The window's menu, open, ends (`iconclk`); then the capture is let go
     * if the window has it (`USER.EXE` seg1 `5ff2`, `5d0c`-`5d48`;
     * `btnmore`). USER ends a scroll bar's tracking first (`5d22`), which is
     * not followed here. */
    case WM_CANCELMODE:
      if (dialog.desktop.menuOwner === dialog.window) {
        dialog.desktop.menuCancelled = true;
      }

      if (system.rasterInput?.capture === dialog.window) {
        system.rasterInput.capture = null;
      }

      return 0;

    /* The cursor the window shows where the mouse is (`setcur`). */
    case WM_SETCURSOR:
      return defaultSetCursor(system, hwnd, wParam, lParam);

    /* Where on the window a point of the screen is: an icon all caption (`iconkid`). */
    case User.WM_NCHITTEST:
      return hitTest(dialog.desktop, dialog.window, (lParam << 16) >> 16, lParam >> 16);

    /* Whether a press makes its window active (`USER.EXE` seg1 `600e`): a
     * child asks the window it is in first, and answers what that answers
     * if it is not nought; else `MA_NOACTIVATE` on the caption, whose press
     * activates the window as `WM_NCLBUTTONDOWN` takes it, and `MA_ACTIVATE`
     * anywhere else (`mousemsg`). */
    case User.WM_MOUSEACTIVATE: {
      const parent = dialog.window.parent;

      if (isChild(dialog.window) && parent?.hwnd) {
        const answer = await SendMessage.call(system, parent.hwnd, uMsg, wParam, lParam);

        if (answer & 0xffff) {
          return answer;
        }
      }

      return (lParam & 0xffff) === HTCAPTION ? MA_NOACTIVATE : MA_ACTIVATE;
    }

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
      /* A double click on the caption: `WM_SYSCOMMAND` sent to the window,
       * with `HTCAPTION` in the command and the point as it came --
       * `SC_RESTORE` for an icon or a maximized window, `SC_MAXIMIZE` for
       * another only where it has a maximize box, and nothing at all for one
       * without (`USER.EXE` seg1 `0221`-`0238`, `0314`). USER asks the system
       * menu too, once it has brought the menu up to the window's state (seg9
       * `0d8b`), whether Maximize is grayed (seg1 `02cc`-`030d`): brought up
       * to it, that is the maximize box again. **Recorded** by `capdbl`: Save
       * As's frame and a window without the box stay as they are; a window
       * with it is maximized even with Maximize grayed by `EnableMenuItem`,
       * and one maximized is restored, box or no box. */
      if (wParam === HTCAPTION) {
        const state = dialog.window.state;

        if (state === 'normal' && !(dialog.window.style & WS_MAXIMIZEBOX)) {
          return 0;
        }

        await SendMessage.call(
          system,
          hwnd,
          User.WM_SYSCOMMAND,
          (state === 'normal' ? SC_MAXIMIZE : SC_RESTORE) | HTCAPTION,
          lParam
        );
        return 0;
      }

      return undefined;

    case User.WM_SYSCOMMAND:
      switch (wParam & 0xfff0) {
        case SC_KEYMENU: {
          /* A child has no menu: the menu the keys reach is that of the
           * nearest window it lies in that is not a child, or that has a
           * system menu of its own, entered here without that window being
           * sent anything (`USER.EXE` seg17 `00fe`-`012b`; `altchild`: Alt
           * and a letter in a child is `WM_SYSCOMMAND` to the child alone,
           * and its top-level window's menu opens). */
          let menuWindow = dialog.window;

          while (isChild(menuWindow) && !(menuWindow.style & WS_SYSMENU)) {
            menuWindow = menuWindow.parent;
          }

          /* A child with a system menu of its own, an MDI child: to its
           * top-level window, whose `DefFrameProc` has the keys, as
           * winbox.js had it before. Not measured. */
          if (isChild(menuWindow)) {
            const top = topLevelOf(menuWindow);

            return top.hwnd
              ? await SendMessage.call(system, top.hwnd, User.WM_SYSCOMMAND, wParam, lParam)
              : 0;
          }

          return keyboardMenu(system, menuWindow, lParam);
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
           * and Space would (`iconclk`) -- a child's, a document window's, as
           * Alt and the hyphen would (`USER.EXE` seg6 `1369`-`1391`). */
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
              const key = dialog.window.style & User.WS_CHILD ? 0x2d : 0x20;

              await SendMessage.call(system, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, key);
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

    /* The keys that reach the menu, as `DefWindowProc` takes them (`USER.EXE`
     * seg1 `616e`-`6299`), whichever window has the focus (`altchild`).
     * Two flags of USER's own: Alt pressed with nothing after it (`1d0`)
     * and F10 pressed (`352`).
     *
     * A system key with Alt down: Alt's first press sets the first flag,
     * any other key clears it, a repeat leaves it; F10's is cleared; and
     * Alt+F4 closes the active window -- `WM_SYSCOMMAND` with `SC_CLOSE`
     * posted to it, unless its class has `CS_NOCLOSE` (seg1 `578d`, `57ce`-
     * `5808`). From a child, that is the window it lies in (`altchild`).
     * Not followed: Alt with Tab, Escape or F6, which send the active window
     * `SC_NEXTWINDOW` or `SC_PREVWINDOW` (`57a7`); and, for Alt+F4, what
     * USER does first when the focus is in another top-level window than the
     * active one (`57db`-`57f5`). */
    case User.WM_SYSKEYDOWN:
      if (lParam & (1 << 29)) {
        if (!(lParam & (1 << 30))) {
          system._menuAlt = wParam === VK_MENU && !system._menuAlt;
        }

        system._menuF10 = false;

        if (wParam === VK_F4) {
          await closeActive(system);
        }

        return 0;
      }

      /* Without Alt: F10, its flag; Shift+Escape, the window's system menu
       * (`6201`-`6224`). */
      if (wParam === VK_F10) {
        system._menuF10 = true;
      } else if (wParam === VK_ESCAPE && keyState(system, VK_SHIFT) & 0x80) {
        await SendMessage.call(system, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, 0x20);
      }

      return 0;

    case User.WM_KEYDOWN:
      if (wParam === VK_F10) {
        system._menuF10 = true;
      }

      return 0;

    /* Alt released with nothing pressed after it, or F10 released after its
     * press: the menu of the top-level window, `SC_KEYMENU` sent to it --
     * from a child, past every window between (`6180`-`61b8`, seg2 `0ab8`;
     * `altchild`). Any release clears both flags. */
    case User.WM_SYSKEYUP:
    case User.WM_KEYUP: {
      const enter =
        (wParam === VK_MENU && system._menuAlt) || (wParam === VK_F10 && system._menuF10);

      system._menuAlt = false;
      system._menuF10 = false;

      if (enter) {
        await SendMessage.call(
          system,
          topLevelOf(dialog.window).hwnd,
          User.WM_SYSCOMMAND,
          SC_KEYMENU,
          0
        );
      }

      return 0;
    }

    /* A character typed with Alt: `SC_KEYMENU` with it, sent to the window
     * itself -- but Alt+Space in a child is the parent's, sent on to it as
     * the same `WM_SYSCHAR`, so it reaches the top-level window's system
     * menu one parent at a time; Tab and Escape are nothing (`622c`-`6290`;
     * `altchild`). Not followed: Enter in a window minimized, which posts it
     * `SC_RESTORE` (`6238`); and the beep for a character without Alt
     * (`6297`). */
    case User.WM_SYSCHAR:
      system._menuAlt = false;

      if (lParam & (1 << 29) && wParam && wParam !== 0x09 && wParam !== 0x1b) {
        if (wParam === 0x20 && isChild(dialog.window)) {
          await SendMessage.call(
            system,
            dialog.window.parent.hwnd,
            User.WM_SYSCHAR,
            wParam,
            lParam
          );
        } else {
          await SendMessage.call(system, hwnd, User.WM_SYSCOMMAND, SC_KEYMENU, wParam);
        }
      }

      return 0;

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
