'use strict';

import { adoptHandle, textHandle } from './edit-buffer.js';
import { User } from '../user.js';

import { keyState } from './accelerators.js';
import { CreateCaret, DestroyCaret, HideCaret, SetCaretPos, ShowCaret } from './caret.js';
import { type ControlState } from './controls.js';
import {
  EM_GETRECT,
  EM_UNDO,
  EN_CHANGE,
  EN_KILLFOCUS,
  EN_SETFOCUS,
  EN_UPDATE,
  WM_UNDO,
  editState,
  selection,
  wordAround,
  writeRect,
} from './edit.js';
import { emptyUndo, forgetBeforeInsert, noteDelete, noteInsert, takeUndo } from './edit-undo.js';
import { GetDlgItem } from './GetDlgItem.js';
import { PostMessage } from './PostMessage.js';
import { SendMessage } from './SendMessage.js';

/**
 * The multi-line edit control, Notepad's: its lines, how it breaks them,
 * the keys between them, its scrolling and what it answers about its lines.
 *
 * **Read out of `USER.EXE`**, segment 30 and what it calls, and **recorded**
 * by `mledit` on four displays: a borderless control with both scroll bars,
 * Notepad's kind, and a bordered one that wraps its words, typed at, keyed,
 * scrolled, selected and clicked.
 */

export const EN_HSCROLL = 0x0601;
export const EN_VSCROLL = 0x0602;

export const EM_GETLINECOUNT = 0x040a;
export const EM_LINEINDEX = 0x040b;
export const EM_LINELENGTH = 0x0411;
export const EM_REPLACESEL = 0x0412;
export const EM_GETLINE = 0x0414;
export const EM_LINESCROLL = 0x0406;
export const EM_LINEFROMCHAR = 0x0419;
export const EM_GETFIRSTVISIBLELINE = 0x041e;
const EM_GETSEL = 0x0400;
const EM_SETSEL = 0x0401;
const EM_SCROLL = 0x0405;
const EM_LIMITTEXT = 0x0415;
const EM_SETHANDLE = 0x040c;
const EM_GETHANDLE = 0x040d;

const WM_CHAR = 0x0102;
const WM_KEYDOWN = 0x0100;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSCHAR = 0x0106;
const WM_CLOSE = 0x0010;
const WM_NEXTDLGCTL = 0x0028;
const DM_GETDEFID = 0x0400;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_LBUTTONDBLCLK = 0x0203;
const WM_HSCROLL = 0x0114;
const WM_VSCROLL = 0x0115;

const ES_AUTOVSCROLL = 0x0040;
const ES_AUTOHSCROLL = 0x0080;
const ES_NOHIDESEL = 0x0100;
const ES_WANTRETURN = 0x1000;
const WS_HSCROLL = 0x00100000;
const WS_VSCROLL = 0x00200000;

const VK_BACK = 0x08;
const VK_TAB = 0x09;
const VK_RETURN = 0x0d;
const VK_ESCAPE = 0x1b;
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_PRIOR = 0x21;
const VK_NEXT = 0x22;
const VK_END = 0x23;
const VK_HOME = 0x24;
const VK_LEFT = 0x25;
const VK_UP = 0x26;
const VK_RIGHT = 0x27;
const VK_DOWN = 0x28;
const VK_DELETE = 0x2e;

const MK_SHIFT = 0x0004;

/** Where the caret is parked while it cannot be seen. */
const HIDDEN = -20000;

/** What the multi-line control keeps beyond the single-line one's. */
export interface LinesState {
  /** Where each line starts. */
  starts: number[];
  first: number;
  caretLine: number;
  /** How far the text is scrolled across, in pixels. */
  offset: number;
  /** The widest line built since the last full build. */
  widest: number;
  /** The scroll bars' positions, as last set. */
  v: number;
  h: number;
}

/** What the multi-line control needs of its window and font. */
export interface LinesLayout {
  /** The client area's size. */
  width: number;
  height: number;
  border: boolean;
  average: number;
  height1: number;
  systemAverage: number;
  systemHeight: number;
  /** A character's width, from `GetCharWidth`. */
  charWidth(code: number): number;
}

export interface LinesHost {
  layout(): LinesLayout;
  notify(code: number): Promise<void>;
  repaint(): void;
  focus(): Promise<void>;
  capture(on: boolean): void;
}

export function linesState(control: ControlState): LinesState {
  const any = control as any;

  any.lines ??= { starts: [0], first: 0, caretLine: 0, offset: 0, widest: 0, v: 0, h: 0 };

  return any.lines;
}

/**
 * The text's rectangle (seg30 `1ff9`): the client area, less half the System
 * font's average width across and a quarter of its height down with a
 * border, cut to a whole number of lines. It is unusable narrower than an
 * average character or shorter than a line.
 */
export function formatRect(layout: LinesLayout) {
  const across = layout.border ? Math.trunc(layout.systemAverage / 2) : 0;
  const down = layout.border ? Math.trunc(layout.systemHeight / 4) : 0;
  const left = across;
  const top = down;
  const right = layout.width - across;
  const bottom = layout.height - down;
  const visible = Math.max(0, Math.trunc((bottom - top) / layout.height1));

  return {
    left,
    top,
    right,
    bottom: top + visible * layout.height1,
    visible,
    valid: right - left >= layout.average && visible > 0,
    /* The clip: the client area less the margins the single-line control
     * keeps, the smaller average and height of the two fonts. */
    clip: {
      left: layout.border ? Math.trunc(Math.min(layout.average, layout.systemAverage) / 2) : 0,
      top: layout.border ? Math.trunc(Math.min(layout.height1, layout.systemHeight) / 4) : 0,
    },
  };
}

function blank(character: string | undefined) {
  return character === ' ' || character === '\t';
}

/** Whether the control wraps its words: when it scrolls neither way across. */
function wraps(control: ControlState) {
  return !(control.style & (ES_AUTOHSCROLL | WS_HSCROLL));
}

function autoV(control: ControlState) {
  return (control.style & (ES_AUTOVSCROLL | WS_VSCROLL)) !== 0;
}

function autoH(control: ControlState) {
  return (control.style & (ES_AUTOHSCROLL | WS_HSCROLL)) !== 0;
}

function widthOf(layout: LinesLayout, text: string) {
  let width = 0;

  for (let at = 0; at < text.length; at++) {
    width += layout.charWidth(text.charCodeAt(at));
  }

  return width;
}

/** How many of `text`'s first characters fit in `limit` (seg26 `025c`). */
function fitIn(layout: LinesLayout, text: string, limit: number) {
  let width = 0;
  let count = 0;

  while (count < text.length) {
    width += layout.charWidth(text.charCodeAt(count));

    if (width > limit) {
      break;
    }

    count++;
  }

  return count;
}

/** Where a line's own characters end: before its CR LF, or CR CR LF. */
function hardEnd(text: string, from: number) {
  for (let at = from; at < text.length; at++) {
    if (text[at] === '\r' && (text[at + 1] === '\n' || (text[at + 1] === '\r' && text[at + 2] === '\n'))) {
      return at;
    }
  }

  return text.length;
}

/** A line's length, less the break that ends it (seg30 `01d8`). */
export function lineLength(control: ControlState, line: number) {
  const state = linesState(control);
  const text = control.text;
  const start = state.starts[line] ?? text.length;
  const next = line + 1 < state.starts.length ? state.starts[line + 1] : text.length;
  let end = next;

  if (end - start >= 2 && text[end - 2] === '\r' && text[end - 1] === '\n') {
    end -= 2;

    if (end > start && text[end - 1] === '\r') {
      end -= 1;
    }
  }

  return end - start;
}

/**
 * Builds the lines again from `from` on (seg30 `0b63`). Each line runs to
 * its break -- CR LF, or CR CR LF -- or, wrapping, to as many characters as
 * fit, taken back to the start of the word that would not fit unless that
 * word is the whole line, and on over one space after it. Typing stops as
 * soon as a line starts where one did before, less what was typed.
 */
export function buildLines(control: ControlState, layout: LinesLayout, from: number, delta: number, typing: boolean) {
  const state = linesState(control);
  const text = control.text;
  const rect = formatRect(layout);
  const width = rect.right - rect.left;
  const full = from === 0 && delta === 0 && !typing;
  const later = state.starts.slice(from + 1).map((start) => start + delta);
  const starts = state.starts.slice(0, from + 1);

  if (full) {
    state.widest = 0;
  }

  let start = starts[from] ?? 0;

  for (;;) {
    const end = hardEnd(text, start);
    let at: number;

    if (!wraps(control)) {
      at = start + Math.min(end - start, 0x400);
    } else {
      const fits = Math.max(1, fitIn(layout, text.slice(start, end), width));

      at = Math.min(start + fits, end);

      if (at !== end && !blank(text[at]) && !blank(text[at - 1])) {
        let word = at;

        while (word > start && !blank(text[word - 1])) {
          word--;
        }

        if (word > start) {
          at = word;
        }
      }
    }

    state.widest = Math.max(state.widest, widthOf(layout, text.slice(start, Math.min(at, end))));

    if (!blank(text[at - 1]) && blank(text[at])) {
      at++;
    }

    if (text[at] === '\r') {
      at += 2;

      if (text[at] === '\n') {
        at += 1;
      }
    }

    if (at >= text.length) {
      if (text.length && text[text.length - 1] === '\n' && at === text.length) {
        starts.push(at);
      }

      break;
    }

    if (typing) {
      const match = later.indexOf(at);

      if (match >= 0) {
        starts.push(...later.slice(match));
        break;
      }
    }

    starts.push(at);
    start = at;
  }

  state.starts = starts.length ? starts : [0];
  state.caretLine = Math.min(state.caretLine, state.starts.length - 1);
}

/** The line a character is on: the last to start at or before it (seg30 `0243`). */
export function lineOf(control: ControlState, index: number) {
  const starts = linesState(control).starts;
  let line = 0;

  while (line + 1 < starts.length && starts[line + 1] <= index) {
    line++;
  }

  return line;
}

/**
 * The caret's line after an insert or a delete (seg30 `0604`): its line,
 * except at a line start not just after a CR LF, where the caret stays at
 * the end of the line before. **Read out**, and **recorded**: without it,
 * typing a long word in the wrapping control scrolls a keystroke early.
 */
function caretLineOf(control: ControlState, index: number) {
  const line = lineOf(control, index);
  const starts = linesState(control).starts;

  if (line !== 0 && starts[line] === index && control.text.slice(index - 2, index) !== '\r\n') {
    return line - 1;
  }

  return line;
}

/** A step left or right, over a line break whole (seg30 `00be`). */
function step(text: string, at: number, forward: boolean) {
  if (forward) {
    if (text.startsWith('\r\r\n', at)) return at + 3;
    if (text.startsWith('\r\n', at)) return at + 2;
    return Math.min(text.length, at + 1);
  }

  if (at >= 3 && text.slice(at - 3, at) === '\r\r\n') return at - 3;
  if (at >= 2 && text.slice(at - 2, at) === '\r\n') return at - 2;
  return Math.max(0, at - 1);
}

/** Where the caret shows, or nowhere (seg30 `0134`). */
function caretPlace(control: ControlState, layout: LinesLayout) {
  const state = linesState(control);
  const edit = editState(control);
  const rect = formatRect(layout);
  const line = state.caretLine;

  if (!rect.valid || line < state.first || line >= state.first + rect.visible) {
    return null;
  }

  const start = state.starts[line] ?? 0;
  const x = rect.left + widthOf(layout, control.text.slice(start, edit.caret)) - state.offset;
  const y = (line - state.first) * layout.height1 + rect.top;

  if (wraps(control) ? y > rect.bottom - layout.height1 : x > rect.right || y > rect.bottom) {
    return null;
  }

  return { x: Math.min(x, rect.right - 2), y };
}

function placeCaret(system: any, control: ControlState, layout: LinesLayout) {
  if (!editState(control).focused) {
    return;
  }

  const place = caretPlace(control, layout);

  SetCaretPos.call(system, place?.x ?? HIDDEN, place?.y ?? HIDDEN);
}

/** The scroll bars' positions (seg30 `1bbd`), rounded as `MulDiv` does. */
function positions(control: ControlState, layout: LinesLayout) {
  const state = linesState(control);
  const count = state.starts.length;
  const mulDiv = (a: number, b: number, c: number) => Math.floor((a * b + (c >> 1)) / c);

  return {
    v: count < 2 ? 0 : mulDiv(state.first, 100, count - 1),
    h: 2 * layout.average > state.widest ? 0 : mulDiv(state.offset, 100, state.widest),
  };
}

/**
 * Scrolls by `lines` down or `characters` across (seg30 `1bfe`), telling the
 * parent whether or not anything moved, and the scroll bars.
 */
async function scroll(
  system: any,
  control: ControlState,
  host: LinesHost,
  vertical: boolean,
  amount: number,
  notify = true
) {
  const state = linesState(control);
  const layout = host.layout();

  if (vertical) {
    state.first = Math.max(0, Math.min(state.starts.length - 1, state.first + amount));
  } else {
    state.offset = Math.max(0, Math.min(state.widest, state.offset + amount * layout.average));
  }

  await setPositions(system, control, layout);

  if (notify) {
    await host.notify(vertical ? EN_VSCROLL : EN_HSCROLL);
  }

  host.repaint();
}

async function setPositions(system: any, control: ControlState, layout: LinesLayout) {
  const state = linesState(control);
  const { v, h } = positions(control, layout);
  const { SetScrollPos } = await import('./scroll-bars.js');

  if (v !== state.v) {
    state.v = v;
    SetScrollPos.call(system, control.hwnd, 1, v, 1);
  }

  if (h !== state.h) {
    state.h = h;
    SetScrollPos.call(system, control.hwnd, 0, h, 1);
  }
}

/**
 * Brings the caret into view (seg30 `1e9b`): down or up so its line is the
 * last or the first that shows; across, when the text is wider than its
 * rectangle, by whole average characters to a third of the width in.
 */
async function scrollToCaret(system: any, control: ControlState, host: LinesHost) {
  const state = linesState(control);
  const edit = editState(control);
  const layout = host.layout();
  const rect = formatRect(layout);

  if (autoV(control)) {
    if (state.caretLine > state.first + rect.visible - 1) {
      await scroll(system, control, host, true, state.caretLine - (state.first + rect.visible - 1));
    } else if (state.caretLine < state.first) {
      await scroll(system, control, host, true, state.caretLine - state.first);
    }
  }

  if (autoH(control) && rect.right - rect.left < state.widest) {
    const start = state.starts[state.caretLine] ?? 0;
    const x = rect.left + widthOf(layout, control.text.slice(start, edit.caret)) - state.offset;
    let characters = 0;

    if (x > rect.right) {
      characters = Math.trunc((Math.trunc((rect.right - rect.left) / 3) - rect.right + x) / layout.average);
    } else if (x < 0) {
      characters = Math.trunc((Math.trunc((rect.left - rect.right) / 3) + x) / layout.average);
    }

    if (characters) {
      await scroll(system, control, host, false, characters);
    }
  }

  await setPositions(system, control, layout);
  placeCaret(system, control, layout);
}

/**
 * The character a place in the client area falls at (seg30 `0366`): the
 * line from the height, then across it.
 */
function indexAt(control: ControlState, layout: LinesLayout, x: number, y: number) {
  const state = linesState(control);
  const rect = formatRect(layout);
  let line: number;

  if (y <= rect.top) {
    line = Math.max(0, state.first - 1);
  } else if (y >= rect.bottom) {
    line = state.first + rect.visible;
  } else {
    line = state.first + Math.trunc((y - rect.top) / layout.height1);
  }

  line = Math.min(line, state.starts.length - 1);

  const start = state.starts[line];
  const length = lineLength(control, line);
  const text = control.text.slice(start, start + length);
  const half = Math.trunc(layout.average / 2);
  let within: number;

  if (x >= rect.right) {
    within = Math.min(fitIn(layout, text, state.offset - rect.left + rect.right) + 1, length);
  } else if (x <= rect.left + half) {
    within = Math.max(0, fitIn(layout, text, state.offset) - 1);
  } else {
    /* A binary search, as the code runs it (seg30 `0467`-`04e4`): the result
     * is the last character count it tried, one more if that count's width
     * fell short of the place. */
    const target = x + state.offset;
    let lo = 0;
    let hi = length + 1;
    let mid = 0;
    let width = 0;

    while (hi - 1 > lo) {
      mid = lo + Math.max(1, (hi - lo) >>> 1);
      width = widthOf(layout, text.slice(0, mid)) + half + rect.left;

      if (width > target) {
        hi = mid;
      } else {
        lo = mid;
      }
    }

    if (width - target < target - width) {
      mid++;
    }

    within = Math.min(mid, length);
  }

  return { line, index: start + within };
}

/** Takes out the selection, or what `from` to the caret is (seg30 `0943`). */
async function remove(system: any, control: ControlState, host: LinesHost, from: number, to: number) {
  const edit = editState(control);
  const state = linesState(control);
  const layout = host.layout();
  const startLine = lineOf(control, from);

  noteDelete(edit, control.text, from, to);
  control.text = control.text.slice(0, from) + control.text.slice(to);
  edit.anchor = edit.caret = from;

  if (to > from) {
    edit.modified = true;
  }
  buildLines(control, layout, Math.max(startLine - 1, 0), from - to, false);
  state.caretLine = caretLineOf(control, from);
  keepText(system, control, to > from);
  await host.notify(EN_UPDATE);
  host.repaint();
  await scrollToCaret(system, control, host);
  await host.notify(EN_CHANGE);
}

/** Puts `text` at the caret (seg30 `0641`). */
async function insert(system: any, control: ControlState, host: LinesHost, text: string, typing: boolean) {
  const edit = editState(control);
  const state = linesState(control);
  const layout = host.layout();
  const at = edit.caret;

  if (control.text.length + text.length > edit.limit) {
    return false;
  }

  if (!autoV(control)) {
    forgetBeforeInsert(edit);
  }

  noteInsert(edit, at, text.length);
  control.text = control.text.slice(0, at) + text + control.text.slice(at);
  edit.anchor = edit.caret = at + text.length;

  if (text.length) {
    edit.modified = true;
  }
  buildLines(control, layout, state.caretLine, text.length, typing);
  state.caretLine = caretLineOf(control, edit.caret);
  keepText(system, control, text.length > 0);
  await host.notify(EN_UPDATE);
  host.repaint();
  await scrollToCaret(system, control, host);
  await host.notify(EN_CHANGE);

  return true;
}

async function deleteSelection(system: any, control: ControlState, host: LinesHost) {
  const [start, end] = selection(editState(control));

  if (start !== end) {
    await remove(system, control, host, start, end);
  }
}

/**
 * The selection taken out, and pasted text put in its place, for `WM_CUT`,
 * `WM_CLEAR` and `WM_PASTE`: `null` puts nothing in. **Recorded** by
 * `editclip`: `EN_UPDATE` and `EN_CHANGE` once for each of the two that
 * changes the text.
 */
export async function mlPasteText(system: any, control: ControlState, host: LinesHost, text: string | null) {
  /* A paste into a control that does not scroll down keeps nothing from
   * before (seg30 `17fc`). */
  if (text !== null && !autoV(control)) {
    emptyUndo(editState(control));
  }

  await deleteSelection(system, control, host);

  if (text !== null) {
    await insert(system, control, host, text, false);
  }
}

/** Backspace, as the control's own `WM_CHAR` takes it: the selection, or the character before. */
async function backspace(system: any, control: ControlState, host: LinesHost) {
  const [start, end] = selection(editState(control));

  if (start !== end) {
    await deleteSelection(system, control, host);
  } else if (start > 0) {
    await remove(system, control, host, step(control.text, start, false), start);
  }
}

/** The selection set as the control sets it for itself (seg32 `0340`): -1 is the caret, the caret brought into view. */
async function selectFor(system: any, control: ControlState, host: LinesHost, from: number, to: number) {
  const edit = editState(control);
  const length = control.text.length;

  if (from === -1) {
    from = to = edit.caret;
  }

  edit.anchor = Math.min(Math.max(from, 0), length);
  edit.caret = Math.min(Math.max(to, 0), length);
  linesState(control).caretLine = lineOf(control, edit.caret);
  host.repaint();
  await scrollToCaret(system, control, host);
}

/**
 * Undo (seg32 `0477`): an insertion is selected and taken out as a
 * backspace takes it, which keeps what it took to be put back; then the
 * text taken out is put back where it was and selected. So an undo is undone
 * by the next. Each of the two tells the parent `EN_UPDATE` and `EN_CHANGE`.
 * Unlike the single-line control's, the caret stays where the insertion was
 * taken out. Answers whether there was anything to undo. **Recorded** by
 * `editundo`.
 */
async function undo(system: any, control: ControlState, host: LinesHost) {
  const edit = editState(control);

  if (!edit.undo?.kind) {
    return 0;
  }

  const taken = takeUndo(edit);

  if (taken.inserted) {
    await selectFor(system, control, host, taken.insStart, taken.insEnd);
    edit.undo!.insStart = edit.undo!.insEnd = -1;
    await backspace(system, control, host);
  }

  if (taken.hadDelete) {
    await selectFor(system, control, host, taken.ichDeleted, taken.ichDeleted);
    await insert(system, control, host, taken.deleted ?? '', false);
    await selectFor(system, control, host, taken.ichDeleted, taken.ichDeleted + taken.cchDeleted);
  }

  return 1;
}

/** Control 1, Shift 2, both 3, as the control reads the keys (seg30 `1074`). */
function modifiers(system: any) {
  return ((keyState(system, VK_CONTROL) & 0x80) !== 0 ? 1 : 0) + ((keyState(system, VK_SHIFT) & 0x80) !== 0 ? 2 : 0);
}

/** The control's parent, which it keeps from when it was made. */
function parentOf(system: any, control: ControlState) {
  return system.handles.resolve(control.hwnd)?.window?.parent?.hwnd ?? 0;
}

/**
 * Escape, Enter and Tab pressed in a control that knows it is in a dialog
 * (seg30 `10b6`, `10d2`, `1140`, by the key table at `15be`); whether the
 * key was one of them. Escape posts its parent `WM_CLOSE`, which a dialog
 * takes as Cancel. Enter, unless with Control alone or `ES_WANTRETURN`, gives
 * the focus to the dialog's default button and, the focus gone, posts the
 * button the key, which the dialog manager takes as the button's. Tab moves
 * on, or back with Shift, by `WM_NEXTDLGCTL`; with Control alone it is typed.
 * Out of a dialog, a key goes on to the character. **Recorded** by `mldlg`.
 */
async function dialogKey(system: any, control: ControlState, host: LinesHost, key: number) {
  const edit = editState(control);
  const held = modifiers(system);
  const parent = parentOf(system, control);

  switch (key) {
    case VK_ESCAPE:
      if (edit.inDialog) {
        PostMessage.call(system, parent, WM_CLOSE, 0, 0);
      }

      return true;

    case VK_RETURN: {
      if (!edit.inDialog || held === 1 || control.style & ES_WANTRETURN) {
        return true;
      }

      const id = (await SendMessage.call(system, parent, DM_GETDEFID, 0, 0)) & 0xffff;
      const button = id ? GetDlgItem.call(system, parent, id) : 0;

      if (!button) {
        return true;
      }

      await SendMessage.call(system, parent, WM_NEXTDLGCTL, button, 1);

      if (!editState(control).focused) {
        PostMessage.call(system, button, WM_KEYDOWN, VK_RETURN, 0);
      }

      return true;
    }

    case VK_TAB:
      if (held === 1) {
        await typed(system, control, host, VK_TAB, held);
      } else if (edit.inDialog) {
        await SendMessage.call(system, parent, WM_NEXTDLGCTL, held === 2 ? 1 : 0, 0);
      }

      return true;
  }

  return false;
}

/**
 * A character (seg30 `1682`): Escape is never typed; in a dialog, Tab and,
 * unless `ES_WANTRETURN`, Enter are not typed without Control, as the
 * dialog manager has them. `held` is the keys held, Control 1.
 */
async function typed(system: any, control: ControlState, host: LinesHost, code: number, held: number) {
  const edit = editState(control);

  if (code === 0x0a) {
    code = 0x0d;
  }

  if (code === VK_ESCAPE) {
    return;
  }

  if (edit.inDialog && held !== 1 && (code === VK_TAB || (code === VK_RETURN && !(control.style & ES_WANTRETURN)))) {
    return;
  }

  if (code === VK_BACK) {
    await backspace(system, control, host);
    return;
  }

  /* Control and Z undoes, by `EM_UNDO` sent to the control (`17db`). */
  if (code === 0x1a) {
    await SendMessage.call(system, control.hwnd, EM_UNDO, 0, 0);
    return;
  }

  if (code === 0x0d || code === 0x09 || code >= 0x20) {
    await deleteSelection(system, control, host);
    await insert(system, control, host, code === 0x0d ? '\r\n' : String.fromCharCode(code), code !== 0x0d);
  }
}

/** A press, as the mouse makes one and the keys that move between lines do (seg30 `18a9`). */
async function press(system: any, control: ControlState, host: LinesHost, x: number, y: number, shift: boolean) {
  const edit = editState(control);
  const state = linesState(control);
  const layout = host.layout();
  const { line, index } = indexAt(control, layout, x, y);

  state.caretLine = line;
  edit.caret = index;

  if (!shift) {
    edit.anchor = index;
  }

  await scrollToCaret(system, control, host);
  host.repaint();
}

/** The caret's place for the keys that move a line: where it stands, drawn or not. */
function caretPixel(control: ControlState, layout: LinesLayout) {
  const state = linesState(control);
  const edit = editState(control);
  const rect = formatRect(layout);
  const start = state.starts[state.caretLine] ?? 0;

  /* Not kept within the rectangle: only placing the caret does that (seg30 `0277`). */
  return {
    x: rect.left + widthOf(layout, control.text.slice(start, edit.caret)) - state.offset,
    y: (state.caretLine - state.first) * layout.height1 + rect.top,
  };
}

/**
 * The text kept in its block in the program's heap as it changes, as USER
 * keeps it there all the time (seg26 `05c4`, `edit-buffer.ts`): a program
 * that took the block's handle once reads the text from it whenever it locks
 * it. Notepad saves so, `EM_FMTLINES` then `LocalLock` of the handle
 * `EM_GETHANDLE` gave it as the file was made new (`NOTEPAD.EXE` seg3
 * `0107`-`014a`); it saved noughts.
 */
function keepText(system: any, control: ControlState, changed: boolean) {
  if (changed) {
    textHandle(system, control);
  }
}

/** New text: the lines built again, the caret and the view at the start. */
async function restart(system: any, control: ControlState, host: LinesHost) {
  const edit = editState(control);
  const state = linesState(control);

  edit.anchor = edit.caret = 0;
  state.first = 0;
  state.offset = 0;
  state.caretLine = 0;
  buildLines(control, host.layout(), 0, 0, false);
  keepText(system, control, true);
  await setPositions(system, control, host.layout());
  placeCaret(system, control, host.layout());
  host.repaint();
}

/** A multi-line edit control's answer to a message, or `undefined`. */
export async function mlEditMessage(
  system: any,
  control: ControlState,
  host: LinesHost,
  message: number,
  wParam: number,
  lParam: number
) {
  const edit = editState(control);
  const state = linesState(control);
  const signed = (value: number) => ((value & 0xffff) << 16) >> 16;

  switch (message) {
    case User.WM_SETFOCUS: {
      const layout = host.layout();

      edit.focused = true;
      CreateCaret.call(system, control.hwnd, 0, 2, layout.height1);
      placeCaret(system, control, layout);
      ShowCaret.call(system, control.hwnd);
      host.repaint();
      await host.notify(EN_SETFOCUS);
      return 0;
    }

    case User.WM_KILLFOCUS:
      edit.focused = false;
      HideCaret.call(system, control.hwnd);
      DestroyCaret.call(system);
      host.repaint();
      await host.notify(EN_KILLFOCUS);
      return 0;

    case User.WM_SIZE:
      buildLines(control, host.layout(), 0, 0, false);
      return 0;

    /* A character, answered 1 (seg30 `22f9`), Control alone read as held. */
    case WM_CHAR:
      await typed(system, control, host, wParam & 0xff, modifiers(system) & 1);
      return 1;

    /* Alt and Backspace undoes, by `EM_UNDO` sent to the control, and its
     * character is taken; both answered 1 (seg30 `2307`, `2325`). */
    case WM_SYSKEYDOWN:
      if (wParam === VK_BACK && lParam & 0x20000000) {
        await SendMessage.call(system, control.hwnd, EM_UNDO, 0, 0);
        return 1;
      }

      return undefined;

    case WM_SYSCHAR:
      return wParam === VK_BACK && lParam & 0x20000000 ? 1 : undefined;

    /* Undone: whether there was anything (seg30 `23d3`, seg32 `0477`). */
    case EM_UNDO:
    case WM_UNDO:
      return await undo(system, control, host);

    /* Answered 1 (seg30 `22ee`). */
    case WM_KEYDOWN: {
      if (await dialogKey(system, control, host, wParam)) {
        return 1;
      }

      const shift = (keyState(system, VK_SHIFT) & 0x80) !== 0;
      const ctrl = (keyState(system, VK_CONTROL) & 0x80) !== 0;
      const layout = host.layout();
      const rect = formatRect(layout);
      const move = async (to: number, line = lineOf(control, to)) => {
        edit.caret = to;
        state.caretLine = line;

        if (!shift) {
          edit.anchor = to;
        }

        await scrollToCaret(system, control, host);
        host.repaint();
      };

      switch (wParam) {
        case VK_UP:
        case VK_DOWN: {
          if (ctrl) {
            return 1;
          }

          const { x, y } = caretPixel(control, layout);

          await press(system, control, host, x, y + (wParam === VK_UP ? -layout.height1 : layout.height1) + 1, shift);
          return 1;
        }

        case VK_PRIOR:
        case VK_NEXT: {
          const { x, y } = caretPixel(control, layout);
          const page = Math.max(1, rect.visible - 1);

          await scroll(system, control, host, true, wParam === VK_PRIOR ? -page : page);
          await press(system, control, host, x, y + 1, shift);
          return 1;
        }

        case VK_HOME:
          await move(ctrl ? 0 : state.starts[state.caretLine]);
          return 1;

        /* End keeps the caret on a wrapped line: before the end of the text,
         * on a line after the first that starts without a CR LF before it,
         * its line is the one before -- whether or not the caret is at that
         * line's start (seg30 `1630`). */
        case VK_END: {
          const to = ctrl
            ? control.text.length
            : state.starts[state.caretLine] + lineLength(control, state.caretLine);
          let line = lineOf(control, to);

          if (
            to < control.text.length &&
            wraps(control) &&
            line !== 0 &&
            control.text.slice(state.starts[line] - 2, state.starts[line]) !== '\r\n'
          ) {
            line--;
          }

          await move(to, line);
          return 1;
        }

        case VK_LEFT:
          await move(shift || edit.anchor === edit.caret ? step(control.text, edit.caret, false) : selection(edit)[0]);
          return 1;

        case VK_RIGHT:
          await move(shift || edit.anchor === edit.caret ? step(control.text, edit.caret, true) : selection(edit)[1]);
          return 1;

        case VK_DELETE: {
          const [start, end] = selection(edit);

          if (start !== end) {
            await deleteSelection(system, control, host);
          } else if (start < control.text.length) {
            await remove(system, control, host, start, step(control.text, start, true));
          }

          return 1;
        }
      }

      return 1;
    }

    case WM_LBUTTONDOWN: {
      host.capture(true);
      edit.tracking = true;

      if (!edit.focused) {
        if (!(control.style & ES_NOHIDESEL)) {
          edit.anchor = edit.caret;
        }
      }

      await press(system, control, host, signed(lParam), signed(lParam >>> 16), (wParam & MK_SHIFT) !== 0);

      if (!edit.focused) {
        await host.focus();
      }

      return 0;
    }

    case WM_MOUSEMOVE:
      if (edit.tracking) {
        await press(system, control, host, signed(lParam), signed(lParam >>> 16), true);
      }

      return 0;

    case WM_LBUTTONUP:
      if (edit.tracking) {
        edit.tracking = false;
        host.capture(false);
      }

      return 0;

    /* A double click (seg30 `1a08`): the word from where the first press put
     * the caret, looking back unless it is at the start of the caret's line,
     * selected; the caret at its end, on the line that end is on -- the next
     * one, for a word that ends where a line wraps. A press is no longer
     * followed, so moving the mouse with the button held stretches nothing.
     * **Recorded** by `editdbl`, in a control that wraps: past the end of a
     * wrapped line, the word before the wrap; at the start of the next, the
     * word there. */
    case WM_LBUTTONDBLCLK: {
      const left = edit.caret !== state.starts[state.caretLine];
      const [start, end] = await wordAround(system, control, edit.caret, left);

      edit.anchor = start;
      edit.caret = end;
      state.caretLine = lineOf(control, end);
      edit.tracking = false;
      await scrollToCaret(system, control, host);
      host.repaint();
      return 0;
    }

    /* The text's rectangle, copied out; answers 1 (seg26 `0e1c`). */
    case EM_GETRECT: {
      const rect = formatRect(host.layout());

      writeRect(system, lParam, rect.left, rect.top, rect.right, rect.bottom);
      return 1;
    }

    /* Scrolling (seg30 `1bfe`): a line or character, a page -- a line less
     * than shows, counted in characters too across -- the thumb, `n` for
     * `EM_LINESCROLL`, or 40Eh, which answers the position without moving
     * and is how Notepad, whose frame has the scroll bars, reads it. */
    case WM_VSCROLL:
    case WM_HSCROLL: {
      const vertical = message === WM_VSCROLL;
      const layout = host.layout();
      const rect = formatRect(layout);
      const page = Math.max(1, rect.visible - 1);
      const n = signed(lParam);
      const mulDiv = (a: number, b: number, c: number) => (c ? Math.floor((a * b + (c >> 1)) / c) : 0);

      if (wParam === 0x040e) {
        const { v, h } = positions(control, layout);

        return vertical ? v : h;
      }

      if (wParam === 4 || wParam === 5) {
        if (vertical) {
          state.first = Math.min(mulDiv(state.starts.length - 1, n, 100), state.starts.length - 1);
        } else {
          state.offset = mulDiv(state.widest - layout.average, n, 100);
        }

        await scroll(system, control, host, vertical, 0, wParam === 4);
        return 0x10000;
      }

      const amounts: Record<number, number> = { 0: -1, 1: 1, 2: -page, 3: page, 0x406: n };

      if (wParam in amounts) {
        await scroll(system, control, host, vertical, amounts[wParam]);
        return ((1 << 16) | (amounts[wParam] & 0xffff)) >>> 0;
      }

      return 0;
    }

    case EM_SCROLL:
      return mlEditMessage(system, control, host, WM_VSCROLL, wParam, 0);

    case EM_LINESCROLL:
      await mlEditMessage(system, control, host, WM_VSCROLL, 0x406, signed(lParam) & 0xffff);
      await mlEditMessage(system, control, host, WM_HSCROLL, 0x406, (lParam >>> 16) & 0xffff);
      return 1;

    case EM_GETSEL: {
      const [start, end] = selection(edit);

      return ((end << 16) | start) >>> 0;
    }

    /* The caret goes to the second end, and is brought into view (32:0340). */
    case EM_SETSEL: {
      const length = control.text.length;
      let from = signed(lParam);
      const to = Math.min((lParam >>> 16) & 0xffff, length);

      if (from === -1) {
        from = edit.caret;
      }

      edit.anchor = Math.min(Math.max(from, 0), length);
      edit.caret = to;
      state.caretLine = lineOf(control, to);
      host.repaint();
      await scrollToCaret(system, control, host);
      return 1;
    }

    case EM_LIMITTEXT:
      edit.limit = wParam || 30000;
      return 0;

    case EM_GETLINECOUNT:
      return state.starts.length;

    case EM_GETFIRSTVISIBLELINE:
      return state.first;

    case EM_LINEFROMCHAR: {
      const index = signed(wParam);

      return lineOf(control, index === -1 ? selection(edit)[0] : index);
    }

    case EM_LINEINDEX: {
      const line = signed(wParam) === -1 ? state.caretLine : signed(wParam);

      return line >= state.starts.length ? 0xffff : state.starts[line];
    }

    case EM_LINELENGTH: {
      const index = signed(wParam);

      if (index !== -1) {
        return lineLength(control, lineOf(control, index));
      }

      const [start, end] = selection(edit);
      const first = lineOf(control, start);
      const last = lineOf(control, end);

      return start - state.starts[first] + (state.starts[last] + lineLength(control, last) - end);
    }

    case EM_GETLINE: {
      const line = signed(wParam);

      if (line < 0 || line >= state.starts.length) {
        return 0;
      }

      const core = system.machine.cpu.core;
      const segment = (lParam >>> 16) & 0xffff;
      const offset = lParam & 0xffff;
      const room = core.read16(segment, offset);
      const start = state.starts[line];
      const count = Math.min(lineLength(control, line), room);

      for (let at = 0; at < count; at++) {
        core.write8(segment, offset + at, control.text.charCodeAt(start + at) & 0xff);
      }

      return count;
    }

    /* The selection replaced, which cannot be undone: what was kept is
     * thrown away before the selection is taken out, before the text is put
     * in and afterwards; answered 1 (seg30 `249d`). */
    case EM_REPLACESEL: {
      const { stringAt } = await import('./control-classes.js');

      emptyUndo(edit);
      await deleteSelection(system, control, host);
      emptyUndo(edit);
      await insert(system, control, host, stringAt(system, lParam), false);
      emptyUndo(edit);
      return 1;
    }

    /* After the text is set: the lines built again, everything at the start,
     * no notification and nothing to undo (seg31 `0067`, `00c7`). */
    case User.WM_SETTEXT:
      emptyUndo(edit);
      await restart(system, control, host);
      return 1;

    /* The text's block in the program's heap (`edit-buffer.ts`). */
    case EM_GETHANDLE:
      return textHandle(system, control);

    /* Another block taken as the text: everything at the start, as for
     * `WM_SETTEXT`, no notification, not modified, and nothing to undo
     * (seg32 `018f`, `01c5`). */
    case EM_SETHANDLE: {
      const text = adoptHandle(system, control, wParam & 0xffff);

      if (text !== null) {
        control.text = text;
        edit.modified = false;
        emptyUndo(edit);
        await restart(system, control, host);
      }

      return 1;
    }
  }

  return undefined;
}

/** The rows of a multi-line control to draw: each line, and its selected part. */
export function paintLines(control: ControlState, layout: LinesLayout) {
  const state = linesState(control);
  const edit = editState(control);
  const rect = formatRect(layout);
  const [start, end] = selection(edit);
  const shows = start !== end && (edit.focused || (control.style & ES_NOHIDESEL) !== 0);
  const rows: { y: number; runs: { x: number; text: string; selected: boolean }[] }[] = [];

  if (!rect.valid) {
    return { rect, rows };
  }

  const last = Math.min(state.first + rect.visible, state.starts.length - 1);

  for (let line = state.first; line <= last; line++) {
    const from = state.starts[line];
    const to = from + lineLength(control, line);
    const y = (line - state.first) * layout.height1 + rect.top;
    const cuts = shows ? [from, Math.max(from, Math.min(start, to)), Math.max(from, Math.min(end, to)), to] : [from, to];
    const runs: { x: number; text: string; selected: boolean }[] = [];

    for (let index = 0; index + 1 < cuts.length; index++) {
      const a = cuts[index];
      const b = cuts[index + 1];

      if (b > a) {
        runs.push({
          x: rect.left - state.offset + widthOf(layout, control.text.slice(from, a)),
          text: control.text.slice(a, b),
          selected: shows && index === 1,
        });
      }
    }

    rows.push({ y, runs });
  }

  return { rect, rows };
}
