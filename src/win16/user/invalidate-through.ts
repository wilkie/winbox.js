'use strict';

import { ClipRegion } from '../../raster/clip-region.js';

import type { Desktop, DesktopWindow } from './desktop.js';

/**
 * USER's own invalidation of a region of the screen through a window and
 * the windows in it, as `InvalidateRect`, `InvalidateRgn`, `ValidateRect`,
 * `ValidateRgn`, `ScrollWindow`, `ScrollWindowEx` and the end of
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
 *   and for its parent; where nothing is left, the walk ends (`4190`-`41f5`).
 *
 * * Validating, a window's rectangle is neither cut nor asked against the
 *   region (`4052`, `40aa`); the windows in it are walked the same way.
 *
 * The desktop's own part, what is left of the region where no window
 * shows, is its background, drawn at once.
 */

export const RDW_INVALIDATE = 0x0001;
export const RDW_ERASE = 0x0004;
export const RDW_VALIDATE = 0x0008;
export const RDW_NOCHILDREN = 0x0040;
export const RDW_ALLCHILDREN = 0x0080;
export const RDW_FRAME = 0x0400;

/** USER's own: a window walked as one in another, whose rectangle may be taken out (`403d`). */
const WALKED = 0x2000;

const WS_MINIMIZE = 0x20000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_CLIPCHILDREN = 0x02000000;

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
  /* Validating, the window's rectangle is neither cut nor asked against the
   * region (`4052`, `40aa`). */
  const rect = flags & RDW_INVALIDATE ? cut(windowRect(window), within) : windowRect(window);

  if (flags & RDW_INVALIDATE) {
    if (isEmpty(rect) && !whole) {
      return true;
    }

    if (!whole) {
      const how = covers(state.region, rect);

      if (how === 0) {
        return true;
      }

      whole = how === 2;
    }
  }

  const give = () => {
    if (flags & RDW_INVALIDATE) {
      desktop.dueThrough(
        window,
        whole ? null : state.region,
        (flags & RDW_ERASE) !== 0,
        (flags & RDW_FRAME) !== 0
      );
    } else if (flags & RDW_VALIDATE) {
      desktop.validThrough(window, whole ? null : state.region);
    }
  };

  if (!(window.style & WS_CLIPCHILDREN)) {
    give();
  }

  const children = childrenOf(desktop, window).filter((child) => child.visible);

  if (
    children.length &&
    !minimized(window) &&
    !(flags & RDW_NOCHILDREN) &&
    (flags & RDW_ALLCHILDREN || !(window.style & WS_CLIPCHILDREN))
  ) {
    const inner = flags | WALKED | (flags & RDW_INVALIDATE ? RDW_ERASE | RDW_FRAME : 0);
    const inside = cut(rect, clientRect(window));

    if (!isEmpty(inside) || whole) {
      for (const child of children) {
        if (!walk(state, child, whole, inside, inner)) {
          return false;
        }
      }
    }
  }

  if (window.style & WS_CLIPCHILDREN) {
    give();
  }

  return taken(state, window, rect, flags);
}

/**
 * A window walked as one in another, with `WS_CLIPSIBLINGS`, whose parent
 * has `WS_CLIPCHILDREN`, takes its rectangle out of the region (`4190`-
 * `41f5`): false where nothing is left.
 */
function taken(state: Walk, window: DesktopWindow, rect: Rect, flags: number) {
  const parentClips = window.parent ? !!(window.parent.style & WS_CLIPCHILDREN) : true;

  if (flags & WALKED && window.style & WS_CLIPSIBLINGS && (flags & RDW_VALIDATE || parentClips)) {
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
    const inner = flags | WALKED | (flags & RDW_INVALIDATE ? RDW_ERASE | RDW_FRAME : 0);
    const shown = childrenOf(desktop, null).filter((one) => one.visible);

    /* With `RDW_NOCHILDREN` the windows at the top are not walked (`40e8`):
     * the desktop is given the region, and draws only where none of them
     * is, having `WS_CLIPCHILDREN`. */
    if (flags & RDW_NOCHILDREN) {
      state.region = shown.reduce(
        (left, one) => left.subtract(regionOf(windowRect(one))),
        state.region
      );
    } else {
      for (const child of shown) {
        if (!walk(state, child, whole, screen, inner)) {
          return;
        }
      }
    }

    /* The desktop, which has `WS_CLIPCHILDREN`, given what is left. */
    for (const band of state.region.bands) {
      for (const [left, right] of band.spans) {
        desktop.paintBackground(left, band.top, right, band.bottom);
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
 * it and every window it is in shown, none of those minimized. (A window
 * itself minimized counts, where a bit of its own at 26h, not followed,
 * does not ask its class's icon: `3e35`-`3e46`.)
 */
function showsFor(window: DesktopWindow) {
  for (let up: DesktopWindow | null = window; up; up = up.parent) {
    if (!up.visible || (up !== window && minimized(up))) {
      return false;
    }
  }

  return true;
}

/**
 * `RedrawWindow`'s body for `InvalidateRect`, `InvalidateRgn`,
 * `ValidateRect` and `ValidateRgn` (`USER.EXE` seg1 `3e1e`, their bodies at
 * `011c`-`0176` passing `RDW_INVALIDATE`, with `RDW_ERASE` to erase, or
 * `RDW_VALIDATE`): nothing for a window that does not show; else a region
 * of the screen, or all of the window for null, made due or valid through
 * it and the windows in it (`3ed7`). `told` is what is made due, in its
 * client area's terms, for the lock (`3f41`-`3f7c`).
 */
export function redrawThrough(
  desktop: Desktop,
  window: DesktopWindow,
  region: ClipRegion | null,
  flags: number,
  told: () => void
) {
  if (!showsFor(window)) {
    return;
  }

  if (flags & RDW_INVALIDATE) {
    told();
  }

  invalidateThrough(desktop, window, region, flags);
}
