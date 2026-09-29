'use strict';

/**
 * Where a menu bar's items go. **Recorded** by `menuhelp`, a bar of File,
 * Game and a Help whose text starts with a backspace, in windows 300 down to
 * 100 wide:
 *
 * * Each item is its text's width with 8 pixels either side, one after
 *   another from the bar's left.
 * * An item starts a row of its own under the last when, after it, fewer
 *   than 9 pixels of the bar would be left; the bar is a row taller for
 *   each, 19 pixels, and its line is under the last. Game, ending 95 pixels
 *   in, stays on the first row of a window 105 wide and not of one 104.
 * * An item whose text starts with a backspace, and every item after it,
 *   stands at the right of its row instead, the backspace not shown, its
 *   text ending 4 pixels short of the bar's right: Help at the bar's right
 *   end, as Tetris for Windows of the corpus has it.
 */

export const MENU_GAP = 8;

/**
 * How far past the bar's right the last of the right-hand items' space
 * reaches: its text ends 4 pixels in, where there are 8 after the others'.
 */
const RIGHT_MARGIN = 4;

/** A backspace at the start of an item's text: it, and those after it, at the right. */
const RIGHT = '\b';

export interface BarItem {
  /** The text shown, the backspace taken off. */
  text: string;
  left: number;
  right: number;
  row: number;
}

export function barLayout(
  labels: string[],
  measure: (text: string) => number,
  left: number,
  right: number
): { items: BarItem[]; rows: number } {
  const items: BarItem[] = [];
  const flush = labels.findIndex((label) => label.startsWith(RIGHT));
  let x = left;
  let row = 0;

  for (const label of labels) {
    const text = label.startsWith(RIGHT) ? label.slice(1) : label;
    const width = measure(text.replace('&', '')) + 2 * MENU_GAP;

    if (x > left && x + width + MENU_GAP >= right) {
      row++;
      x = left;
    }

    items.push({ text, left: x, right: x + width, row });
    x += width;
  }

  /* The items from the backspace on, to the right of their rows. */
  if (flush >= 0) {
    for (let r = 0; r <= row; r++) {
      const moved = items.filter((item, index) => index >= flush && item.row === r);

      if (moved.length) {
        const by = right + RIGHT_MARGIN - moved[moved.length - 1].right;

        for (const item of moved) {
          item.left += by;
          item.right += by;
        }
      }
    }
  }

  return { items, rows: row + 1 };
}
