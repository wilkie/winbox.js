'use strict';

import { type ControlState } from './controls.js';

/**
 * The combo box: a field -- an edit control, or for a drop-down list its own
 * selection field -- a button, and a list box of the class `ComboLBox`,
 * always showing under a simple one's field and dropped down from the
 * others'.
 *
 * **Read out of `USER.EXE`** -- the window procedure is seg33 `0000`, with
 * seg34 for its layout -- and **recorded** by `combobox` on four displays: a
 * drop-down list, a drop-down, a simple one and an owner-drawn drop-down
 * list, filled, selected, keyed, dropped down and put away.
 */

export const CBS_SIMPLE = 1;
export const CBS_DROPDOWN = 2;
export const CBS_DROPDOWNLIST = 3;
export const CBS_OWNERDRAWFIXED = 0x10;
export const CBS_OWNERDRAWVARIABLE = 0x20;
export const CBS_AUTOHSCROLL = 0x40;
export const CBS_SORT = 0x100;
export const CBS_HASSTRINGS = 0x200;
export const CBS_NOINTEGRALHEIGHT = 0x400;
export const CBS_DISABLENOSCROLL = 0x800;

export const CB = {
  GETEDITSEL: 0x400,
  LIMITTEXT: 0x401,
  SETEDITSEL: 0x402,
  ADDSTRING: 0x403,
  DELETESTRING: 0x404,
  DIR: 0x405,
  GETCOUNT: 0x406,
  GETCURSEL: 0x407,
  GETLBTEXT: 0x408,
  GETLBTEXTLEN: 0x409,
  INSERTSTRING: 0x40a,
  RESETCONTENT: 0x40b,
  FINDSTRING: 0x40c,
  SELECTSTRING: 0x40d,
  SETCURSEL: 0x40e,
  SHOWDROPDOWN: 0x40f,
  GETITEMDATA: 0x410,
  SETITEMDATA: 0x411,
  GETDROPPEDCONTROLRECT: 0x412,
  SETITEMHEIGHT: 0x413,
  GETITEMHEIGHT: 0x414,
  SETEXTENDEDUI: 0x415,
  GETEXTENDEDUI: 0x416,
  GETDROPPEDSTATE: 0x417,
  FINDSTRINGEXACT: 0x418,
};

export const CBN_SELCHANGE = 1;
export const CBN_DBLCLK = 2;
export const CBN_SETFOCUS = 3;
export const CBN_KILLFOCUS = 4;
export const CBN_EDITCHANGE = 5;
export const CBN_EDITUPDATE = 6;
export const CBN_DROPDOWN = 7;
export const CBN_CLOSEUP = 8;

/** The list box messages the combo box passes on as they are (seg33 `0029`). */
export const PASSED_TO_LIST: Record<number, number> = {
  [CB.ADDSTRING]: 0x401,
  [CB.DELETESTRING]: 0x403,
  [CB.GETCOUNT]: 0x40c,
  [CB.GETCURSEL]: 0x409,
  [CB.GETLBTEXT]: 0x40a,
  [CB.GETLBTEXTLEN]: 0x40b,
  [CB.INSERTSTRING]: 0x402,
  [CB.FINDSTRING]: 0x410,
  [CB.FINDSTRINGEXACT]: 0x423,
  [CB.GETITEMDATA]: 0x41a,
  [CB.SETITEMDATA]: 0x41b,
};

/** What a combo box keeps. */
export interface ComboState {
  type: number;
  ownerDraw: boolean;
  fieldHeight: number;
  field: [number, number, number, number];
  button: [number, number, number, number] | null;
  list: [number, number, number, number];
  edit: number;
  listBox: number;
  focused: boolean;
  dropped: boolean;
  tracking: boolean;
  pressed: boolean;
  /** A selection changed with the keys while dropped, which does not put the list away. */
  keyboard: boolean;
  /** The size it was made at, to which a dropped list's height belongs. */
  height: number;
}

export function comboState(control: ControlState): ComboState {
  return (control as any).combo;
}

/**
 * Where a combo box's parts go (seg34 `02ac`): the field one font height
 * high, plus a quarter of the smaller of it and the System font's height,
 * plus four borders -- 24 on the VGA, 19 on the EGA -- or for an owner-drawn
 * one what the parent answers plus six; the button at the right, a scroll
 * bar's width; the field short of the button by a border less, and a
 * drop-down's by the System font's average width more; the list from a
 * border above the field's bottom to a border above the combo box's, a
 * drop-down list's under all of it, the others' that average width in.
 */
export function layout(
  type: number,
  width: number,
  height: number,
  fieldHeight: number,
  metrics: { cxVScroll: number; cxSysChar: number; border: number }
) {
  const { cxVScroll, cxSysChar, border } = metrics;
  const button: [number, number, number, number] | null =
    type === CBS_SIMPLE ? null : [width - cxVScroll, 0, width, fieldHeight];
  const fieldWidth =
    type === CBS_DROPDOWNLIST
      ? width - cxVScroll + border
      : type === CBS_DROPDOWN
        ? width - cxVScroll + border - cxSysChar
        : width;
  const left = type === CBS_DROPDOWNLIST ? 0 : cxSysChar;

  return {
    button,
    field: [0, 0, fieldWidth, fieldHeight] as [number, number, number, number],
    list: [left, fieldHeight - border, width, height - border] as [number, number, number, number],
  };
}

/** The list box style a combo box makes its list with (seg34 `005b`). */
export function listStyle(style: number) {
  let list = 0x40000000 | 0x10000000 | 0x04000000 | 0x00800000 | 0x8000 | 0x0001;

  if (style & CBS_SORT) list |= 0x0002;
  if (style & CBS_HASSTRINGS) list |= 0x0040;
  if (style & CBS_OWNERDRAWFIXED) list |= 0x0010;
  if (style & CBS_OWNERDRAWVARIABLE) list |= 0x0020;
  if (style & CBS_NOINTEGRALHEIGHT) list |= 0x0100;
  if (style & CBS_DISABLENOSCROLL) list |= 0x1000;
  if (style & 0x00200000) list |= 0x00200000;

  return list >>> 0;
}

/** The edit control's style (seg34 `005b`). */
export function editStyle(style: number) {
  let edit = 0x40000000 | 0x10000000 | 0x00800000 | 0x0300;

  if (style & CBS_AUTOHSCROLL) edit |= 0x0080;
  if (style & 0x0080) edit |= 0x0400;

  return edit >>> 0;
}

export const LIST_ID = 1000;
export const EDIT_ID = 1001;
