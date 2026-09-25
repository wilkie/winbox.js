'use strict';

/**
 * A menu as `CreateMenu` makes it and `AppendMenu` fills it: items in order,
 * each with its flags, its command identifier (or, for a pop-up, the handle of
 * the menu it opens) and its text, `&` and all.
 */
export class MenuData {
  readonly items: { flags: number; id: number; text: string | null }[] = [];

  /** The text of each item a menu bar shows. */
  get labels() {
    return this.items.map((item) => item.text ?? '');
  }
}

export const MF_BITMAP = 0x0004;
export const MF_OWNERDRAW = 0x0100;
