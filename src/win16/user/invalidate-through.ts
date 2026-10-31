'use strict';

import { ClipRegion } from '../../raster/clip-region.js';

import { windowVersion } from '../module.js';
import { paintsIcon } from './paint-icon.js';

import type { Desktop, DesktopWindow } from './desktop.js';

/**
 * USER's own invalidation of a region of the screen through a window and
 * the windows in it, as `RedrawWindow`, `InvalidateRect`, `InvalidateRgn`,
 * `ValidateRect`, `ValidateRgn`, `ScrollWindow`, `ScrollWindowEx` and the end of
 * `LockWindowUpdate` make it (`USER.EXE` seg1 `3e1e`, `3ed7`, its walk
 * `4034` and what each window is given `4202`, or validated `4309`). Twin of
 * `crates/winbox-win16/src/invalidate_through.rs`. **Read out**:
 *
 * * A window is passed over where its rectangle, cut to the client areas
 *   it is in, is empty, or meets nothing of the region (`4058`-`40a1`,
 *   `486b`). Where the region covers all of it, it is given all of itself
 *   (`40a4`-`40c4`), and so are the windows in it.
 * * A window is given the region whole, not cut to itself (`42e9`): its
 *   update region's box is what `GetUpdateRect` cuts to its client area.
 *   One due all of itself stays so (`4274`). `RDW_ERASE` marks it to be
 *   erased (`4260`), `RDW_FRAME` its frame (`426a`).
 * * Without `WS_CLIPCHILDREN` it is given the region before the windows in
 *   it, with it after them (`40c9`, `4180`).
 * * The windows in it are walked, front to back, where it has any, is not
 *   minimized, `RDW_NOCHILDREN` is not given, and `RDW_ALLCHILDREN` is or
 *   it has no `WS_CLIPCHILDREN` (`40e8`-`410a`); each of them is told to
 *   erase and draw its frame too (`4112`). One with `WS_CLIPSIBLINGS` whose
 *   parent has `WS_CLIPCHILDREN` -- every window at the top, the desktop
 *   having it -- takes its rectangle out of the region for those behind it
 *   and for its parent, unless it has `WS_EX_TRANSPARENT`; where nothing is
 *   left, the walk ends (`4190`-`41f5`), or with `RDW_INTERNALPAINT` or
 *   `RDW_NOINTERNALPAINT` goes on with those alone (`415e`-`416c`).
 * * A window of a program made before 3.10 whose rectangle, or client area,
 *   cut, is empty is still given all of itself (`406e`-`4084`,
 *   `4117`-`4139`); one made for 3.10 is passed over. What each is given,
 *   flag by flag, is `give` (`4202`; [[probe:rdwwalk]], [[probe:rdw31]]).
 *
 * * Validating, a window's rectangle is neither cut nor asked against the
 *   region (`4052`, `40aa`); the windows in it are walked the same way.
 *
 * The desktop's own part, what is left of the region where no window
 * shows, is its background, drawn at once.
 */

export const RDW_INVALIDATE = 0x0001;
export const RDW_INTERNALPAINT = 0x0002;
export const RDW_ERASE = 0x0004;
export const RDW_VALIDATE = 0x0008;
export const RDW_NOINTERNALPAINT = 0x0010;
export const RDW_NOERASE = 0x0020;
export const RDW_NOCHILDREN = 0x0040;
export const RDW_ALLCHILDREN = 0x0080;
export const RDW_UPDATENOW = 0x0100;
export const RDW_ERASENOW = 0x0200;
export const RDW_FRAME = 0x0400;
export const RDW_NOFRAME = 0x0800;

/** USER's own: a window walked as one in another, whose rectangle may be taken out (`403d`). */
const WALKED = 0x2000;

/** What is left once the region is used up, where a paint of its own is asked (`4167`). */
const INTERNAL_ONLY = ~(
  RDW_INVALIDATE |
  RDW_ERASE |
  RDW_VALIDATE |
  RDW_NOERASE |
  RDW_FRAME |
  RDW_NOFRAME
);

const WS_MINIMIZE = 0x20000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_CLIPCHILDREN = 0x02000000;
const WS_EX_TRANSPARENT = 0x00000020;

/**
 * USER's bit 4 of the byte at 26h of a window: made by a module marked for
 * Windows 3.10 or later, set by `CreateWindow` where `GetExpWinVer` answers
 * 30Ah or more (`USER.EXE` seg8 `0425`-`0432`).
 */
export function madeFor31(desktop: Desktop, window: DesktopWindow) {
  const system = desktop.system;
  const dialog = window.hwnd ? system?.handles?.resolve(window.hwnd) : null;

  return !dialog || windowVersion(system, dialog) >= 0x30a;
}

type Rect = [number, number, number, number];

const cut = (a: Rect, b: Rect): Rect => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.min(a[3], b[3]),
];
const isEmpty = (r: Rect) => r[2] <= r[0] || r[3] <= r[1];
const regionOf = (r: Rect) => ClipRegion.rect(r[0], r[1], r[2], r[3]);

const windowRect = (window: DesktopWindow): Rect => [
  window.left,
  window.top,
  window.left + window.width,
  window.top + window.height,
];

export const clientRect = (window: DesktopWindow): Rect => [
  window.left + window.client.left,
  window.top + window.client.top,
  window.left + window.client.right,
  window.top + window.client.bottom,
];

const minimized = (window: DesktopWindow) =>
  window.state === 'minimized' || !!(window.style & WS_MINIMIZE);

/** What the region covers of a rectangle (seg1 `486b`): 0 nothing, 2 all of it, 1 some. */
function covers(region: ClipRegion, rect: Rect) {
  const part = region.intersect(regionOf(rect));

  if (part.kind === 1) {
    return 0;
  }

  const box = part.box;

  return part.kind === 2 &&
    box.left === rect[0] &&
    box.top === rect[1] &&
    box.right === rect[2] &&
    box.bottom === rect[3]
    ? 2
    : 1;
}

/** A window's children, front to back. */
function childrenOf(desktop: Desktop, parent: DesktopWindow | null) {
  return desktop.windows.filter((other) => other.parent === parent);
}

interface Walk {
  desktop: Desktop;
  /** The region, which windows with `WS_CLIPSIBLINGS` take their rectangles out of. */
  region: ClipRegion;
}

/** One window and the windows in it (seg1 `4034`): false where nothing of the region is left. */
function walk(
  state: Walk,
  window: DesktopWindow,
  whole: boolean,
  within: Rect,
  flags: number
): boolean {
  const { desktop } = state;
  const for31 = madeFor31(desktop, window);
  /* Validating, the window's rectangle is neither cut nor asked against the
   * region (`4052`, `40aa`). */
  const rect = flags & RDW_INVALIDATE ? cut(windowRect(window), within) : windowRect(window);
  /* The flags the windows in it are walked with: these, and walked (`403d`). */
  let inner = flags | WALKED;

  if (flags & RDW_INVALIDATE) {
    /* Nothing of it within the windows it is in: passed over, but for a
     * window of a program made before 3.10 given all of itself, which then
     * takes nothing out of the region (`406e`-`4084`). */
    if (isEmpty(rect)) {
      if (for31 || !whole) {
        return true;
      }

      flags &= ~WALKED;
      inner &= ~WALKED;
    }

    if (!whole) {
      const how = covers(state.region, rect);

      if (how === 0) {
        return true;
      }

      whole = how === 2;
    }
  }

  if (!(window.style & WS_CLIPCHILDREN)) {
    give(state, window, whole, flags, for31);
  }

  const children = childrenOf(desktop, window).filter((child) => child.visible);

  if (
    children.length &&
    !minimized(window) &&
    !(flags & RDW_NOCHILDREN) &&
    (flags & RDW_ALLCHILDREN || !(window.style & WS_CLIPCHILDREN))
  ) {
    if (flags & RDW_INVALIDATE) {
      inner |= RDW_ERASE | RDW_FRAME;
    }

    const inside = cut(rect, clientRect(window));

    /* Nothing of its client area: the windows in it are passed over, but
     * for a window of a program made before 3.10 given all of itself
     * (`4117`-`4139`). */
    if (!isEmpty(inside) || (whole && !for31)) {
      for (const child of children) {
        if (!walk(state, child, whole, inside, inner)) {
          /* The region used up: the rest still walked for their paints of
           * their own where those are asked, nothing else (`415e`-`416c`). */
          if (!(flags & (RDW_INTERNALPAINT | RDW_NOINTERNALPAINT))) {
            return false;
          }

          flags &= INTERNAL_ONLY;
          inner &= INTERNAL_ONLY & ~WALKED;
        }
      }
    }
  }

  if (window.style & WS_CLIPCHILDREN) {
    give(state, window, whole, flags, for31);
  }

  return taken(state, window, rect, flags);
}

/**
 * One window given the region, all of itself where `whole` (seg1 `4202`).
 * **Read out**:
 *
 * * Made due, where `RDW_INVALIDATE`, `RDW_INTERNALPAINT`, `RDW_ERASE` or
 *   `RDW_FRAME` is given (`4221`); else validated (`4309`). Both given, it
 *   is made due alone.
 * * `RDW_INTERNALPAINT` gives it a paint of its own (`422b`).
 * * `RDW_ERASE` and `RDW_FRAME` count only with `RDW_INVALIDATE` (`4235`).
 *   All of a window of a program made before 3.10 made due without
 *   `RDW_ERASE` takes back an erase it was due (`4250`-`425c`).
 * * Validating: `RDW_NOINTERNALPAINT` takes its paint of its own off
 *   (`4323`); with `RDW_VALIDATE` alone, `RDW_NOERASE` its erase (`4334`)
 *   and `RDW_NOFRAME` its frame (`433d`), before what is validated is cut
 *   from what it is due (`434a`).
 */
function give(state: Walk, window: DesktopWindow, whole: boolean, flags: number, for31: boolean) {
  const { desktop } = state;
  const shown: any = window;

  if (flags & (RDW_INVALIDATE | RDW_INTERNALPAINT | RDW_ERASE | RDW_FRAME)) {
    if (flags & RDW_INTERNALPAINT) {
      window.internalPaint = true;
    }

    if (flags & RDW_INVALIDATE) {
      if (whole && !for31) {
        window.needsErase = false;
      }

      desktop.dueThrough(
        window,
        whole ? null : state.region,
        (flags & RDW_ERASE) !== 0,
        (flags & RDW_FRAME) !== 0
      );
    }

    return;
  }

  if (flags & RDW_NOINTERNALPAINT) {
    window.internalPaint = false;
  }

  if (flags & RDW_VALIDATE) {
    if (flags & RDW_NOERASE) {
      window.needsErase = false;
    }

    if (flags & RDW_NOFRAME) {
      shown.needsNcPaint = false;
      shown.needsFrame = false;
    }

    desktop.validThrough(window, whole ? null : state.region);
  }
}

/**
 * A window walked as one in another, with `WS_CLIPSIBLINGS`, whose parent
 * has `WS_CLIPCHILDREN`, takes its rectangle out of the region (`4190`-
 * `41f5`): false where nothing is left.
 */
function taken(state: Walk, window: DesktopWindow, rect: Rect, flags: number) {
  const parentClips = window.parent ? !!(window.parent.style & WS_CLIPCHILDREN) : true;

  /* Not a window with `WS_EX_TRANSPARENT` (`4196`). */
  if (
    flags & WALKED &&
    !(window.exStyle & WS_EX_TRANSPARENT) &&
    window.style & WS_CLIPSIBLINGS &&
    (flags & RDW_VALIDATE || parentClips)
  ) {
    state.region = state.region.subtract(regionOf(rect));

    return state.region.kind !== 1;
  }

  return true;
}

/**
 * A region of the screen made due in a window and those in it, by `flags`
 * (`RDW_` bits): through the desktop for `window` null, its own part drawn
 * at once. `region` null is all of the window: its client area, or with
 * `RDW_FRAME` all of it (seg1 `3f09`-`3f24`, `16b7`).
 */
export function invalidateThrough(
  desktop: Desktop,
  window: DesktopWindow | null,
  region: ClipRegion | null,
  flags: number
) {
  const screen: Rect = [0, 0, desktop.screen.width, desktop.screen.height];

  if (!window) {
    const state: Walk = { desktop, region: region ?? regionOf(screen) };
    const whole = !region;
    let inner = flags | WALKED | (flags & RDW_INVALIDATE ? RDW_ERASE | RDW_FRAME : 0);
    const shown = childrenOf(desktop, null).filter((one) => one.visible);

    /* The windows at the top are walked only with `RDW_ALLCHILDREN`, the
     * desktop having `WS_CLIPCHILDREN`, and not with `RDW_NOCHILDREN`
     * (`40e8`-`410a`): else the desktop is given the region, and draws only
     * where none of them is. */
    if (flags & RDW_NOCHILDREN || !(flags & RDW_ALLCHILDREN)) {
      state.region = shown.reduce(
        (left, one) => left.subtract(regionOf(windowRect(one))),
        state.region
      );
    } else {
      for (const child of shown) {
        if (!walk(state, child, whole, screen, inner)) {
          if (!(flags & (RDW_INTERNALPAINT | RDW_NOINTERNALPAINT))) {
            return;
          }

          flags &= INTERNAL_ONLY;
          inner &= INTERNAL_ONLY & ~WALKED;
        }
      }
    }

    /* The desktop, which has `WS_CLIPCHILDREN`, given what is left: made
     * due, drawn at once. */
    if (flags & RDW_INVALIDATE) {
      for (const band of state.region.bands) {
        for (const [left, right] of band.spans) {
          desktop.paintBackground(left, band.top, right, band.bottom);
        }
      }
    }

    return;
  }

  const own = flags & RDW_FRAME ? windowRect(window) : clientRect(window);
  const within = cutToParents(window, own);

  /* Made due, nothing where the window or a window it is in is hidden, or
   * one it is in minimized (seg1 `3f27`-`3f3e`, `8bb3`). */
  if (!within && flags & RDW_INVALIDATE) {
    return;
  }

  const state: Walk = { desktop, region: region ?? regionOf(own) };

  walk(state, window, !region, within ?? own, flags);
}

/**
 * A rectangle of the screen cut to the client area of each window a window
 * is in (seg1 `8bb3`): null where the window or one of them is hidden, or
 * one of them minimized. An empty rectangle is not null.
 */
export function cutToParents(window: DesktopWindow, rect: Rect): Rect | null {
  if (!window.visible) {
    return null;
  }

  let out = rect;

  for (let up = window.parent; up; up = up.parent) {
    if (!up.visible || minimized(up)) {
      return null;
    }

    out = cut(out, clientRect(up));
  }

  return out;
}

/**
 * Whether a window shows for `RedrawWindow`'s body (seg1 `3e4a`, `1c5f`):
 * it and every window it is in shown, none of those minimized. The window
 * itself minimized counts, but for its client area alone -- asked for a
 * window of a program made for 3.10 or later without `RDW_FRAME`
 * (`3e35`-`3e46`) -- where its class has an icon (`1c7e`-`1c8c`).
 */
function showsFor(desktop: Desktop, window: DesktopWindow, client: boolean) {
  for (let up: DesktopWindow | null = window; up; up = up.parent) {
    if (!up.visible || (up !== window && minimized(up))) {
      return false;
    }
  }

  return !(client && minimized(window) && window.hwnd && paintsIcon(desktop.system, window.hwnd));
}

/**
 * `RedrawWindow`'s body (`USER.EXE` seg1 `3e1e`), as `RedrawWindow`,
 * `InvalidateRect`, `InvalidateRgn`, `ValidateRect` and `ValidateRgn` call
 * it (their bodies at `011c`-`0176` passing `RDW_INVALIDATE`, with
 * `RDW_ERASE` to erase, or `RDW_VALIDATE`): nothing for a window that does
 * not show; else a region of the screen, or all of the window for null,
 * made due or valid through it and the windows in it (`3ed7`). `told` is
 * what is made due, in its client area's terms, for the lock
 * (`3f41`-`3f7c`). False where the window does not show: nothing is
 * painted now either.
 */
export function redrawThrough(
  desktop: Desktop,
  window: DesktopWindow,
  region: ClipRegion | null,
  flags: number,
  told: () => void
) {
  if (!showsFor(desktop, window, !(flags & RDW_FRAME) && madeFor31(desktop, window))) {
    return false;
  }

  if (flags & RDW_INVALIDATE) {
    told();
  }

  invalidateThrough(desktop, window, region, flags);

  return true;
}
