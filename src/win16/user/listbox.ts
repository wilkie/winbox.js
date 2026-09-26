'use strict';

import { User } from '../user.js';

import { keyState } from './accelerators.js';
import { type ControlState } from './controls.js';
import { lstrcmpi } from './lstrcmpi.js';

/**
 * The list box: its items and their order, its selection, the keys and the
 * mouse, its scrolling, what it tells its parent, and an owner-drawn one.
 *
 * **Read out of `USER.EXE`** -- the window procedure is seg35 `0100`, with
 * seg38 for making one, seg43 for its items and scroll bar -- and
 * **recorded** by `listbox` on four displays: a sorted list box with a
 * scroll bar, one with many selected, and an owner-drawn one as
 * `COMMDLG.DLL`'s file lists are, driven with messages, keys and clicks.
 */

export const LBS_NOTIFY = 0x0001;
export const LBS_SORT = 0x0002;
export const LBS_MULTIPLESEL = 0x0008;
export const LBS_OWNERDRAWFIXED = 0x0010;
export const LBS_OWNERDRAWVARIABLE = 0x0020;
export const LBS_HASSTRINGS = 0x0040;
export const LBS_NOINTEGRALHEIGHT = 0x0100;
export const LBS_EXTENDEDSEL = 0x0800;
export const LBS_DISABLENOSCROLL = 0x1000;

export const LB = {
  ADDSTRING: 0x401,
  INSERTSTRING: 0x402,
  DELETESTRING: 0x403,
  RESETCONTENT: 0x405,
  SETSEL: 0x406,
  SETCURSEL: 0x407,
  GETSEL: 0x408,
  GETCURSEL: 0x409,
  GETTEXT: 0x40a,
  GETTEXTLEN: 0x40b,
  GETCOUNT: 0x40c,
  SELECTSTRING: 0x40d,
  GETTOPINDEX: 0x40f,
  FINDSTRING: 0x410,
  GETSELCOUNT: 0x411,
  GETSELITEMS: 0x412,
  GETITEMRECT: 0x419,
  GETITEMDATA: 0x41a,
  SETITEMDATA: 0x41b,
  SETTOPINDEX: 0x418,
  SETCARETINDEX: 0x41f,
  GETCARETINDEX: 0x420,
  SETITEMHEIGHT: 0x421,
  GETITEMHEIGHT: 0x422,
  FINDSTRINGEXACT: 0x423,
};

export const LBN_SELCHANGE = 1;
export const LBN_DBLCLK = 2;
export const LBN_SETFOCUS = 4;
export const LBN_KILLFOCUS = 5;

const ODA_DRAWENTIRE = 1;
const ODA_SELECT = 2;
const ODA_FOCUS = 4;
const ODS_SELECTED = 1;
const ODS_FOCUS = 0x10;

const WM_CHAR = 0x0102;
const WM_KEYDOWN = 0x0100;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_LBUTTONDBLCLK = 0x0203;
const WM_VSCROLL = 0x0115;

const VK_SPACE = 0x20;
const VK_PRIOR = 0x21;
const VK_NEXT = 0x22;
const VK_END = 0x23;
const VK_HOME = 0x24;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;

/** What a list box keeps beyond its strings, which are `control.items`. */
export interface ListState {
  data: number[];
  selected: boolean[];
  sel: number;
  caret: number;
  top: number;
  anchor: number;
  /** The height of a row, set at making or by `LB_SETITEMHEIGHT`. */
  height: number;
  focused: boolean;
  /** Whether the focus rectangle is drawn now. */
  focusShown: boolean;
  mouseDown: boolean;
  double: boolean;
}

export function listState(control: ControlState, height = 16): ListState {
  const any = control as any;

  any.list ??= {
    data: [],
    selected: [],
    sel: -1,
    caret: 0,
    top: 0,
    anchor: 0,
    height,
    focused: false,
    focusShown: false,
    mouseDown: false,
    double: false,
  };

  return any.list;
}

/** What a list box asks of the desktop and of its parent. */
export interface ListHost {
  clientWidth(): number;
  clientHeight(): number;
  /** Draws a string item's row: the row cleared or highlighted, and its text; clipped to rows of the client area when given. */
  drawText(index: number, top: number, fill: boolean, rows?: [number, number]): void;
  /** Moves what the client area shows down by `dy` pixels, clearing the rows `from` to `to` it uncovers. */
  scroll(dy: number, from: number, to: number): void;
  /** Inverts the dotted focus rectangle on a row, as `DrawFocusRect` does. */
  focusRect(row: number): void;
  /** Clears the client area in the list box's colour, as its erase does. */
  erase(): void;
  /** `WM_DRAWITEM` to the parent. */
  drawItem(index: number, action: number, state: number, row: number): Promise<void>;
  notify(code: number): Promise<void>;
  /** Shows or hides the vertical scroll bar, and sets its position. */
  scrollBar(shown: boolean, position: number | null): void;
  focus(): Promise<void>;
  capture(on: boolean): void;
  /** Whether the list box shows: one that does not is not drawn. */
  visible(): boolean;
  /** A combo box's list: the selection changed with the keys while dropped (seg35 `1d27`). */
  keyboardChange?(): void;
}

const ownerDraw = (control: ControlState) =>
  (control.style & (LBS_OWNERDRAWFIXED | LBS_OWNERDRAWVARIABLE)) !== 0;
const multiple = (control: ControlState) =>
  (control.style & (LBS_MULTIPLESEL | LBS_EXTENDEDSEL)) !== 0;
const hasStrings = (control: ControlState) =>
  !ownerDraw(control) || (control.style & LBS_HASSTRINGS) !== 0;

/** How many whole rows show, and with a partly shown one counted (seg35 `09d2`). */
function rows(control: ControlState, host: ListHost, partial = false) {
  const list = listState(control);
  const height = host.clientHeight();
  const whole = Math.trunc(height / list.height);

  return partial && height % list.height ? whole + 1 : whole;
}

/** The furthest the top can go: the count less the rows that show. */
function maxTop(control: ControlState, host: ListHost) {
  return Math.max(0, control.items.length - rows(control, host));
}

/**
 * The scroll bar (seg43 `0000`): shown while the list is scrolled or does not
 * fit, and placed at the top over the furthest top, as a percentage rounded
 * as `MulDiv` rounds. The range is never set, so it is the window's 0 to 100.
 */
export function updateScroll(control: ControlState, host: ListHost) {
  const list = listState(control);
  const most = maxTop(control, host);
  const shown = list.top !== 0 || most !== 0;

  host.scrollBar(shown, shown ? (list.top === 0 ? 0 : Math.floor((list.top * 100 + (most >> 1)) / most)) : null);
}

function focusOff(control: ControlState, host: ListHost) {
  const list = listState(control);

  if (list.focusShown) {
    list.focusShown = false;
    return drawFocus(control, host, false);
  }
}

function focusOn(control: ControlState, host: ListHost) {
  const list = listState(control);

  /* Drawn only where it can be: a hidden list has none showing. */
  if (list.focused && !list.focusShown && host.visible()) {
    list.focusShown = true;
    return drawFocus(control, host, true);
  }
}

/**
 * The focus rectangle on the caret's row: inverted over a string list, and
 * asked of the parent for an owner-drawn one (`ODA_FOCUS`).
 */
async function drawFocus(control: ControlState, host: ListHost, on: boolean) {
  const list = listState(control);

  if (!host.visible()) {
    return;
  }
  const row = list.caret - list.top;

  if (row < 0 || row >= rows(control, host, true)) {
    return;
  }

  if (ownerDraw(control)) {
    await host.drawItem(list.caret, ODA_FOCUS, (on ? ODS_FOCUS : 0) | (isSelected(control, list.caret) ? ODS_SELECTED : 0), row);
  } else {
    host.focusRect(row);
  }
}

function isSelected(control: ControlState, index: number) {
  const list = listState(control);

  return multiple(control) ? !!list.selected[index] : list.sel === index && index >= 0;
}

/** One item drawn as its selection is now: `ODA_SELECT` to an owner, or its text. */
async function drawOne(control: ControlState, host: ListHost, index: number) {
  const list = listState(control);

  if (!host.visible()) {
    return;
  }
  const row = index - list.top;

  if (index < 0 || index >= control.items.length || row < 0 || row >= rows(control, host, true)) {
    return;
  }

  if (ownerDraw(control)) {
    await host.drawItem(index, ODA_SELECT, isSelected(control, index) ? ODS_SELECTED : 0, row);
  } else {
    host.drawText(index, list.top, true);
  }
}

/**
 * The whole list box painted (seg35 `0c4e`): cleared in its colour, each row
 * from the top that shows, and the focus rectangle.
 */
export async function paintList(control: ControlState, host: ListHost) {
  const list = listState(control);

  if (!host.visible()) {
    return;
  }


  /* The rows that show, a partly shown one among them. */
  const last = Math.min(list.top + rows(control, host, true) - 1, control.items.length - 1);

  /* The focus rectangle comes back after only if it was showing before
   * (seg35 `0c4e`). */
  const shown = list.focusShown;

  list.focusShown = false;
  host.erase();

  for (let index = list.top; index <= last; index++) {
    if (ownerDraw(control)) {
      await host.drawItem(index, ODA_DRAWENTIRE, isSelected(control, index) ? ODS_SELECTED : 0, index - list.top);
    } else {
      host.drawText(index, list.top, false);
    }
  }

  if (shown) {
    await focusOn(control, host);
  }
}

/** Scrolls so an item shows: to the top if above, to the last row if below (seg35 `0fb4`). */
async function ensureVisible(control: ControlState, host: ListHost, index: number) {
  const list = listState(control);
  const showing = rows(control, host);
  let top = list.top;

  if (index < top) {
    top = index;
  } else if (index > top + showing - 1) {
    top = top - (top + showing - 1) + index;
  }

  if (top !== list.top) {
    await setTop(control, host, top);
  }
}

/**
 * Scrolls to a new top (seg35 `16f9`), as `ScrollWindow` and `UpdateWindow`
 * do it: what shows is moved by whole rows, and only the rows the move
 * uncovers are drawn -- so what was on the rows that stay, a deselected
 * item's highlight left beside its text among it, goes with them.
 * **Recorded** by `combobox`: a list dropped down and moved a row by the
 * keys keeps that highlight.
 */
async function setTop(control: ControlState, host: ListHost, top: number) {
  const list = listState(control);
  const old = list.top;

  list.top = Math.max(0, Math.min(top, maxTop(control, host)));

  if (list.top !== old && host.visible()) {
    const shift = (old - list.top) * list.height;
    const height = host.clientHeight();
    const [from, to] = shift < 0 ? [Math.max(0, height + shift), height] : [0, Math.min(height, shift)];

    host.scroll(shift, from, to);

    const first = list.top + Math.trunc(from / list.height);
    const last = Math.min(list.top + Math.trunc((to - 1) / list.height), control.items.length - 1);

    for (let index = first; index <= last; index++) {
      if (ownerDraw(control)) {
        await host.drawItem(index, ODA_DRAWENTIRE, isSelected(control, index) ? ODS_SELECTED : 0, index - list.top);
      } else {
        host.drawText(index, list.top, false, [from, to]);
      }
    }
  }

  updateScroll(control, host);
}

/** The caret moved, its focus rectangle with it. */
async function setCaret(control: ControlState, host: ListHost, index: number) {
  const list = listState(control);

  if (list.focusShown) {
    await drawFocus(control, host, false);
    list.caret = index;
    await drawFocus(control, host, true);
  } else {
    list.caret = index;
  }
}

/** Where a string goes in a sorted list (seg43 `0658`): bracketed names after all others, the rest by `lstrcmpi`. */
function sortedPlace(system: any, control: ControlState, text: string) {
  const compare = (one: string, other: string) => {
    const a = one.startsWith('[');
    const b = other.startsWith('[');

    return a !== b ? (a ? 1 : -1) : lstrcmpi.call(system, one, other);
  };
  let lo = 0;
  let hi = control.items.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = compare(control.items[mid], text);

    if (c < 0) {
      lo = mid + 1;
    } else if (c > 0) {
      hi = mid - 1;
    } else {
      return mid;
    }
  }

  return lo;
}

/**
 * Finds an item from after `start`, wrapping (seg35 `1dce`): as a prefix, or
 * the whole string exactly, without regard to case. A prefix search that
 * does not itself start with `[` passes over an item's leading `[` or `[-`.
 */
function find(control: ControlState, start: number, text: string, exact: boolean) {
  const count = control.items.length;
  const wanted = text.toUpperCase();

  if (!wanted || !count) {
    return -1;
  }

  for (let step = 1; step <= count; step++) {
    const index = (((start + step) % count) + count) % count;
    let item = String(control.items[index]).toUpperCase();

    if (!exact && !wanted.startsWith('[')) {
      item = item.startsWith('[-') ? item.slice(2) : item.startsWith('[') ? item.slice(1) : item;
    }

    if (exact ? item === wanted : item.startsWith(wanted)) {
      return index;
    }
  }

  return -1;
}

/** Moves the selection to an item as the keys do (seg35 `18a8`), telling the parent. */
async function moveTo(control: ControlState, host: ListHost, index: number, space = false) {
  const list = listState(control);

  await setCaret(control, host, index);
  await focusOff(control, host);

  if (!multiple(control)) {
    const old = list.sel;

    list.sel = index;
    await drawOne(control, host, old);
    await drawOne(control, host, index);
  } else if (space) {
    list.selected[index] = !list.selected[index];
    await drawOne(control, host, index);
  }

  await ensureVisible(control, host, index);
  updateScroll(control, host);
  await focusOn(control, host);
  host.keyboardChange?.();

  if (control.style & LBS_NOTIFY) {
    await host.notify(LBN_SELCHANGE);
  }
}

/** The item under a place, or -1 outside the items (seg35 `0e27`). */
function itemAt(control: ControlState, host: ListHost, x: number, y: number) {
  const list = listState(control);

  if (x < 0 || x >= host.clientWidth() || y < 0) {
    return -1;
  }

  const index = list.top + Math.trunc(y / list.height);

  return index < control.items.length ? index : -1;
}

/** A list box's answer to a message, or `undefined` for one it leaves alone. */
export async function listMessage(
  system: any,
  control: ControlState,
  host: ListHost,
  message: number,
  wParam: number,
  lParam: any
) {
  const list = listState(control);
  const count = control.items.length;
  const signed = (value: number) => ((value & 0xffff) << 16) >> 16;
  const text = () => {
    if (typeof lParam === 'string' || lParam instanceof String) {
      return String(lParam);
    }

    return '';
  };

  switch (message) {
    case LB.ADDSTRING:
    case LB.INSERTSTRING: {
      let index = message === LB.INSERTSTRING ? signed(wParam) : -1;
      const item = hasStrings(control) ? text() : '';

      if (message === LB.ADDSTRING) {
        index = control.style & LBS_SORT && hasStrings(control) ? sortedPlace(system, control, item) : count;
      } else if (index === -1) {
        index = count;
      } else if (index > count) {
        return 0xffff;
      }

      control.items.splice(index, 0, item);
      list.data.splice(index, 0, hasStrings(control) ? 0 : lParam >>> 0);
      list.selected.splice(index, 0, false);
      updateScroll(control, host);

      if (index <= list.top + rows(control, host, true)) {
        (control as any).invalid = true;
      }

      return index;
    }

    case LB.DELETESTRING: {
      const index = signed(wParam);

      if (index < 0 || index >= count) {
        return 0xffff;
      }

      if (count === 1) {
        return listMessage(system, control, host, LB.RESETCONTENT, 0, 0).then(() => 0);
      }

      control.items.splice(index, 1);
      list.data.splice(index, 1);
      list.selected.splice(index, 1);

      if (list.sel === index || list.sel >= control.items.length) {
        list.sel = -1;
      }

      if (list.caret === index) {
        list.caret--;
      }

      list.caret = Math.max(0, Math.min(list.caret, control.items.length - 1));
      (control as any).invalid = true;
      updateScroll(control, host);

      return control.items.length;
    }

    case LB.RESETCONTENT:
      control.items.length = 0;
      list.data.length = 0;
      list.selected.length = 0;
      list.top = list.caret = 0;
      list.sel = -1;
      (control as any).invalid = true;
      host.scrollBar(false, null);
      return 1;

    case LB.GETCOUNT:
      return count;

    case LB.GETTEXT: {
      const index = signed(wParam);

      if (index < 0 || index >= count) {
        return 0xffff;
      }

      return { copy: String(control.items[index]) };
    }

    case LB.GETTEXTLEN: {
      const index = signed(wParam);

      return index < 0 || index >= count ? 0xffff : String(control.items[index]).length;
    }

    case LB.GETITEMDATA: {
      const index = signed(wParam);

      return index < 0 || index >= count ? 0xffffffff : list.data[index] >>> 0;
    }

    case LB.SETITEMDATA: {
      const index = signed(wParam);

      if (index < 0 || index >= count) {
        return 0xffff;
      }

      list.data[index] = lParam >>> 0;
      return 1;
    }

    case LB.SETCURSEL: {
      if (multiple(control)) {
        return 0xffff;
      }

      const index = signed(wParam);
      const old = list.sel;

      await focusOff(control, host);

      if (old >= 0) {
        await ensureVisible(control, host, index);
        list.sel = -1;
        await drawOne(control, host, old);
      }

      if (index >= 0 && index < count) {
        await ensureVisible(control, host, index);
        list.sel = list.caret = index;
        await drawOne(control, host, index);
      } else {
        list.sel = -1;
      }

      await focusOn(control, host);
      return list.sel & 0xffff;
    }

    case LB.GETCURSEL:
      return (multiple(control) ? list.caret : list.sel) & 0xffff;

    case LB.GETTOPINDEX:
      return list.top;

    case LB.GETCARETINDEX:
      return list.caret;

    case LB.SETTOPINDEX:
      await setTop(control, host, signed(wParam));
      return 1;

    case LB.FINDSTRING:
    case LB.FINDSTRINGEXACT:
      return find(control, signed(wParam), text(), message === LB.FINDSTRINGEXACT) & 0xffff;

    case LB.SELECTSTRING: {
      const index = find(control, signed(wParam), text(), false);

      return index < 0 ? 0xffff : listMessage(system, control, host, LB.SETCURSEL, index, 0);
    }

    case LB.GETITEMHEIGHT:
      return list.height;

    case LB.SETITEMHEIGHT:
      if (lParam < 1 || lParam > 255) {
        return 0xffff;
      }

      list.height = lParam & 0xff;
      return 0;

    /* Many selected: invalidated, drawn when it is next painted (seg35 `22c8`). */
    case LB.SETSEL: {
      if (!multiple(control)) {
        return 0xffff;
      }

      const index = signed(lParam);
      const on = !!wParam;

      if (index === -1) {
        list.selected = control.items.map(() => on);
      } else if (index >= 0 && index < count) {
        list.selected[index] = on;

        if (on) {
          list.sel = list.caret = list.anchor = index;
        }
      }

      (control as any).invalid = true;
      return 0;
    }

    case LB.GETSEL: {
      const index = signed(wParam);

      return index < 0 || index >= count ? 0xffff : isSelected(control, index) ? 1 : 0;
    }

    case LB.GETSELCOUNT:
      return multiple(control) ? list.selected.filter(Boolean).length : 0xffff;

    /* A combo box's list shown as having the focus while its combo box has
     * it, and no longer (`USER.EXE` seg33 `115d`, `11b2`, `0c36`): inferred
     * from where the combo box sends them, and **recorded** by `combobox` --
     * a dropped list shows no focus rectangle until the keys move its
     * selection, and then shows it on the new one. */
    case 0x0424:
      list.focused = true;
      return 0;

    case 0x0425:
      await focusOff(control, host);
      list.focused = false;
      return 0;

    case User.WM_SETFOCUS:
      list.focused = true;
      await focusOn(control, host);
      await host.notify(LBN_SETFOCUS);
      return 0;

    case User.WM_KILLFOCUS:
      await focusOff(control, host);
      list.focused = false;
      await host.notify(LBN_KILLFOCUS);
      return 0;

    case WM_KEYDOWN: {
      if (!count) {
        return 0;
      }

      const showing = rows(control, host);
      const page = showing > 1 ? showing - 1 : showing;
      const deltas: Record<number, number> = {
        [VK_UP]: -1,
        [VK_DOWN]: 1,
        [VK_LEFT]: -1,
        [VK_RIGHT]: 1,
        [VK_PRIOR]: -page,
        [VK_NEXT]: page,
        [VK_HOME]: -30000,
        [VK_END]: 30000,
        [VK_SPACE]: 0,
      };

      if (!(wParam in deltas)) {
        return 0;
      }

      let index = Math.max(0, Math.min(count - 1, list.caret + deltas[wParam]));

      if (!multiple(control)) {
        /* The first arrow selects the caret's item. */
        if ((wParam === VK_UP || wParam === VK_DOWN) && !isSelected(control, list.caret)) {
          index = list.caret;
        }

        if (index === list.sel) {
          return 0;
        }
      }

      await moveTo(control, host, index, wParam === VK_SPACE);
      return 0;
    }

    /* A typed character: the next item it begins, after the caret (seg35 `1f6a`). */
    case WM_CHAR: {
      const character = String.fromCharCode(wParam & 0xff);

      if (character === ' ' || !count || !hasStrings(control)) {
        return 0;
      }

      const index = find(control, list.caret, character, false);

      if (index >= 0) {
        await moveTo(control, host, index);
      }

      return 0;
    }

    case WM_LBUTTONDOWN:
    case WM_LBUTTONDBLCLK: {
      await host.focus();

      const x = signed(lParam);
      const y = signed(lParam >>> 16);
      const index = itemAt(control, host, x, y);

      if (index < 0) {
        return 0;
      }

      list.mouseDown = true;
      list.double = message === WM_LBUTTONDBLCLK;
      host.capture(true);
      await focusOff(control, host);

      if (!multiple(control)) {
        const old = list.sel;

        list.sel = index;
        await drawOne(control, host, old);
        await drawOne(control, host, index);
      } else if (!list.double) {
        list.selected[index] = !list.selected[index];
        await drawOne(control, host, index);
      }

      list.caret = index;
      await focusOn(control, host);

      if (list.double) {
        return listMessage(system, control, host, WM_LBUTTONUP, 0, lParam);
      }

      return 0;
    }

    case WM_MOUSEMOVE: {
      if (!list.mouseDown) {
        return 0;
      }

      const index = itemAt(control, host, signed(lParam), signed(lParam >>> 16));

      if (index >= 0 && index !== list.caret) {
        await focusOff(control, host);

        if (!multiple(control)) {
          const old = list.sel;

          list.sel = index;
          await drawOne(control, host, old);
          await drawOne(control, host, index);
        }

        list.caret = index;
        await focusOn(control, host);
      }

      return 0;
    }

    case WM_LBUTTONUP: {
      if (!list.mouseDown) {
        return 0;
      }

      list.mouseDown = false;
      host.capture(false);
      await ensureVisible(control, host, list.caret);

      if (control.style & LBS_NOTIFY) {
        await host.notify(list.double ? LBN_DBLCLK : LBN_SELCHANGE);
      }

      list.double = false;
      return 0;
    }

    /* Scrolling (seg35 `0a33`): a line, a page, the thumb, the ends. */
    case WM_VSCROLL: {
      const showing = rows(control, host);
      const page = showing > 1 ? showing - 1 : showing;
      const code = wParam & 0xffff;
      const position = signed(lParam);

      await focusOff(control, host);

      switch (code) {
        case 0:
          await setTop(control, host, list.top - 1);
          break;
        case 1:
          await setTop(control, host, list.top + 1);
          break;
        case 2:
          await setTop(control, host, list.top - page);
          break;
        case 3:
          await setTop(control, host, list.top + page);
          break;
        case 4:
        case 5:
          await setTop(control, host, Math.floor(((count - page) * position + 50) / 100));
          break;
        case 6:
          await setTop(control, host, 0);
          break;
        case 7:
          await setTop(control, host, count - 1);
          break;
        case 8:
          updateScroll(control, host);
          break;
      }

      await focusOn(control, host);
      return 0;
    }

    case 0x0087:
      return 0x0081;
  }

  return undefined;
}
