'use strict';

import { D, W, word } from '../commdlg/api.js';
import { Pm, D_AUTO_ARRANGE, D_CREATING } from './main.js';
import { groups, keyOf, lock } from './loaded.js';
import { scrollBars } from './items.js';

/**
 * A group's window procedure, `GROUPWNDPROC` (seg2 `19b2`), as
 * `PROGMAN.EXE`'s answers what a hidden group's window is sent. As
 * `crates/winbox-win16/src/progman/window.rs`.
 *
 * WinBox's groups are real MDI children of its MDI client, the frame hidden
 * by the owner's decision, so USER places, minimizes, maximizes, restores and
 * activates them as it does Microsoft's. What only a shown window is sent --
 * painting, the mouse, keys, files dropped on it -- is left to
 * `DefMDIChildProc`.
 */

const WM_CREATE = 0x01;
const WM_SIZE = 0x05;
const WM_CLOSE = 0x10;
const WM_SYSCOMMAND = 0x112;
const WM_MDIACTIVATE = 0x222;
const SC_MINIMIZE = 0xf020;
const SC_MAXIMIZE = 0xf030;
const SC_RESTORE = 0xf120;
const SIZE_MINIMIZED = 1;

/** The window procedure. */
export async function GROUPWNDPROC(
  this: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  const instance = await word(this, 'USER', 'GetWindowWord', [W(hwnd), W(0xfffa)]);

  return groupMessage(
    new Pm(this, instance),
    hwnd & 0xffff,
    message & 0xffff,
    wParam & 0xffff,
    lParam >>> 0
  );
}

function defaultProc(pm: Pm, hwnd: number, message: number, wParam: number, lParam: number) {
  return pm.user('DefMDIChildProc', [W(hwnd), W(message), W(wParam), D(lParam)]);
}

async function groupMessage(
  pm: Pm,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
): Promise<number> {
  switch (message) {
    case WM_CREATE: {
      /* `1a68`: the group, the `MDICREATESTRUCT`'s `lParam`, kept in the
       * window's word; files may be dropped on it (`DragAcceptFiles`); and
       * it given the focus. */
      const params = pm.readFar(lParam, 4);
      const far = (params[0] | (params[1] << 8) | (params[2] << 16) | (params[3] << 24)) >>> 0;
      const key = pm.readFar((far & 0xffff0000) | ((far + 0x16) & 0xffff), 2);

      await pm.user('SetWindowWord', [W(hwnd), W(0), W(key[0] | (key[1] << 8))]);
      await pm.call('SHELL', 'DragAcceptFiles', [W(hwnd), W(1)]);
      await pm.user('SetFocus', [W(hwnd)]);

      return 0;
    }
    case WM_SIZE: {
      /* `1cf6`: `DefMDIChildProc`'s, and the scroll bars fitted unless it
       * was minimized or is being made. Arranging where `AutoArrange` is on
       * is not followed. */
      const answer = await defaultProc(pm, hwnd, message, wParam, lParam);

      if (wParam !== SIZE_MINIMIZED && !pm.d16(D_CREATING) && !pm.d16(D_AUTO_ARRANGE)) {
        await scrollBars(pm, hwnd);
      }

      return answer;
    }
    case WM_CLOSE:
      /* `1bb7`: a group is closed by minimizing it. */
      await pm.send(hwnd, WM_SYSCOMMAND, SC_MINIMIZE, 0);
      return 0;
    case WM_SYSCOMMAND:
      /* `1bcc`: restoring, the group's file read where it is not in memory,
       * nothing where it cannot be; restoring and maximizing invalidate it,
       * and maximizing takes its scroll bars away first. */
      if (wParam === SC_RESTORE && !(await lock(pm, await keyOf(pm, hwnd)))) {
        return 0;
      }

      if (wParam === SC_MAXIMIZE || wParam === SC_RESTORE) {
        await pm.user('InvalidateRect', [W(hwnd), D(0), W(0)]);
      }

      if (wParam === SC_MAXIMIZE) {
        const style = (await pm.user('GetWindowLong', [W(hwnd), W(0xfff0)])) >>> 0;

        await pm.user('SetWindowLong', [W(hwnd), W(0xfff0), D((style & ~0x00300000) >>> 0)]);
      }

      return defaultProc(pm, hwnd, message, wParam, lParam);
    case WM_MDIACTIVATE: {
      /* `1d43`: the current group follows the active window, while there is
       * one: none where nothing is activated, else the one activated as this
       * one is deactivated; one activated takes the focus. */
      const all = groups(pm);
      const activated = lParam & 0xffff;

      if (all.current) {
        if (!activated) {
          all.current = 0;
        } else if (!wParam) {
          groups(pm).current = await keyOf(pm, activated);
        } else {
          await pm.user('SetFocus', [W(hwnd)]);
        }
      }

      return defaultProc(pm, hwnd, message, wParam, lParam);
    }
  }

  return defaultProc(pm, hwnd, message, wParam, lParam);
}
