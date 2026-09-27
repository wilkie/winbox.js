'use strict';

import { User } from '../user.js';

import { type DesktopWindow } from './desktop.js';
import { handleOf, MenuData, MF_DISABLED, MF_GRAYED, MF_SEPARATOR } from './menu-data.js';
import { nextMessage } from './queue.js';
import { messageFilter, MSGF_MENU } from './hooks.js';
import { RasterWindow } from './raster-window.js';

/**
 * A menu, open: what `DefWindowProc` does when a window's menu bar or system
 * menu box is pressed, or `WM_SYSCOMMAND` asks for its menu from the keyboard,
 * and what `TrackPopupMenu` does.
 *
 * As in Windows, a menu is modal. The loop takes the program's messages
 * itself until the menu closes: the mouse and the keys drive the menu, and
 * everything else -- timers, paints -- is dispatched to its window as the
 * program's own loop would. When an item is chosen, its command is sent once
 * the menu is closed: `WM_COMMAND`, or `WM_SYSCOMMAND` from the system menu.
 *
 * How the menu is drawn open is measured (see `menus.ts`); how it is driven
 * is not yet: no probe records a menu being used. Where a submenu opens, and
 * how a menu that would leave the screen is moved, are this implementation's.
 */

export const SC_SIZE = 0xf000;
export const SC_MOVE = 0xf010;
export const SC_MINIMIZE = 0xf020;
export const SC_MAXIMIZE = 0xf030;
export const SC_CLOSE = 0xf060;
export const SC_KEYMENU = 0xf100;
export const SC_RESTORE = 0xf120;
export const SC_TASKLIST = 0xf130;

const WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;

const VK_RETURN = 0x0d;
const VK_MENU = 0x12;
const VK_ESCAPE = 0x1b;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const VK_F10 = 0x79;

/** A window's system menu: the one a program changed, or the standard one. */
export function systemMenuOf(window: DesktopWindow) {
  if (!window.systemMenu) {
    const menu = new MenuData();
    const add = (id: number, text: string | null) =>
      menu.items.push({ flags: text === null ? MF_SEPARATOR : 0, id, text });

    add(SC_RESTORE, '&Restore');
    add(SC_MOVE, '&Move');
    add(SC_SIZE, '&Size');
    add(SC_MINIMIZE, 'Mi&nimize');
    add(SC_MAXIMIZE, 'Ma&ximize');
    add(0, null);
    add(SC_CLOSE, '&Close\tAlt+F4');
    add(0, null);
    add(SC_TASKLIST, 'S&witch To...\tCtrl+Esc');
    window.systemMenu = menu;
  }

  /* Grayed by what the window can do now: restored, it cannot be restored. */
  const style = window.style >>> 0;
  const gray = (id: number, grayed: boolean) => {
    const found = window.systemMenu!.find(id, 0);

    if (found) {
      found.item.flags = (found.item.flags & ~MF_GRAYED) | (grayed ? MF_GRAYED : 0);
    }
  };

  gray(SC_RESTORE, true);
  gray(SC_SIZE, !(style & WS_THICKFRAME));
  gray(SC_MINIMIZE, !(style & WS_MINIMIZEBOX));
  gray(SC_MAXIMIZE, !(style & WS_MAXIMIZEBOX));

  return window.systemMenu;
}

/** Where a menu starts: an item of the bar, the system menu, or a pop-up at a place. */
export type MenuStart =
  | { kind: 'bar'; index: number; keyboard: boolean; open: boolean }
  | { kind: 'system'; keyboard: boolean }
  | { kind: 'popup'; menu: MenuData; x: number; y: number };

interface Level {
  menu: MenuData;
  window: DesktopWindow;
}

/**
 * Runs a menu to its end, and sends its command. Returns the command chosen,
 * or 0.
 */
export async function trackMenu(system: any, hwnd: number, start: MenuStart) {
  const owner = system.handles.resolve(hwnd);

  if (!(owner instanceof RasterWindow)) {
    return 0;
  }

  const desktop = owner.desktop;
  const window = owner.window;
  const input = system.rasterInput;
  const windowClass = system.handles.retrieve(owner.options.windowClass);
  const send = (message: number, wParam: number, lParam: number) =>
    system.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam);

  const barMenu: MenuData | null =
    start.kind === 'bar' && owner.options.menu ? system.handles.resolve(owner.options.menu) : null;
  const levels: Level[] = [];
  let bar = start.kind === 'bar' ? start.index : -1;
  let keyboard = start.kind !== 'popup' && start.keyboard;
  let chosen = 0;
  let fromSystem = start.kind === 'system';
  let done = false;

  const top = () => levels[levels.length - 1];
  const selected = () => top()?.window.popup?.selected ?? -1;

  const select = async (index: number) => {
    const level = top();

    if (!level || level.window.popup!.selected === index) {
      return;
    }

    level.window.popup!.selected = index;
    desktop.paintPopup(level.window);

    const item = level.menu.items[index];

    if (item) {
      await send(
        User.WM_MENUSELECT,
        item.popup ? handleOf(system, item.popup) : item.id,
        ((item.flags & 0xffff) | (handleOf(system, level.menu) << 16)) >>> 0
      );
    }
  };

  const open = async (menu: MenuData, x: number, y: number, index: number, isSystem: boolean) => {
    await send(
      User.WM_INITMENUPOPUP,
      handleOf(system, menu),
      (index & 0xffff) | (isSystem ? 1 << 16 : 0)
    );

    const popup = desktop.openPopup(menu, x, y, -1);

    /* Kept on the screen: moved left, or up, as far as it has to be. */
    const left = Math.max(0, Math.min(popup.left, desktop.screen.width - popup.width));
    const topEdge = Math.max(0, Math.min(popup.top, desktop.screen.height - popup.height));

    if (left !== popup.left || topEdge !== popup.top) {
      desktop.destroy(popup);
      levels.push({ menu, window: desktop.openPopup(menu, left, topEdge, -1) });
    } else {
      levels.push({ menu, window: popup });
    }

    if (keyboard) {
      await select(firstSelectable(menu, -1, 1));
    }
  };

  const closeTo = (depth: number) => {
    while (levels.length > depth) {
      desktop.destroy(levels.pop()!.window);
    }
  };

  const openBar = async (index: number) => {
    closeTo(0);
    bar = index;
    window.menuSelected = index;
    desktop.paintFrame(window);

    const item = barMenu?.items[index];

    if (item?.popup) {
      const place = desktop.menuBarItems(window)[index];

      await open(item.popup, place.left, place.bottom, index, false);
    }
  };

  const openSystem = async () => {
    closeTo(0);
    bar = -1;
    window.menuSelected = undefined;
    window.systemMenuOpen = true;
    fromSystem = true;
    desktop.paintFrame(window);

    const place = desktop.systemMenuPlace(window);

    await open(systemMenuOf(window), place.x, place.y, 0, true);
  };

  /** An item chosen: a pop-up opens, a grayed item does nothing, anything else is the command. */
  const choose = async (index: number) => {
    const level = top();
    const item = level?.menu.items[index];

    if (!item || item.flags & MF_SEPARATOR) {
      return;
    }

    if (item.popup) {
      const place = desktop.popupPlaces(level.window)[index];

      await select(index);
      await open(
        item.popup,
        level.window.left + level.window.width - 2,
        level.window.top + place.top - 1,
        index,
        false
      );
      return;
    }

    if (!(item.flags & (MF_GRAYED | MF_DISABLED))) {
      chosen = item.id;
    }

    done = true;
  };

  /* Into the menu. */
  const previousCapture = input?.capture ?? null;

  if (input) {
    input.capture = window;
  }

  desktop.menuOwner = window;

  if (barMenu) {
    await send(User.WM_INITMENU, handleOf(system, barMenu), 0);
  }

  if (start.kind === 'bar') {
    if (start.open) {
      await openBar(start.index);
    } else {
      window.menuSelected = start.index;
      desktop.paintFrame(window);
    }
  } else if (start.kind === 'system') {
    await send(User.WM_INITMENU, handleOf(system, systemMenuOf(window)), 0);
    await openSystem();
  } else {
    /* Put up with no button down, the menu is driven from the keyboard, its
     * first item selected: the `menus` probe's pop-up, shown by a program
     * with the mouse at rest, has it. */
    keyboard = !(input?.buttons ?? 0);
    await open(start.menu, start.x, start.y, 0, false);
  }

  /* The message filters are told of the menu, as a `WM_MENUSELECT`, as it
   * starts and as it ends: `hooks` recorded one each side of its messages. */
  await messageFilter(system, { hwnd, message: User.WM_MENUSELECT }, MSGF_MENU);

  while (!done) {
    const msg = await nextMessage(system);

    if (!msg) {
      break;
    }

    /* The message filters first: one that takes the message ends it. */
    if (await messageFilter(system, msg, MSGF_MENU)) {
      continue;
    }

    if (msg.message === User.WM_KEYDOWN || msg.message === User.WM_SYSKEYDOWN) {
      keyboard = true;
      await key(msg.wParam);
      continue;
    }

    /* The pointer, in either form: the page posts each mouse event as it
     * happens, hit-tested then, so what came before this loop took the
     * capture -- the release of the press that opened the menu -- is still
     * the non-client message it was posted as. Windows hit-tests when a
     * message is taken, and has no such case. */
    const pointed = clientForm(msg.message);

    if (
      pointed === User.WM_MOUSEMOVE ||
      pointed === User.WM_LBUTTONDOWN ||
      pointed === User.WM_LBUTTONUP ||
      pointed === User.WM_RBUTTONDOWN ||
      pointed === User.WM_RBUTTONUP
    ) {
      keyboard = false;
      await pointer(msg, pointed);
      continue;
    }

    if (
      msg.message === User.WM_KEYUP ||
      msg.message === User.WM_SYSKEYUP ||
      msg.message === User.WM_CHAR ||
      msg.message === User.WM_SYSCHAR
    ) {
      continue;
    }

    await dispatch(system, msg);
  }

  await messageFilter(system, { hwnd, message: User.WM_MENUSELECT }, MSGF_MENU);

  /* Out of it: everything it opened closed, its window drawn as it was. */
  closeTo(0);
  window.menuSelected = undefined;
  window.systemMenuOpen = false;
  desktop.menuOwner = null;
  desktop.paintFrame(window);

  if (input) {
    input.capture = previousCapture;
  }

  await send(User.WM_MENUSELECT, 0, 0xffff);

  if (chosen) {
    await send(fromSystem ? User.WM_SYSCOMMAND : User.WM_COMMAND, chosen, 0);
  }

  return chosen;

  async function key(code: number) {
    const level = top();

    switch (code) {
      case VK_ESCAPE:
        if (levels.length > 1 || (levels.length === 1 && start.kind === 'bar')) {
          closeTo(levels.length - 1);

          if (!levels.length && start.kind !== 'bar') {
            done = true;
          }
        } else {
          done = true;
        }
        return;

      case VK_MENU:
      case VK_F10:
        done = true;
        return;

      case VK_DOWN:
      case VK_UP:
        if (!level && bar >= 0) {
          await openBar(bar);
          return;
        }

        if (level) {
          await select(firstSelectable(level.menu, selected(), code === VK_DOWN ? 1 : -1));
        }
        return;

      case VK_RIGHT:
      case VK_LEFT: {
        const item = level?.menu.items[selected()];

        if (code === VK_RIGHT && item?.popup) {
          await choose(selected());
          return;
        }

        if (code === VK_LEFT && levels.length > 1) {
          closeTo(levels.length - 1);
          return;
        }

        if (barMenu && barMenu.items.length) {
          const count = barMenu.items.length;
          const next = ((bar < 0 ? 0 : bar) + (code === VK_RIGHT ? 1 : -1) + count) % count;
          const wasOpen = levels.length > 0;

          window.systemMenuOpen = false;
          fromSystem = false;

          if (wasOpen) {
            await openBar(next);
          } else {
            bar = next;
            window.menuSelected = next;
            desktop.paintFrame(window);
          }
        }
        return;
      }

      case VK_RETURN:
        if (level) {
          await choose(selected());
        } else if (bar >= 0) {
          await openBar(bar);
        }
        return;
    }

    /* A letter: the item whose mnemonic it is. */
    const letter = String.fromCharCode(code).toUpperCase();
    const items = level ? level.menu.items : (barMenu?.items ?? []);
    const index = items.findIndex(
      (item) => mnemonic(item.text) === letter && !(item.flags & MF_SEPARATOR)
    );

    if (index < 0) {
      return;
    }

    if (level) {
      await select(index);
      await choose(index);
    } else {
      await openBar(index);
    }
  }

  async function pointer(msg: any, message: number) {
    const x = msg.pt.x;
    const y = msg.pt.y;

    /* Over an open pop-up, the deepest first. */
    for (let depth = levels.length - 1; depth >= 0; depth--) {
      const level = levels[depth];
      const inside =
        x >= level.window.left &&
        y >= level.window.top &&
        x < level.window.left + level.window.width - 1 &&
        y < level.window.top + level.window.height - 1;

      if (!inside) {
        continue;
      }

      closeTo(depth + 1);

      const places = desktop.popupPlaces(level.window);
      const index = places.findIndex(
        (place) =>
          y - level.window.top >= place.top && y - level.window.top < place.top + place.height
      );

      if (index >= 0 && !(level.menu.items[index].flags & MF_SEPARATOR)) {
        await select(index);

        if (message === User.WM_LBUTTONUP) {
          await choose(index);
        }
      }

      return;
    }

    /* Over the menu bar. */
    if (barMenu) {
      const index = desktop
        .menuBarItems(window)
        .findIndex((item) => x >= item.left && x < item.right && y >= item.top && y < item.bottom);

      if (index >= 0) {
        if (index !== bar || (message === User.WM_LBUTTONDOWN && !levels.length)) {
          await openBar(index);
        } else if (message === User.WM_LBUTTONDOWN && levels.length) {
          done = true;
        }

        return;
      }
    }

    /* Anywhere else, a press closes the menu. */
    if (message === User.WM_LBUTTONDOWN || message === User.WM_RBUTTONDOWN) {
      done = true;
    }
  }
}

/** A non-client mouse message as the client-area one it stands for here; any other as itself. */
function clientForm(message: number) {
  switch (message) {
    case User.WM_NCMOUSEMOVE:
      return User.WM_MOUSEMOVE;
    case User.WM_NCLBUTTONDOWN:
      return User.WM_LBUTTONDOWN;
    case User.WM_NCLBUTTONUP:
      return User.WM_LBUTTONUP;
    case User.WM_NCRBUTTONDOWN:
      return User.WM_RBUTTONDOWN;
    case User.WM_NCRBUTTONUP:
      return User.WM_RBUTTONUP;
  }

  return message;
}

/** The next item from `from` in a direction that is not a separator, wrapping. */
function firstSelectable(menu: MenuData, from: number, step: number) {
  const count = menu.items.length;

  for (let tried = 1; tried <= count; tried++) {
    const index = (((from + step * tried) % count) + count) % count;

    if (!(menu.items[index].flags & MF_SEPARATOR)) {
      return index;
    }
  }

  return -1;
}

/** The letter after an item's `&`, upper case. */
function mnemonic(text: string | null) {
  const at = (text ?? '').indexOf('&');

  return at >= 0 && at + 1 < (text ?? '').length ? text![at + 1].toUpperCase() : '';
}

/** A message the menu does not take, sent on to its window's procedure. */
async function dispatch(system: any, msg: any) {
  const target = system.handles.resolve(msg.hwnd);

  if (!target) {
    return;
  }

  const windowClass = system.handles.retrieve(target.options.windowClass);

  await system.scheduler.callWndProc(windowClass, msg.hwnd, msg.message, msg.wParam, msg.lParam);
}
