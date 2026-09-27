'use strict';

import { RasterWindow } from './raster-window.js';
import { scrollState } from './scroll-bars.js';
import { changeFrame, positionRaster } from './window-state.js';
import { PostMessage } from './PostMessage.js';

/**
 * An MDI client's scroll bars: shown when its children reach past its
 * edges, and scrolling them.
 *
 * **Read out of `USER.EXE`** (seg15 `0276`, `053f`, `06b3`), and
 * **recorded** by `mdiscrl`, a document window moved past each edge of its
 * client, scrolled a line, a page, to a thumb position and to each end,
 * minimized and maximized:
 *
 * * The ranges and positions are the screen's coordinates. A bar's position
 *   is the client's own left or top on the screen; its range runs from where
 *   the children and the client together start to where they end, less the
 *   client's width or height.
 * * The client recalculates by itself, through a message of its own it posts
 *   when a child moves or is sized, when it is sized itself, and when a child
 *   is destroyed or the icons arranged. Not while it is scrolling, and not
 *   while a child is maximized.
 */

const WS_BORDER = 0x00800000;
const WS_VSCROLL = 0x00200000;
const WS_HSCROLL = 0x00100000;

const SM_CXVSCROLL = 2;
const SM_CYHSCROLL = 3;
const SM_CXBORDER = 5;
const SM_CYBORDER = 6;
const SM_CXSIZE = 30;
const SM_CYSIZE = 31;

const SB_HORZ = 0;
const SB_VERT = 1;
const SB_BOTH = 3;

const WM_HSCROLL = 0x0114;

/** The client's private message that recalculates its bars (seg15 `06b3`). */
export const WM_MDIRECALC = 0x10ac;

/** What the client keeps for its scroll bars. */
export interface ClientScroll {
  /** The bars it was made with: 1 vertical, 2 horizontal. */
  bars: number;

  /** Scrolling, or arranging: a child's move posts nothing. */
  busy: boolean;

  /** A recalculation posted and not yet made. */
  pending: boolean;
}

function metric(window: RasterWindow, index: number) {
  return window.desktop.environment.metric(index);
}

/**
 * `CalcChildScroll`: the client's bars worked out from its children (seg15
 * `0276`).
 *
 * * Nothing for a minimized client, or a bar other than `SB_HORZ`,
 *   `SB_VERT` or `SB_BOTH`.
 * * It works on the client as if the bars it is asked about were not
 *   there, and walks its visible children: a maximized one means no
 *   scrolling at all; every other one's window counts towards what the
 *   children cover, icons and their titles too, but only a window of its
 *   own -- not an icon's title -- reaching past the client makes scrolling
 *   needed.
 * * Needed, the range is worked out again with a bar added each time one
 *   becomes needed, the client losing its width or height, until nothing
 *   changes.
 * * If a bar comes or goes, both bars' style bits are set from the ranges,
 *   the ranges and positions written as they are, and the frame changed;
 *   otherwise each bar asked about is given its range and position.
 */
export async function calcChildScroll(system: any, hwnd: number, bar: number) {
  const client = system.handles.resolve(hwnd);

  if (!(client instanceof RasterWindow) || client.window.state === 'minimized') {
    return;
  }

  if (bar !== SB_HORZ && bar !== SB_VERT && bar !== SB_BOTH) {
    return;
  }

  const shown = client.window;
  const bordered = (shown.style & WS_BORDER) !== 0;
  const cx = metric(client, SM_CXVSCROLL) - (bordered ? metric(client, SM_CXBORDER) : 0);
  const cy = metric(client, SM_CYHSCROLL) - (bordered ? metric(client, SM_CYBORDER) : 0);
  const horizontal = bar !== SB_VERT;
  const vertical = bar !== SB_HORZ;
  const left = shown.left + shown.client.left;
  const top = shown.top + shown.client.top;
  let right = left + shown.clientWidth + (vertical && shown.style & WS_VSCROLL ? cx : 0);
  let bottom = top + shown.clientHeight + (horizontal && shown.style & WS_HSCROLL ? cy : 0);

  let extent: number[] | null = null;
  let needed = false;
  let maximized = false;

  for (const child of client.desktop.windows) {
    if (child.parent !== shown || !child.visible) {
      continue;
    }

    if (child.state === 'maximized') {
      maximized = true;
      break;
    }

    const box = [child.left, child.top, child.left + child.width, child.top + child.height];

    extent = extent
      ? [
          Math.min(extent[0], box[0]),
          Math.min(extent[1], box[1]),
          Math.max(extent[2], box[2]),
          Math.max(extent[3], box[3]),
        ]
      : box;

    if (!child.titleOf && (box[0] < left || box[1] < top || box[2] > right || box[3] > bottom)) {
      needed = true;
    }
  }

  let h = { min: 0, max: 0, pos: 0 };
  let v = { min: 0, max: 0, pos: 0 };

  if (needed && !maximized && extent) {
    let hAdded = false;
    let vAdded = false;

    for (;;) {
      const rl = Math.min(extent[0], left);
      const rt = Math.min(extent[1], top);
      const rr = Math.max(extent[2], right) - (right - left);
      const rb = Math.max(extent[3], bottom) - (bottom - top);
      let changed = false;

      h = { min: rl, max: rr, pos: left };
      v = { min: rt, max: rb, pos: top };

      if (rt < rb && !vAdded) {
        vAdded = true;
        right -= cx;
        changed = true;
      }

      if (rl < rr && !hAdded) {
        hAdded = true;
        bottom -= cy;
        changed = true;
      }

      if (!changed) {
        break;
      }
    }

    if (!(h.min < h.max)) h = { min: 0, max: 0, pos: 0 };
    if (!(v.min < v.max)) v = { min: 0, max: 0, pos: 0 };
  }

  const hasH = (shown.style & WS_HSCROLL) !== 0;
  const hasV = (shown.style & WS_VSCROLL) !== 0;
  const wantH = h.min < h.max;
  const wantV = v.min < v.max;

  if ((horizontal && hasH !== wantH) || (vertical && hasV !== wantV)) {
    Object.assign(scrollState(shown, SB_HORZ)!, h);
    Object.assign(scrollState(shown, SB_VERT)!, v);

    const style =
      (shown.style & ~(WS_HSCROLL | WS_VSCROLL)) |
      (wantH ? WS_HSCROLL : 0) |
      (wantV ? WS_VSCROLL : 0);

    await changeFrame(system, hwnd, client, style);

    return;
  }

  for (const [which, range] of [
    [SB_HORZ, h],
    [SB_VERT, v],
  ] as const) {
    if ((which === SB_HORZ ? horizontal : vertical) && (which === SB_HORZ ? hasH : hasV)) {
      const state = scrollState(shown, which)!;

      state.min = range.min;
      state.max = range.max;
      state.pos = Math.min(Math.max(range.min, range.pos), range.max);
    }
  }

  client.desktop.paintFrame(shown);
}

/**
 * `ScrollChildren`: the client scrolled as its bar asks (seg15 `053f`). A
 * line is `SM_CXSIZE` or `SM_CYSIZE`, a page half the client's width or
 * height; the new position is kept to the range, and the distance moved is
 * a multiple of 8, a part of 8 rounded away from where it was going when it
 * is going forward and on by a whole 8 more going back. The position is
 * set, and the children moved by the distance, kept to the range or not.
 * `SB_ENDSCROLL` recalculates the bar; `SB_THUMBTRACK` does nothing.
 */
export async function scrollChildren(
  system: any,
  hwnd: number,
  message: number,
  code: number,
  lParam: number
) {
  const client = system.handles.resolve(hwnd);

  if (!(client instanceof RasterWindow)) {
    return;
  }

  const shown = client.window;
  const across = message === WM_HSCROLL;
  const which = across ? SB_HORZ : SB_VERT;
  const state = scrollState(shown, which)!;
  const line = metric(client, across ? SM_CXSIZE : SM_CYSIZE);
  const page = Math.trunc((across ? shown.clientWidth : shown.clientHeight) / 2);
  let next: number;

  switch (code & 0xffff) {
    case 0:
      next = state.pos - line;
      break;
    case 1:
      next = state.pos + line;
      break;
    case 2:
      next = state.pos - page;
      break;
    case 3:
      next = state.pos + page;
      break;
    case 4:
      next = ((lParam & 0xffff) << 16) >> 16;
      break;
    case 6:
      next = state.min;
      break;
    case 7:
      next = state.max;
      break;
    case 8:
      await calcChildScroll(system, hwnd, which);
      return;
    default:
      return;
  }

  next = Math.min(Math.max(state.min, next), state.max);

  let d = state.pos - next;

  if (d % 8) {
    d = (d + (d > 0 ? 8 : -8)) & ~7;
  }

  state.pos = Math.min(Math.max(state.min, state.pos - d), state.max);
  client.desktop.paintFrame(shown);

  await scrollWindow(system, hwnd, across ? d : 0, across ? 0 : d);
}

/**
 * A window's children moved by a distance, and the window painted again:
 * `ScrollWindow` with neither rectangle. Documented, and not recorded: the
 * window's pixels are painted again rather than moved.
 */
export async function scrollWindow(system: any, hwnd: number, dx: number, dy: number) {
  const window = system.handles.resolve(hwnd);

  if (!(window instanceof RasterWindow)) {
    return;
  }

  const shown = window.window;

  for (const child of [...window.desktop.windows]) {
    if (child.parent !== shown || !child.hwnd || (!dx && !dy)) {
      continue;
    }

    const handle = system.handles.resolve(child.hwnd);

    if (handle instanceof RasterWindow) {
      const x = child.left - shown.left - shown.client.left + dx;
      const y = child.top - shown.top - shown.client.top + dy;

      await positionRaster(system, child.hwnd, handle, 0, x, y, 0, 0, 0x0001 | 0x0004 | 0x0010);
    }
  }

  shown.needsPaint = true;
  shown.needsErase = true;
  (shown as any).dirtyRect = undefined;
}

/** A recalculation posted to the client, unless it is busy or one is already due (seg15 `06b3`). */
export function postRecalc(system: any, hwnd: number, scroll: ClientScroll | null) {
  if (!scroll || scroll.busy || scroll.pending) {
    return;
  }

  scroll.pending = true;
  PostMessage.call(system, hwnd, WM_MDIRECALC, 0, 0);
}

/** The client's own message: its bars recalculated, as it was made with them. */
export async function recalc(system: any, hwnd: number, scroll: ClientScroll) {
  /* A client made with only a horizontal bar never recalculates, and its
   * message stays due: read out, and not recorded. */
  if (scroll.bars === 1) {
    scroll.pending = false;
    await calcChildScroll(system, hwnd, SB_VERT);
  } else if (scroll.bars === 3) {
    scroll.pending = false;
    await calcChildScroll(system, hwnd, SB_BOTH);
  }
}

/**
 * Worked out from a program's own call.
 *
 * @param {Types.HWND} hwnd - The MDI client.
 * @param {Types.INT} nBar - `SB_HORZ`, `SB_VERT` or `SB_BOTH`.
 */
export async function CalcChildScroll(this: any, hwnd: number, nBar: number) {
  await calcChildScroll(this, hwnd, (nBar << 16) >> 16);
}

/**
 * Scrolled from a program's own call, as the client does for its bar's
 * messages.
 *
 * @param {Types.HWND} hwnd - The MDI client.
 * @param {Types.UINT} uMsg - `WM_HSCROLL` or `WM_VSCROLL`.
 * @param {Types.WPARAM} wParam - The scroll bar's code.
 * @param {Types.LPARAM} lParam - The thumb's position in its low word.
 */
export async function ScrollChildren(
  this: any,
  hwnd: number,
  uMsg: number,
  wParam: number,
  lParam: number
) {
  await scrollChildren(this, hwnd, uMsg, wParam, lParam);
}
