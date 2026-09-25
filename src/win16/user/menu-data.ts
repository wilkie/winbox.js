'use strict';

/**
 * A menu as `CreateMenu` makes it and `AppendMenu` fills it, or `LoadMenu`
 * reads it from a program's resources: items in order, each with its flags,
 * its command identifier and its text, `&` and all, and for a pop-up the menu
 * it opens.
 */
export class MenuData {
  readonly items: MenuItem[] = [];

  /** The handle a program knows the menu by, once it has been given one. */
  handle = 0;

  /** The text of each item a menu bar shows. */
  get labels() {
    return this.items.map((item) => item.text ?? '');
  }

  /**
   * An item, by its position in this menu or by its command identifier in
   * this menu or any it opens, as `MF_BYPOSITION` says; with the menu it is in.
   */
  find(key: number, flags: number): { item: MenuItem; menu: MenuData } | null {
    if (flags & MF_BYPOSITION) {
      const item = this.items[key];

      return item ? { item, menu: this } : null;
    }

    for (const item of this.items) {
      if (item.popup) {
        const found = item.popup.find(key, flags);

        if (found) {
          return found;
        }
      } else if (item.id === key && !(item.flags & MF_SEPARATOR)) {
        return { item, menu: this };
      }
    }

    return null;
  }
}

export interface MenuItem {
  flags: number;
  id: number;
  text: string | null;
  popup?: MenuData;
}

/** The handle of a menu, given one if it has none: a pop-up read from a resource has none yet. */
export function handleOf(system: any, menu: MenuData) {
  if (!menu.handle) {
    menu.handle = system.handles.allocate(menu);
  }

  return menu.handle;
}

export const MF_GRAYED = 0x0001;
export const MF_DISABLED = 0x0002;
export const MF_BITMAP = 0x0004;
export const MF_CHECKED = 0x0008;
export const MF_POPUP = 0x0010;
export const MF_OWNERDRAW = 0x0100;
export const MF_BYPOSITION = 0x0400;
export const MF_SEPARATOR = 0x0800;
