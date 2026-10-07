'use strict';

import { DWORD, INT } from '../types.js';
import { User } from '../user.js';

import { keyState } from './accelerators.js';
import { CreateCaret, DestroyCaret, HideCaret, SetCaretPos, ShowCaret } from './caret.js';
import { type ControlState } from './controls.js';
import { textPointer } from './edit-buffer.js';

/**
 * The single-line edit control: what it does with the characters, keys and
 * messages it is sent.
 *
 * **Recorded** by `editctl`, on four displays, everything sent with
 * `SendMessage` to two edit controls:
 *
 * * a character is typed where the caret is, over the selection if there is
 *   one; backspace takes the selection or the character before, Delete the
 *   selection or the one after;
 * * Home, End and the arrows move the caret and take the selection away;
 * * the caret stands at the selection's end;
 * * every change tells the parent `EN_UPDATE`, then `EN_CHANGE`, with
 *   `WM_COMMAND`; a character that would pass the limit changes nothing and
 *   tells it `EN_MAXTEXT`; setting the text is a change too, and selecting
 *   is not;
 * * the focus arriving tells the parent `EN_SETFOCUS`, and leaving
 *   `EN_KILLFOCUS`; the selection stays as it was.
 */

export const EM_GETSEL = 0x0400;
export const EM_SETSEL = 0x0401;
export const EM_LIMITTEXT = 0x0415;
export const EM_GETRECT = 0x0402;
export const EM_SETWORDBREAKPROC = 0x0420;
export const EM_GETWORDBREAKPROC = 0x0421;

export const EN_SETFOCUS = 0x0100;
export const EN_KILLFOCUS = 0x0200;
export const EN_CHANGE = 0x0300;
export const EN_UPDATE = 0x0400;
export const EN_MAXTEXT = 0x0501;

const WM_CHAR = 0x0102;
const WM_KEYDOWN = 0x0100;

const VK_BACK = 0x08;
const VK_SHIFT = 0x10;
const VK_END = 0x23;
const VK_HOME = 0x24;
const VK_LEFT = 0x25;
const VK_RIGHT = 0x27;
const VK_DELETE = 0x2e;

/** What an edit control keeps beyond its text. */
export interface EditState {
  /** Where the selection starts, where it ends, and the caret stands. */
  anchor: number;
  caret: number;
  /** The first character that shows. */
  scroll: number;
  limit: number;
  focused: boolean;
  /** Whether a press is being followed with the mouse captured. */
  tracking?: boolean;
  /** Whether the text was changed since it was last set (`EM_GETMODIFY`). */
  modified?: boolean;
  /** A program's word-break procedure (`EM_SETWORDBREAKPROC`), or nought. */
  wordBreak?: number;
}

export function editState(control: ControlState): EditState {
  control.edit ??= { anchor: 0, caret: 0, scroll: 0, limit: 30000, focused: false };

  return control.edit;
}

/** The selection, its lower end first. */
export function selection(edit: EditState): [number, number] {
  return [Math.min(edit.anchor, edit.caret), Math.max(edit.anchor, edit.caret)];
}

/**
 * What the edit control's window procedure needs of the desktop it is on:
 * where its text and caret go, and telling its parent.
 */
export interface EditHost {
  /** The caret's size and where a character boundary is, for the control's font. */
  layout(): EditLayout;
  notify(code: number): Promise<void>;
  repaint(): void;
  /** Takes the focus, as a press on the control does. */
  focus(): Promise<void>;
  /** Captures the mouse, or lets it go. */
  capture(on: boolean): void;
}

export interface EditLayout {
  caretWidth: number;
  caretHeight: number;
  /** The text's rectangle in the client area. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  average: number;
  fixed: boolean;
  overhang: number;
  /** How wide a run of the text is. */
  measure(text: string): number;
}

/**
 * Where a character boundary is across the client area (seg28 `0047`): the
 * text's left less the font's overhang, and the width of what shows before
 * it; for a fixed pitch, the average width a character.
 */
export function boundaryX(control: ControlState, layout: EditLayout, index: number) {
  const edit = editState(control);

  if (layout.fixed) {
    return layout.left + (index - edit.scroll) * layout.average;
  }

  return layout.left - layout.overhang + layout.measure(control.text.slice(edit.scroll, index));
}

/**
 * The caret at its boundary, and at the text's top; never so far right that
 * it leaves the text's rectangle (seg28 `0000`).
 */
function placeCaret(system: any, control: ControlState, host: EditHost) {
  const edit = editState(control);
  const layout = host.layout();

  scrollTo(control, layout);

  if (edit.focused) {
    SetCaretPos.call(
      system,
      Math.min(boundaryX(control, layout, edit.caret), layout.right - layout.caretWidth),
      layout.top
    );
  }
}

/** How many characters of `text`, counted back from its end, fit in `width` (seg26 `025c`). */
function fitBack(text: string, width: number, layout: EditLayout) {
  let count = 0;

  while (count < text.length && layout.measure(text.slice(text.length - count - 1)) <= width) {
    count++;
  }

  return count;
}

/**
 * Brings the caret into view, for `ES_AUTOHSCROLL` (seg28 `061d`): at or
 * before the first character that shows, back by as many characters as fit
 * in a quarter of the width; past the last that fits, on so the caret is
 * three quarters of the way along what fits -- but never so far that the
 * end of the text leaves room at the right.
 */
function scrollTo(control: ControlState, layout: EditLayout) {
  const edit = editState(control);
  const text = control.text;

  if (!(control.style & ES_AUTOHSCROLL)) {
    return;
  }

  if (edit.caret <= edit.scroll) {
    edit.scroll = Math.max(
      0,
      edit.caret - fitBack(text.slice(0, edit.caret), Math.trunc(layout.width / 4), layout)
    );
    return;
  }

  const fits = fitBack(text.slice(edit.scroll, edit.caret), layout.width, layout);

  if (edit.caret - edit.scroll > fits) {
    const atEnd = fitBack(text, layout.width, layout);

    edit.scroll = Math.min(edit.caret - Math.trunc((3 * fits) / 4), text.length - atEnd);
  }
}

const ES_AUTOHSCROLL = 0x0080;

const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_LBUTTONDBLCLK = 0x0203;
const MK_SHIFT = 0x0004;
const ES_NOHIDESEL = 0x0100;

/**
 * The character a place across the client area falls before (seg28 `0eee`).
 * Left of the text's rectangle, the one before the first that shows; right
 * of it, one past the first that does not fit. Otherwise the most characters
 * from the first that shows whose width, less half the font's average width,
 * reaches no further than the place: the dividing point before a character
 * is half an average width back from its left edge, whatever its own width.
 * **Recorded** by `editctl`: "abc" in the System font, each letter eight
 * pixels wide from 4, average 8 -- presses from 6 to 20 give 0, then 1 from
 * 8, then 2 from 16.
 */
function indexAt(control: ControlState, layout: EditLayout, x: number) {
  const edit = editState(control);
  const text = control.text;

  if (x <= layout.left) {
    return edit.scroll > 0 ? edit.scroll - 1 : 0;
  }

  if (x > layout.right) {
    let fits = 0;

    while (
      edit.scroll + fits < text.length &&
      layout.measure(text.slice(edit.scroll, edit.scroll + fits + 1)) <= layout.width
    ) {
      fits++;
    }

    return edit.scroll + fits >= text.length ? text.length : edit.scroll + fits + 1;
  }

  const half = Math.trunc(layout.average / 2);
  let count = 0;

  while (
    edit.scroll + count < text.length &&
    layout.measure(text.slice(edit.scroll, edit.scroll + count + 1)) - half <= x - layout.left
  ) {
    count++;
  }

  return edit.scroll + count;
}

/**
 * The word a double click selects, from where the caret is (seg26 `0426`),
 * as both edit controls ask for it: its start and its end. Spaces and tabs
 * are the only blanks (seg26 `0361`); punctuation is part of a word.
 *
 * `left` is whether to look back first, which the controls ask for unless
 * the caret is at the start of the text, for the single-line control, or of
 * its line, for the multi-line one. Back, it goes over blanks and line feeds
 * and then over the word before them, stopping after a blank or a line feed,
 * or on a CR. Not back, from a blank or a CR it goes on over blanks and line
 * feeds to the word after; from a word, back to its start, stopping at a
 * blank or a line feed before it.
 *
 * The end is from one past the start, on over the word, then over the
 * blanks after it, stopping at a CR or after a line feed. A start on a CR
 * takes the line break: from the CR before it, for the CR CR LF of a soft
 * break, or over both CRs. At the end of the text with nothing to look back
 * over, or at the start of it looking back, it is nought to nought.
 */
export function findWord(text: string, ich: number, left: boolean): [number, number] {
  const length = text.length;
  const blank = (at: number) => text[at] === ' ' || text[at] === '\t';
  const is = (at: number, character: string) => text[at] === character;

  if ((ich === 0 && left) || (ich === length && !left)) {
    return [0, 0];
  }

  let start = ich;

  if (!left && (blank(start) || is(start, '\r'))) {
    while ((blank(start) || is(start, '\n')) && start < length) {
      start++;
    }
  } else {
    let word = false;

    while (start > 0) {
      const before = blank(start - 1) || is(start - 1, '\n');

      if ((before && word) || (before && !left)) {
        break;
      }

      start--;

      if (blank(start) || is(start, '\n')) {
        continue;
      }

      word = true;

      if (is(start, '\r')) {
        break;
      }
    }
  }

  let end = Math.min(length, start + 1);

  if (is(start, '\r')) {
    if (start > 0 && is(start - 1, '\r')) {
      start--;
    } else if (is(start + 1, '\r')) {
      end++;
    }
  }

  let blanks = blank(end);

  while (length > end) {
    if ((blanks && !blank(end)) || is(end, '\r')) {
      break;
    }

    end++;

    if (blank(end)) {
      blanks = true;
    }

    if (is(end - 1, '\n')) {
      break;
    }
  }

  return [start, end];
}

const WB_LEFT = 0;
const WB_RIGHT = 1;
const WB_ISDELIMITER = 2;

/**
 * The word a double click selects, as `findWord` finds it or, where the
 * program gave one with `EM_SETWORDBREAKPROC`, as its procedure does (seg26
 * `0370`). It is called with the text, as a far pointer to the control's
 * block, the place, the text's length and what is asked: not looking back,
 * whether the place is a delimiter (`WB_ISDELIMITER`), and if it is, or the
 * place is a CR, where the next word starts (`WB_RIGHT`); otherwise, and
 * looking back, where this word starts (`WB_LEFT`). The end is then
 * `WB_RIGHT` from one past the start, a line break at the start taken as
 * `findWord` takes it. **Recorded** by `editdbl`, with a procedure that
 * takes commas too: `WB_LEFT` and `WB_RIGHT` at the caret within a word;
 * `WB_ISDELIMITER`, `WB_LEFT` and `WB_RIGHT` from one on at the text's start.
 *
 * Not followed: the multi-line control's wrapping by the procedure (seg30
 * `0ce6`), which wraps by blanks here whatever it was given.
 */
export async function wordAround(
  system: any,
  control: ControlState,
  ich: number,
  left: boolean
): Promise<[number, number]> {
  const text = control.text;
  const length = text.length;
  const proc = editState(control).wordBreak ?? 0;

  if ((ich === 0 && left) || (ich === length && !left)) {
    return [0, 0];
  }

  const pointer = proc ? textPointer(system, control) : 0;

  if (!pointer) {
    return findWord(text, ich, left);
  }

  /* With DS the block's segment, as USER's own is while it calls. */
  const call = async (at: number, code: number) =>
    ((await system.scheduler.callProc(
      proc,
      [
        [pointer, DWORD],
        [at, INT],
        [length, INT],
        [code, INT],
      ],
      { ds: pointer >>> 16 }
    )) as number) & 0xffff;

  let start: number;

  if (!left && ((await call(ich, WB_ISDELIMITER)) || text[ich] === '\r')) {
    start = await call(ich, WB_RIGHT);
  } else {
    start = await call(ich, WB_LEFT);
  }

  let end = Math.min(length, start + 1);

  if (text[start] === '\r') {
    if (start > 0 && text[start - 1] === '\r') {
      start--;
    } else if (text[start + 1] === '\r') {
      end++;
    }
  }

  return [start, await call(end, WB_RIGHT)];
}

/** A `RECT` written where `lParam` points, as `EM_GETRECT` copies one. */
export function writeRect(
  system: any,
  lParam: number,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  const core = system.machine.cpu.core;
  const segment = (lParam >>> 16) & 0xffff;
  const offset = lParam & 0xffff;

  [left, top, right, bottom].forEach((value, at) => {
    core.write16(segment, (offset + at * 2) & 0xffff, value & 0xffff);
  });
}

/** Replaces the selection with `text`, as typing does; whether anything changed. */
async function replace(control: ControlState, host: EditHost, text: string) {
  const edit = editState(control);
  const [start, end] = selection(edit);

  if (control.text.length - (end - start) + text.length > edit.limit) {
    await host.notify(EN_MAXTEXT);
    return false;
  }

  control.text = control.text.slice(0, start) + text + control.text.slice(end);
  edit.anchor = edit.caret = start + text.length;

  /* Changed by anything put in or taken out (seg26 `05c4`, `0841`). */
  if (text.length || end > start) {
    edit.modified = true;
  }

  return true;
}

/**
 * The selection replaced with pasted text, or with nothing for `WM_CLEAR`:
 * as much of it as the limit leaves room for, `EN_MAXTEXT` first if not
 * all, and then `EN_UPDATE` and `EN_CHANGE` whatever changed. **Recorded**
 * by `editclip`: ten characters pasted into three with a limit of six put
 * in three; an empty clipboard pasted still tells the parent.
 */
export async function pasteText(system: any, control: ControlState, host: EditHost, text: string) {
  const edit = editState(control);
  const [start, end] = selection(edit);
  const room = Math.max(0, edit.limit - (control.text.length - (end - start)));
  let put = text;

  if (put.length > room) {
    await host.notify(EN_MAXTEXT);
    put = put.slice(0, room);
  }

  control.text = control.text.slice(0, start) + put + control.text.slice(end);
  edit.anchor = edit.caret = start + put.length;

  if (put.length || end > start) {
    edit.modified = true;
  }

  await changed(system, control, host);
}

async function changed(system: any, control: ControlState, host: EditHost) {
  placeCaret(system, control, host);
  host.repaint();
  await host.notify(EN_UPDATE);
  await host.notify(EN_CHANGE);
}

/**
 * An edit control's answer to a message, or `undefined` for one it leaves to
 * the rest of its window procedure.
 */
export async function editMessage(
  system: any,
  control: ControlState,
  host: EditHost,
  message: number,
  wParam: number,
  lParam: number
) {
  const edit = editState(control);

  switch (message) {
    case User.WM_SETFOCUS: {
      const layout = host.layout();

      edit.focused = true;
      CreateCaret.call(system, control.hwnd, 0, layout.caretWidth, layout.caretHeight);
      placeCaret(system, control, host);
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

    case WM_CHAR: {
      const code = wParam & 0xff;

      if (code === VK_BACK) {
        const [start, end] = selection(edit);

        if (start === end && start === 0) {
          return 0;
        }

        if (start === end) {
          edit.anchor = start - 1;
        }

        await replace(control, host, '');
        await changed(system, control, host);
        return 0;
      }

      if (code < 0x20) {
        return 0;
      }

      if (await replace(control, host, String.fromCharCode(code))) {
        await changed(system, control, host);
      }

      return 0;
    }

    case WM_KEYDOWN: {
      const shift = (keyState(system, VK_SHIFT) & 0x80) !== 0;
      const move = (to: number) => {
        edit.caret = Math.max(0, Math.min(control.text.length, to));

        if (!shift) {
          edit.anchor = edit.caret;
        }

        placeCaret(system, control, host);
        host.repaint();
      };

      switch (wParam) {
        case VK_HOME:
          move(0);
          return 0;
        case VK_END:
          move(control.text.length);
          return 0;
        case VK_LEFT:
          move(shift || edit.anchor === edit.caret ? edit.caret - 1 : selection(edit)[0]);
          return 0;
        case VK_RIGHT:
          move(shift || edit.anchor === edit.caret ? edit.caret + 1 : selection(edit)[1]);
          return 0;
        case VK_DELETE: {
          const [start, end] = selection(edit);

          if (start === end && end === control.text.length) {
            return 0;
          }

          if (start === end) {
            edit.anchor = start + 1;
          }

          await replace(control, host, '');
          await changed(system, control, host);
          return 0;
        }
      }

      return 0;
    }

    /* The mouse (seg28 `1009`). A press on a control without the focus
     * first takes the selection away, unless `ES_NOHIDESEL`, and takes the
     * focus; then the mouse is captured, and the caret goes where it was
     * pressed -- the selection with it, or with Shift stretched from its
     * other end. While captured, a move stretches it. */
    case WM_LBUTTONDOWN: {
      if (!edit.focused) {
        if (!(control.style & ES_NOHIDESEL)) {
          edit.anchor = edit.caret;
        }

        await host.focus();
      }

      const layout = host.layout();

      edit.tracking = true;
      host.capture(true);
      edit.caret = Math.min(indexAt(control, layout, (lParam << 16) >> 16), control.text.length);

      if (!(wParam & MK_SHIFT)) {
        edit.anchor = edit.caret;
      }

      placeCaret(system, control, host);
      host.repaint();
      return 0;
    }

    case WM_MOUSEMOVE:
      if (edit.tracking) {
        edit.caret = indexAt(control, host.layout(), (lParam << 16) >> 16);
        placeCaret(system, control, host);
        host.repaint();
      }

      return 0;

    case WM_LBUTTONUP:
      if (edit.tracking) {
        edit.tracking = false;
        host.capture(false);
      }

      return 0;

    /* A double click (seg28 `10fd`): the word from where the first press put
     * the caret, looking back unless it is at the text's start, selected,
     * and the caret at its end. A press is no longer followed, so moving the
     * mouse with the button held does not stretch it by characters or by
     * words. **Recorded** by `editdbl`. */
    case WM_LBUTTONDBLCLK: {
      const [start, end] = await wordAround(system, control, edit.caret, edit.caret !== 0);

      edit.anchor = start;
      edit.caret = end;
      edit.tracking = false;
      placeCaret(system, control, host);
      host.repaint();
      return 0;
    }

    /* The text's rectangle, copied out; answers 1 (seg26 `0e1c`). */
    case EM_GETRECT: {
      const layout = host.layout();

      writeRect(system, lParam, layout.left, layout.top, layout.right, layout.bottom);
      return 1;
    }

    case EM_GETSEL: {
      const [start, end] = selection(edit);

      return ((end << 16) | start) >>> 0;
    }

    case EM_SETSEL: {
      const length = control.text.length;
      const from = lParam & 0xffff;
      const to = (lParam >>> 16) & 0xffff;

      edit.anchor = Math.min(from, length);
      edit.caret = Math.min(to, length);
      placeCaret(system, control, host);
      host.repaint();
      return 1;
    }

    case EM_LIMITTEXT:
      edit.limit = wParam || 30000;
      return 0;

    /* After the text is set: the caret back to the start. */
    case User.WM_SETTEXT:
      edit.anchor = edit.caret = edit.scroll = 0;
      placeCaret(system, control, host);
      host.repaint();
      await host.notify(EN_UPDATE);
      await host.notify(EN_CHANGE);
      return 1;
  }

  return undefined;
}
