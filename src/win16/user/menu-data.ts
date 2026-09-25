'use strict';

/**
 * A menu as `CreateMenu` makes it and `AppendMenu` fills it, or `LoadMenu`
 * reads it from a program's resources: items in order, each with its flags,
 * its command identifier and its text, `&` and all, and for a pop-up the menu
 * it opens.
 */
export class MenuData {
  readonly items: { flags: number; id: number; text: string | null; popup?: MenuData }[] = [];

  /** The text of each item a menu bar shows. */
  get labels() {
    return this.items.map((item) => item.text ?? '');
  }
}

export const MF_BITMAP = 0x0004;
export const MF_OWNERDRAW = 0x0100;
