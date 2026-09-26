'use strict';

import { RasterWindow } from './raster-window.js';

/**
 * A window's own scroll bars, the ones `WS_VSCROLL` and `WS_HSCROLL` give
 * it: a range and a position for each, which the thumb shows.
 *
 * **Read out of `USER.EXE`** (seg18 `0d67`, `0ed9`, `0f16`, `1900`):
 *
 * * A window's bars start at the range 0 to 100, at 0.
 * * A position is kept to the range, `min(max(min, pos), max)`, after every
 *   change of either; `SetScrollPos` answers the position before, and on a
 *   bar the window's style does not have stores nothing and answers 0.
 * * A range whose span does not fit a signed word, which includes a minimum
 *   above the maximum, is ignored. A range whose ends are equal takes the
 *   bar away, and any other gives the window the bar if it had none; the
 *   window is laid out again either way.
 *
 * **Recorded** by `mledit`, whose thumbs a multi-line edit control places.
 */
export const SB_HORZ = 0;
export const SB_VERT = 1;
export const SB_CTL = 2;

export interface ScrollState {
  min: number;
  max: number;
  pos: number;
}

/** A window's scroll bar's state, made with the range 0 to 100 at 0. */
export function scrollState(window: any, bar: number): ScrollState | null {
  if (!window || (bar !== SB_HORZ && bar !== SB_VERT)) {
    return null;
  }

  window.scroll ??= {};

  const key = bar === SB_VERT ? 'vertical' : 'horizontal';

  window.scroll[key] ??= { min: 0, max: 100, pos: 0 };

  return window.scroll[key];
}

const WS_VSCROLL = 0x00200000;
const WS_HSCROLL = 0x00100000;

function windowOf(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  return window instanceof RasterWindow ? window : null;
}

function stateOf(system: any, hwnd: number, bar: number) {
  const window = windowOf(system, hwnd);

  return window ? scrollState(window.window, bar) : null;
}

function styleBit(bar: number) {
  return bar === SB_VERT ? WS_VSCROLL : WS_HSCROLL;
}

function clamp(state: ScrollState) {
  state.pos = Math.min(Math.max(state.min, state.pos), state.max);
}

function redraw(system: any, hwnd: number) {
  const window = windowOf(system, hwnd);

  if (window) {
    window.desktop.paintFrame(window.window);
  }
}

/** Sets a scroll bar's position, kept within its range; answers the position before. */
export function SetScrollPos(hwnd, nBar, nPos, fRedraw) {
  const window = windowOf(this, hwnd);
  const state = stateOf(this, hwnd, nBar);

  if (!window || !state || !(window.window.style & styleBit(nBar))) {
    return 0;
  }

  const was = state.pos;

  state.pos = (nPos << 16) >> 16;
  clamp(state);

  if (fRedraw) {
    redraw(this, hwnd);
  }

  return was;
}

export function GetScrollPos(hwnd, nBar) {
  return stateOf(this, hwnd, nBar)?.pos ?? 0;
}

/**
 * Sets a scroll bar's range, its position kept within it; equal ends take
 * the bar away and others bring it.
 */
export function SetScrollRange(hwnd, nBar, nMinPos, nMaxPos, fRedraw) {
  const window = windowOf(this, hwnd);
  const state = stateOf(this, hwnd, nBar);
  const min = (nMinPos << 16) >> 16;
  const max = (nMaxPos << 16) >> 16;

  if (!window || !state || ((max - min) & 0xffff) > 0x7fff) {
    return;
  }

  state.min = min;
  state.max = max;
  clamp(state);

  const shown = window.window;
  const had = (shown.style & styleBit(nBar)) !== 0;
  const has = min !== max;

  if (had !== has) {
    shown.style = has ? shown.style | styleBit(nBar) : shown.style & ~styleBit(nBar);
    window.desktop.place(shown, shown.left, shown.top, shown.width, shown.height);
    return;
  }

  if (fRedraw) {
    redraw(this, hwnd);
  }
}
/** A scroll bar's range, into two integers a program points to. */
export function GetScrollRange(hwnd, nBar, lpMinPos, lpMaxPos) {
  const state = stateOf(this, hwnd, nBar);
  const core = this.machine.cpu.core;
  const put = (far: number, value: number) => {
    if (far) {
      core.write16((far >>> 16) & 0xffff, far & 0xffff, value & 0xffff);
    }
  };

  put(lpMinPos, state?.min ?? 0);
  put(lpMaxPos, state?.max ?? 0);
}
