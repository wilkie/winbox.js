'use strict';

import { RasterWindow } from './raster-window.js';
import { EnableWindow } from './window-queries.js';
import { ShowWindow } from './ShowWindow.js';
import { changeFrame } from './window-state.js';
import { User } from '../user.js';

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
 *
 * A scroll bar control, `SB_CTL`, keeps the same in itself, starting at the
 * range 0 to 0.
 */
export const SB_HORZ = 0;
export const SB_VERT = 1;
export const SB_CTL = 2;
export const SB_BOTH = 3;

export interface ScrollState {
  min: number;
  max: number;
  pos: number;

  /** The arrows turned off: 1 the top or left, 2 the bottom or right. */
  flags: number;
}

/** A window's scroll bar's state, made with the range 0 to 100 at 0. */
export function scrollState(window: any, bar: number): ScrollState | null {
  if (!window || (bar !== SB_HORZ && bar !== SB_VERT)) {
    return null;
  }

  window.scroll ??= {};

  const key = bar === SB_VERT ? 'vertical' : 'horizontal';

  window.scroll[key] ??= { min: 0, max: 100, pos: 0, flags: 0 };

  return window.scroll[key];
}

const WS_VSCROLL = 0x00200000;
const WS_HSCROLL = 0x00100000;

function windowOf(system: any, hwnd: number) {
  const window = system.handles.resolve(hwnd);

  return window instanceof RasterWindow ? window : null;
}

/** A scroll bar control's own state. */
function controlState(window: RasterWindow | null): ScrollState | null {
  const control: any = window?.window.control;

  if (control?.className !== 'SCROLLBAR') {
    return null;
  }

  // Made disabled, it is made with both arrows off (seg18 `0951`).
  control.scroll ??= { min: 0, max: 0, pos: 0, flags: window!.window.style & 0x08000000 ? 3 : 0 };

  return control.scroll;
}

function stateOf(system: any, hwnd: number, bar: number) {
  const window = windowOf(system, hwnd);

  if (bar === SB_CTL) {
    return controlState(window);
  }

  return window ? scrollState(window.window, bar) : null;
}

function styleBit(bar: number) {
  return bar === SB_VERT ? WS_VSCROLL : WS_HSCROLL;
}

function clamp(state: ScrollState) {
  state.pos = Math.min(Math.max(state.min, state.pos), state.max);
}

function redraw(system: any, hwnd: number, bar = SB_VERT) {
  const window = windowOf(system, hwnd);

  if (!window) {
    return;
  }

  if (bar === SB_CTL) {
    window.window.needsErase = true;
    window.window.needsPaint = true;
    window.desktop.paintControl(window.window);
  } else {
    window.desktop.paintFrame(window.window);
  }
}

/** Sets a scroll bar's position, kept within its range; answers the position before. */
export function SetScrollPos(hwnd, nBar, nPos, fRedraw) {
  const window = windowOf(this, hwnd);
  const state = stateOf(this, hwnd, nBar);

  if (!window || !state || (nBar !== SB_CTL && !(window.window.style & styleBit(nBar)))) {
    return 0;
  }

  const was = state.pos;

  state.pos = (nPos << 16) >> 16;
  clamp(state);

  if (fRedraw) {
    redraw(this, hwnd, nBar);
  }

  return was;
}

export function GetScrollPos(hwnd, nBar) {
  return stateOf(this, hwnd, nBar)?.pos ?? 0;
}

/**
 * Sets a scroll bar's range, its position kept within it; equal ends take
 * the bar away and others bring it. **Recorded** by `showsb`: a window's bar
 * comes and goes whether or not it was asked to redraw, with the messages
 * of a frame that changed (`changeFrame`).
 */
export async function SetScrollRange(hwnd, nBar, nMinPos, nMaxPos, fRedraw) {
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

  if (nBar === SB_CTL) {
    if (fRedraw) {
      redraw(this, hwnd, nBar);
    }

    return;
  }

  const shown = window.window;
  const had = (shown.style & styleBit(nBar)) !== 0;
  const has = min !== max;

  if (had !== has) {
    await changeFrame(
      this,
      hwnd,
      window,
      has ? shown.style | styleBit(nBar) : shown.style & ~styleBit(nBar)
    );
    return;
  }

  if (fRedraw) {
    redraw(this, hwnd);
  }
}
/**
 * Shows or hides a window's own scroll bars, `SB_HORZ`, `SB_VERT` or both,
 * `SB_BOTH`; or with `SB_CTL`, a scroll bar control itself, as `ShowWindow`
 * does. It answers nothing.
 *
 * **Recorded** by `showsb`: a window's bar shown or hidden is its style's
 * bit set or cleared, and its frame laid out again with the messages of
 * `changeFrame`; asking for what it already has sends nothing. The range
 * and position are kept, and the thumb shows them again.
 */
export async function ShowScrollBar(this: any, hwnd: number, wBar: number, fShow: number) {
  const window = windowOf(this, hwnd);

  if (!window) {
    return;
  }

  if (wBar === SB_CTL) {
    await ShowWindow.call(this, hwnd, fShow ? User.SW_SHOW : User.SW_HIDE);
    return;
  }

  const bits =
    wBar === SB_BOTH ? WS_VSCROLL | WS_HSCROLL : wBar === SB_VERT ? WS_VSCROLL : WS_HSCROLL;
  const style = fShow ? window.window.style | bits : window.window.style & ~bits;

  await changeFrame(this, hwnd, window, style);
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

const ESB_DISABLE_BOTH = 3;
const WS_DISABLED = 0x08000000;

/**
 * Turns a scroll bar's arrows off and on (`USER.EXE` seg18 `017c`, `0074`):
 * `wArrows` 1 the top or left, 2 the bottom or right, 3 both, 0 neither.
 *
 * A window's own bars keep the arrows turned off, and answer whether any
 * changed; a bar that shows is drawn again at once.
 *
 * A scroll bar control with both arrows off is a disabled window. Asked for
 * what it has, it answers 0. Asked for both off -- or for the one arrow that
 * makes both -- it is disabled with `EnableWindow`, and all on again from
 * both off, enabled; its `WM_ENABLE` then sets the arrows to all off or all
 * on (seg18 `0a67`). The answer is then made from what `EnableWindow`
 * answered, whether it had been disabled: if it had, 1 for enabled now; if
 * not, the disabled style bit as a byte, 8. Any other change turns the arrows
 * off one by one, or all on, and answers 1 (seg18 `0031`); an arrow off stays
 * off until all are turned on. **Recorded** by `noscroll`: 1, 8, 0, 0 and 1
 * for the top arrow, the bottom, both, both again and neither.
 */
export async function EnableScrollBar(this: any, hwnd: number, wSB: number, wArrows: number) {
  const window = windowOf(this, hwnd);

  if (!window || wSB > 3 || wArrows & ~3) {
    return 0;
  }

  if (wSB === SB_CTL) {
    const state = controlState(window);

    if (!state) {
      return 0;
    }

    const old = state.flags & 3;

    if (old === wArrows) {
      return 0;
    }

    const disable = wArrows === ESB_DISABLE_BOTH || (wArrows !== 0 && (old | wArrows) === 3);
    const enable = wArrows === 0 && old === 3;

    if (!disable && !enable) {
      state.flags = wArrows === 0 ? 0 : old | wArrows;
      redraw(this, hwnd, SB_CTL);
      return 1;
    }

    const was = await EnableWindow.call(this, hwnd, enable ? 1 : 0);
    const disabled = (window.window.style & WS_DISABLED) !== 0;

    return was ? (disabled ? 0 : 1) : disabled ? 8 : 0;
  }

  let changed = 0;

  for (const bar of [SB_HORZ, SB_VERT]) {
    if (wSB !== bar && wSB !== 3) {
      continue;
    }

    const state = scrollState(window.window, bar)!;
    const flags = wArrows === 0 ? 0 : state.flags | wArrows;

    if (flags !== state.flags) {
      state.flags = flags;
      changed = 1;
    }
  }

  if (changed && window.window.style & (WS_VSCROLL | WS_HSCROLL)) {
    redraw(this, hwnd);
  }

  return changed;
}

/** A scroll bar control's arrows, set by its `WM_ENABLE`: all off when disabled, all on when enabled. */
export function enableScrollControl(system: any, hwnd: number, enabled: boolean) {
  const state = controlState(windowOf(system, hwnd));

  if (state) {
    state.flags = enabled ? 0 : 3;
    redraw(system, hwnd, SB_CTL);
  }
}
