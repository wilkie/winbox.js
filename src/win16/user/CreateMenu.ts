'use strict';

import { MenuData } from './menu-data.js';

/**
 * The **CreateMenu** function creates an empty menu, to be filled with
 * {@link User.AppendMenu AppendMenu} and given to a window by
 * {@link User.CreateWindow CreateWindow} or `SetMenu`.
 *
 * @returns {Types.HMENU} The new menu.
 */
export function CreateMenu() {
  const menu = new MenuData();

  menu.handle = this.handles.allocate(menu);

  return menu.handle;
}

/**
 * The **CreatePopupMenu** function creates an empty pop-up menu, to be filled
 * with {@link User.AppendMenu AppendMenu} and put in a menu or shown with
 * {@link User.TrackPopupMenu TrackPopupMenu}. A menu is a menu: which kind it
 * is shows only in where it goes.
 *
 * @returns {Types.HMENU} The new menu.
 */
export function CreatePopupMenu() {
  return CreateMenu.call(this);
}
