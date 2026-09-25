'use strict';

import { FALSE, TRUE } from '../consts.js';

import {
  MenuData,
  MF_BITMAP,
  MF_BYPOSITION,
  MF_OWNERDRAW,
  MF_POPUP,
  MF_SEPARATOR,
} from './menu-data.js';

/**
 * The **AppendMenu** function adds an item to the end of a menu.
 *
 * Only a string item's text is kept; a bitmap's or an owner-drawn item's data
 * is not a string and is not read as one.
 *
 * @param {Types.HMENU} hmenu - The menu.
 * @param {Types.UINT} fuFlags - What the item is: `MF_STRING`, `MF_POPUP` and the rest.
 * @param {Types.UINT} idNewItem - Its command identifier, or a pop-up's menu handle.
 * @param {Types.LPCSTR} lpNewItem - Its text.
 *
 * @returns {Types.BOOL} Whether the item was added.
 */
export function AppendMenu(hmenu, fuFlags, idNewItem, lpNewItem) {
  const menu = this.handles.resolve(hmenu);

  if (!(menu instanceof MenuData)) {
    return FALSE;
  }

  menu.items.push(menuItem(this, fuFlags, idNewItem, lpNewItem));

  return TRUE;
}

/**
 * An item put into a menu before another: the one at a position, with
 * `MF_BYPOSITION`, or the one with a command, in this menu or any it opens.
 * A position of -1, or past the end, is the end; a command no menu has, a
 * failure.
 */
export function InsertMenu(hmenu, idItem, fuFlags, idNewItem, lpNewItem) {
  const menu = this.handles.resolve(hmenu);

  if (!(menu instanceof MenuData)) {
    return FALSE;
  }

  const item = menuItem(this, fuFlags & ~MF_BYPOSITION, idNewItem, lpNewItem);

  if (fuFlags & MF_BYPOSITION) {
    const at =
      (idItem & 0xffff) === 0xffff ? menu.items.length : Math.min(idItem, menu.items.length);

    menu.items.splice(at, 0, item);

    return TRUE;
  }

  const found = menu.find(idItem, 0);

  if (!found) {
    return FALSE;
  }

  found.menu.items.splice(found.menu.items.indexOf(found.item), 0, item);

  return TRUE;
}

/** An item as `AppendMenu` and `InsertMenu` make one. */
function menuItem(system: any, fuFlags: number, idNewItem: number, lpNewItem: any) {
  const text =
    fuFlags & (MF_BITMAP | MF_OWNERDRAW | MF_SEPARATOR) ? null : (lpNewItem?.toString() ?? null);

  /* A pop-up item's identifier is the handle of the menu it opens. */
  const popup = fuFlags & MF_POPUP ? system.handles.resolve(idNewItem) : null;

  return {
    flags: fuFlags,
    id: popup ? 0 : idNewItem,
    text,
    popup: popup instanceof MenuData ? popup : undefined,
  };
}
