'use strict';

import { FALSE, NULL, TRUE } from '../consts.js';

import {
  handleOf,
  MenuData,
  MF_BYPOSITION,
  MF_CHECKED,
  MF_DISABLED,
  MF_GRAYED,
  MF_SEPARATOR,
} from './menu-data.js';
import { RasterWindow } from './raster-window.js';
import { systemMenuOf } from './menu-loop.js';

/**
 * The calls that read and change a menu: which of its items are checked and
 * grayed, the pop-up at a place in it, a window's menu and its system menu.
 * Each finds an item by its command identifier, looking into the pop-ups a
 * menu opens, or by its position when `MF_BYPOSITION` says so.
 */

/**
 * The **CheckMenuItem** function checks or unchecks a menu item.
 *
 * @returns {Types.INT} Whether it was checked before, `MF_CHECKED` or 0, or -1 for no such item.
 */
export function CheckMenuItem(hmenu, idCheckItem, uCheck) {
  const found = menuOf(this, hmenu)?.find(idCheckItem, uCheck);

  if (!found) {
    return -1;
  }

  const was = found.item.flags & MF_CHECKED;

  found.item.flags = (found.item.flags & ~MF_CHECKED) | (uCheck & MF_CHECKED);

  return was;
}

/**
 * The **EnableMenuItem** function enables, disables or grays a menu item.
 *
 * @returns {Types.BOOL} Its state before, `MF_GRAYED`, `MF_DISABLED` or 0, or -1 for no such item.
 */
export function EnableMenuItem(hmenu, idEnableItem, uEnable) {
  const found = menuOf(this, hmenu)?.find(idEnableItem, uEnable);

  if (!found) {
    return -1;
  }

  const mask = MF_GRAYED | MF_DISABLED;
  const was = found.item.flags & mask;

  found.item.flags = (found.item.flags & ~mask) | (uEnable & mask);

  return was;
}

/**
 * The **GetSubMenu** function returns the pop-up menu an item at a position opens.
 *
 * @returns {Types.HMENU} The pop-up, or `NULL` if the item opens none.
 */
export function GetSubMenu(hmenu, nPos) {
  const popup = menuOf(this, hmenu)?.find(nPos, MF_BYPOSITION)?.item.popup;

  return popup ? handleOf(this, popup) : NULL;
}

/**
 * The **GetSystemMenu** function returns a window's system menu, for a program
 * to change; with `fRevert`, it puts back the standard one.
 *
 * @returns {Types.HMENU} The system menu, or `NULL` when reverting.
 */
export function GetSystemMenu(hwnd, fRevert) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return NULL;
  }

  if (fRevert) {
    window.window.systemMenu = null;
    return NULL;
  }

  return handleOf(this, systemMenuOf(window.window));
}

/**
 * The **SetMenu** function gives a window a menu bar, or takes it away, and
 * draws it.
 */
export function SetMenu(hwnd, hmenu) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return TRUE;
  }

  const menu = hmenu ? this.handles.resolve(hmenu) : null;

  window.options.menu = menu instanceof MenuData ? hmenu : 0;
  window.desktop.setMenu(
    window.window,
    menu instanceof MenuData ? menu.labels : undefined,
    menu instanceof MenuData ? menu.grayed : undefined
  );

  return TRUE;
}

/** The **DrawMenuBar** function draws a window's menu bar again, after its menu changed. */
export function DrawMenuBar(hwnd) {
  const window = this.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow) || !window.options.menu) {
    return;
  }

  const menu = this.handles.resolve(window.options.menu);

  if (menu instanceof MenuData) {
    window.desktop.setMenu(window.window, menu.labels, menu.grayed);
  }
}

/** The **DestroyMenu** function frees a menu's handle. */
export function DestroyMenu(hmenu) {
  if (!menuOf(this, hmenu)) {
    return 0;
  }

  /* Its handle is no menu's after (`queries`: `IsMenu` of it is nought).
   * Its pop-ups are documented as destroyed with it, which is not recorded,
   * and are left. */
  this.handles.free(hmenu);

  return TRUE;
}

export function menuOf(system: any, hmenu: number) {
  const menu = system.handles.resolve(hmenu);

  return menu instanceof MenuData ? menu : null;
}

/**
 * How many items a menu has, or -1 for no menu. **Recorded** by `minis`, as
 * are the calls below: a menu of a command, a separator, a pop-up of two and
 * a command, asked about and taken apart.
 *
 * @param {Types.HMENU} hmenu - The menu.
 *
 * @returns {Types.INT} The count.
 */
export function GetMenuItemCount(hmenu) {
  const menu = this.handles.resolve(hmenu);

  return menu instanceof MenuData ? menu.items.length : -1;
}

/**
 * The command identifier of the item at a position: 0 for a separator, and
 * -1 for a pop-up or a position past the end.
 *
 * @param {Types.HMENU} hmenu - The menu.
 * @param {Types.INT} nPos - The position.
 *
 * @returns {Types.UINT} The identifier.
 */
export function GetMenuItemID(hmenu, nPos) {
  const menu = this.handles.resolve(hmenu);
  const item = menu instanceof MenuData ? menu.items[nPos & 0xffff] : undefined;

  return !item || item.popup ? 0xffff : item.flags & MF_SEPARATOR ? 0 : item.id & 0xffff;
}

/**
 * An item's flags: a separator's with `MF_DISABLED` as well; a pop-up's low
 * byte with the count of its items in the high byte; -1 for no such item.
 *
 * @param {Types.HMENU} hmenu - The menu.
 * @param {Types.UINT} idItem - The command, or position with `MF_BYPOSITION`.
 * @param {Types.UINT} fuFlags - `MF_BYCOMMAND` or `MF_BYPOSITION`.
 *
 * @returns {Types.UINT} The state.
 */
export function GetMenuState(hmenu, idItem, fuFlags) {
  const menu = this.handles.resolve(hmenu);
  const found = menu instanceof MenuData ? menu.find(idItem & 0xffff, fuFlags) : null;

  if (!found) {
    return 0xffff;
  }

  const { item } = found;

  if (item.popup) {
    return ((item.popup.items.length << 8) | (item.flags & 0xff)) & 0xffff;
  }

  return (item.flags & MF_SEPARATOR ? item.flags | MF_DISABLED : item.flags) & 0xffff;
}

/**
 * An item's text, `&` and all, into a buffer of `nMaxCount` bytes, cut to
 * fit with its NUL; answers the count copied. The buffer is emptied first,
 * so a separator or an item there is not leaves it empty and answers 0.
 *
 * @param {Types.HMENU} hmenu - The menu.
 * @param {Types.UINT} idItem - The command, or position with `MF_BYPOSITION`.
 * @param {Types.FARPTR} lpsz - The buffer.
 * @param {Types.INT} nMaxCount - Its size.
 * @param {Types.UINT} fuFlags - `MF_BYCOMMAND` or `MF_BYPOSITION`.
 *
 * @returns {Types.INT} The count copied.
 */
export function GetMenuString(hmenu, idItem, lpsz, nMaxCount, fuFlags) {
  const menu = this.handles.resolve(hmenu);
  const size = (nMaxCount << 16) >> 16;

  if (!lpsz || size <= 0) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lpsz >>> 16) & 0xffff;
  const offset = lpsz & 0xffff;
  const found = menu instanceof MenuData ? menu.find(idItem & 0xffff, fuFlags) : null;
  const text = found?.item.text ?? '';
  const count = Math.min(text.length, size - 1);

  for (let at = 0; at < count; at++) {
    core.write8(segment, (offset + at) & 0xffff, text.charCodeAt(at) & 0xff);
  }

  core.write8(segment, (offset + count) & 0xffff, 0);

  return count;
}

/** Takes an item out of its menu; a pop-up's menu is destroyed with it, or kept. */
function takeOut(system: any, hmenu: number, idItem: number, fuFlags: number, destroy: boolean) {
  const menu = system.handles.resolve(hmenu);
  const found = menu instanceof MenuData ? menu.find(idItem & 0xffff, fuFlags) : null;

  if (!found) {
    return FALSE;
  }

  found.menu.items.splice(found.menu.items.indexOf(found.item), 1);

  if (destroy && found.item.popup?.handle) {
    system.handles.free(found.item.popup.handle);
  }

  return TRUE;
}

/**
 * Takes an item out of a menu, by command in the menu or any it opens, or by
 * position; a pop-up's menu is kept, to be used again.
 *
 * @param {Types.HMENU} hmenu - The menu.
 * @param {Types.UINT} idItem - The command, or position with `MF_BYPOSITION`.
 * @param {Types.UINT} fuFlags - `MF_BYCOMMAND` or `MF_BYPOSITION`.
 *
 * @returns {Types.BOOL} Whether there was such an item.
 */
export function RemoveMenu(hmenu, idItem, fuFlags) {
  return takeOut(this, hmenu, idItem, fuFlags, false);
}

/**
 * As `RemoveMenu`, and a pop-up's menu is destroyed: its handle names no
 * menu after.
 *
 * @param {Types.HMENU} hmenu - The menu.
 * @param {Types.UINT} idItem - The command, or position with `MF_BYPOSITION`.
 * @param {Types.UINT} fuFlags - `MF_BYCOMMAND` or `MF_BYPOSITION`.
 *
 * @returns {Types.BOOL} Whether there was such an item.
 */
export function DeleteMenu(hmenu, idItem, fuFlags) {
  return takeOut(this, hmenu, idItem, fuFlags, true);
}
