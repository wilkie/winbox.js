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

/**
 * An item flagged `MF_HELP`, as `MenuData.labels` marks it: at the right
 * too, but ending at the bar's right, 4 pixels short of where a backspace's
 * would (`menuflag`).
 */
export const HELP_MARK = '\x7f';

/**
 * The labels of the bitmap items USER puts in a frame's bar for a maximized
 * MDI child: its system menu box, and its restore box (`mdi.ts`).
 */
export const MDI_SYSTEM_MARK = '\x01';
export const MDI_RESTORE_MARK = '\x02';

/**
 * Whether a label, its mark for the right taken off, is one of USER's bitmaps:
 * as wide as the bitmap, with no space either side (`mdisys`).
 */
export function isBitmap(text: string) {
  return text.startsWith(MDI_SYSTEM_MARK) || text.startsWith(MDI_RESTORE_MARK);
}

/**
 * The width of a bar's bitmap item, by its label: the system menu box, the
 * right half of the display driver's `OBM_CLOSE` and a line after it; the
 * restore box, `OBM_RESTORE` (`mdisys`: 19 and 19 on the VGA). Undefined for
 * any other label.
 */
export function barBitmapWidth(text: string, environment: any) {
  const size = environment.metric(1);

  if (text.startsWith(MDI_SYSTEM_MARK)) {
    const close = environment.oem?.get(32754);

    return close ? (close.width >> 1) + 1 : size + 1;
  }

  if (text.startsWith(MDI_RESTORE_MARK)) {
    return environment.oem?.get(32747)?.width ?? size + 1;
  }

  return undefined;
}

/** The text of an item, its mark for the right taken off. */
export function unmarked(label: string) {
  return label.startsWith(RIGHT) || label.startsWith(HELP_MARK) ? label.slice(1) : label;
}

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
  const flush = labels.findIndex((label) => label.startsWith(RIGHT) || label.startsWith(HELP_MARK));
  const margin = flush >= 0 && labels[flush].startsWith(HELP_MARK) ? 0 : RIGHT_MARGIN;
  let x = left;
  let row = 0;

  for (const label of labels) {
    const text = unmarked(label);
    const width = isBitmap(text) ? measure(text) : measure(text.replace('&', '')) + 2 * MENU_GAP;

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
        const by = right + margin - moved[moved.length - 1].right;

        for (const item of moved) {
          item.left += by;
          item.right += by;
        }
      }
    }
  }

  return { items, rows: row + 1 };
}
