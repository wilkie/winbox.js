'use strict';

import { FALSE, TRUE } from '../consts.js';
import { DeleteMenu, RemoveMenu } from './menu-api.js';

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

/**
 * Changes an item where it is, by its command or, with `MF_BYPOSITION`, its
 * place: its flags, its command and its text made anew, as `InsertMenu`
 * makes an item.
 *
 * @returns {Types.BOOL} Whether there was such an item.
 */
export function ModifyMenu(this: any, hmenu, idItem, fuFlags, idNewItem, lpNewItem) {
  const menu = this.handles.resolve(hmenu);

  if (!(menu instanceof MenuData)) {
    return FALSE;
  }

  const item = menuItem(this, fuFlags & ~MF_BYPOSITION, idNewItem, lpNewItem);

  if (fuFlags & MF_BYPOSITION) {
    if (idItem >= menu.items.length) {
      return FALSE;
    }

    menu.items[idItem] = item;

    return TRUE;
  }

  const found = menu.find(idItem, 0);

  if (!found) {
    return FALSE;
  }

  found.menu.items[found.menu.items.indexOf(found.item)] = item;

  return TRUE;
}

const MF_CHANGE = 0x0080;
const MF_APPEND = 0x0100;
const MF_DELETE = 0x0200;
const MF_REMOVE = 0x1000;

/**
 * The menu call of Windows 2, which the others replaced: one of them, as its
 * flags say. **Read out** of `USER.EXE` (seg9 `01a8`) and **recorded** by
 * `minis2`:
 *
 * * No menu is a failure. No text makes the item a separator; a separator
 *   for command nought, changing nothing, is appended.
 * * `MF_REMOVE` removes by place, whatever the flags say: the command given
 *   is taken as a position. `MF_DELETE` deletes, `MF_CHANGE` modifies with
 *   the flags masked by 4C7Fh, and `MF_APPEND` appends; anything else inserts
 *   before `cmd`.
 *
 * @returns {Types.BOOL} What the call it came to answered.
 */
export function ChangeMenu(this: any, hMenu, cmd, lpszNewItem, cmdInsert, flags) {
  let fuFlags = flags & 0xffff;

  if (!hMenu) {
    return FALSE;
  }

  if (fuFlags & MF_SEPARATOR && !cmd && !(fuFlags & MF_CHANGE)) {
    fuFlags |= MF_APPEND;
  }

  if (lpszNewItem === null || lpszNewItem === undefined) {
    fuFlags |= MF_SEPARATOR;
  }

  if (fuFlags & MF_REMOVE) {
    return RemoveMenu.call(this, hMenu, cmd, (fuFlags & ~MF_REMOVE) | MF_BYPOSITION);
  }

  if (fuFlags & MF_DELETE) {
    return DeleteMenu.call(this, hMenu, cmd, fuFlags & ~MF_DELETE);
  }

  if (fuFlags & MF_CHANGE) {
    return ModifyMenu.call(this, hMenu, cmd, fuFlags & 0x4c7f, cmdInsert, lpszNewItem);
  }

  if (fuFlags & MF_APPEND) {
    return AppendMenu.call(this, hMenu, fuFlags & ~MF_APPEND, cmdInsert, lpszNewItem);
  }

  return InsertMenu.call(this, hMenu, cmd, fuFlags, cmdInsert, lpszNewItem);
}
