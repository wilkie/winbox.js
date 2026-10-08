'use strict';

import { HELP_MARK, MDI_RESTORE_MARK, MDI_SYSTEM_MARK } from './menu-bar.js';

/**
 * The bitmaps of USER's own that a maximized MDI child's items in the frame's
 * bar show, by the handles they are given: its system menu box, and its
 * restore box (`USER.EXE` seg20 `011a`-`0142`).
 */
export const MDI_SYSTEM_BITMAP = 1;
export const MDI_RESTORE_BITMAP = 2;

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

  /**
   * The text of each item a menu bar shows: one flagged `MF_HELP` marked
   * for the bar's right end, with those after it, as a backspace at the
   * start of its text marks it -- though a little less far (`menuflag`).
   * Flak Attack of the corpus flags its Help so (`menu-bar.ts`).
   */
  get labels() {
    return this.items.map((item) => {
      const text =
        item.bitmap === MDI_SYSTEM_BITMAP
          ? MDI_SYSTEM_MARK
          : item.bitmap === MDI_RESTORE_BITMAP
            ? MDI_RESTORE_MARK
            : (item.text ?? '');

      return item.flags & MF_HELP && !text.startsWith('\b') ? `${HELP_MARK}${text}` : text;
    });
  }

  /** Which items a menu bar shows grayed: `MF_GRAYED` (`EnableMenuItem`). */
  get grayed() {
    return this.items.map((item) => (item.flags & MF_GRAYED) !== 0);
  }

  /**
   * An item, by its position in this menu or by its command identifier in
   * this menu or any it opens, as `MF_BYPOSITION` says; with the menu it is
   * in. By command, USER walks the items from the last to the first, a
   * pop-up's own menu searched where the pop-up is, and its handle never
   * taken for a command; a separator's command is nought, and found; -1 is
   * no command (`USER.EXE` seg10 `009c`; `menuenab`: 101 in a pop-up after
   * one of its own menu is the pop-up's, and nought grays the separator).
   */
  find(key: number, flags: number): { item: MenuItem; menu: MenuData } | null {
    if (flags & MF_BYPOSITION) {
      const item = this.items[key];

      return item ? { item, menu: this } : null;
    }

    if (key === 0xffff) {
      return null;
    }

    for (let at = this.items.length - 1; at >= 0; at--) {
      const item = this.items[at];

      if (item.popup) {
        const found = item.popup.find(key, flags);

        if (found) {
          return found;
        }
      } else if (item.id === key) {
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
  /**
   * The bitmap an `MF_BITMAP` item shows, by its handle: 1 and 2 are USER's
   * own, an MDI document window's system menu box and its restore box.
   */
  bitmap?: number;
}

/**
 * An item's flags as USER keeps them: a separator disabled as well, as
 * `GetMenuState` shows it, until `EnableMenuItem` enables it (`minis`;
 * `menuenab`: `EnableMenuItem` of a separator answers `MF_DISABLED`, and
 * enabling it leaves `MF_SEPARATOR` alone).
 */
export function separated(flags: number) {
  return flags & MF_SEPARATOR ? flags | MF_DISABLED : flags;
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

const MF_HELP = 0x4000;
