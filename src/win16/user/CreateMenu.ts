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
  return this.handles.allocate(new MenuData());
}
