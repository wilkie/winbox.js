'use strict';

import { NULL, TRUE } from '../consts.js';

import {
  handleOf,
  MenuData,
  MF_BYPOSITION,
  MF_CHECKED,
  MF_DISABLED,
  MF_GRAYED,
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
  window.desktop.setMenu(window.window, menu instanceof MenuData ? menu.labels : undefined);

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
    window.desktop.setMenu(window.window, menu.labels);
  }
}

/** The **DestroyMenu** function frees a menu. Nothing is kept that needs freeing. */
export function DestroyMenu(hmenu) {
  return menuOf(this, hmenu) ? TRUE : 0;
}

function menuOf(system: any, hmenu: number) {
  const menu = system.handles.resolve(hmenu);

  return menu instanceof MenuData ? menu : null;
}
