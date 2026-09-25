'use strict';

import { FALSE, TRUE } from '../consts.js';

import { MenuData, MF_BITMAP, MF_OWNERDRAW, MF_POPUP, MF_SEPARATOR } from './menu-data.js';

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

  const text =
    fuFlags & (MF_BITMAP | MF_OWNERDRAW | MF_SEPARATOR) ? null : (lpNewItem?.toString() ?? null);

  /* A pop-up item's identifier is the handle of the menu it opens. */
  const popup = fuFlags & MF_POPUP ? this.handles.resolve(idNewItem) : null;

  menu.items.push({
    flags: fuFlags,
    id: popup ? 0 : idNewItem,
    text,
    popup: popup instanceof MenuData ? popup : undefined,
  });

  return TRUE;
}
