'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { Surface, type VisibleSource } from '../../raster/surface.js';

import type { Desktop, DesktopWindow } from './desktop.js';
import { RasterWindow } from './raster-window.js';

/**
 * USER's rule for a window's visible region, and the flags `GetDCEx` works
 * it out by (`USER.EXE` seg1 `1582`, `1612`, `847b`-`854c`): what a device
 * context USER hands out may draw on, in the screen's terms, given to GDI
 * as `SelectVisRgn` and `SetDCOrg` would (`kb/topics/visible-regions.md`,
 * phase 2). Twin of `crates/winbox-win16/src/window_vis.rs`.
 */

export const DCX_WINDOW = 0x00000001;
export const DCX_CACHE = 0x00000002;
export const DCX_CLIPCHILDREN = 0x00000008;
export const DCX_CLIPSIBLINGS = 0x00000010;
export const DCX_PARENTCLIP = 0x00000020;
export const DCX_EXCLUDERGN = 0x00000040;
export const DCX_INTERSECTRGN = 0x00000080;
export const DCX_LOCKWINDOWUPDATE = 0x00000400;
export const DCX_USESTYLE = 0x00010000;

const WS_CLIPCHILDREN = 0x02000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_EX_TRANSPARENT = 0x00000020;
const CS_OWNDC = 0x0020;
const CS_CLASSDC = 0x0040;
const CS_PARENTDC = 0x0080;

/** The class a window was made of, as `RegisterClass` kept it. */
function classOf(system: any, window: DesktopWindow): any {
  const raster = window.hwnd ? system.handles.resolve(window.hwnd) : null;
  const name = raster instanceof RasterWindow ? raster.options?.windowClass : null;

  return name ? system.handles.retrieve(name) : null;
}

/**
 * The flags `GetDCEx` works a region out by, and the window whose region it
 * is (`847b`-`854c`):
 *
 * * With `DCX_USESTYLE`, `DCX_CLIPCHILDREN`, `DCX_CLIPSIBLINGS` and
 *   `DCX_PARENTCLIP` given are dropped and taken from the styles instead
 *   (`8497`): for `DCX_WINDOW`, `DCX_CLIPSIBLINGS` from `WS_CLIPSIBLINGS`
 *   and nothing else (`84f1`); for the client area, `DCX_PARENTCLIP` from
 *   the class's `CS_PARENTDC` (`84a4`), `DCX_CLIPCHILDREN` from
 *   `WS_CLIPCHILDREN` but not while the window is minimized (`84d1`,
 *   `84e5`), `DCX_CLIPSIBLINGS` from `WS_CLIPSIBLINGS`.
 * * With `DCX_PARENTCLIP`, the parent's region (`850d`-`854c`), with the
 *   parent's `WS_CLIPSIBLINGS` as `DCX_CLIPSIBLINGS` and no
 *   `DCX_CLIPCHILDREN` -- unless the parent has `WS_CLIPCHILDREN`, the
 *   flags have `DCX_CLIPCHILDREN` or `DCX_CLIPSIBLINGS`, or one of the two
 *   is visible and the other not. A window at the top's parent is the
 *   desktop, which has `WS_CLIPCHILDREN`: its own region.
 */
export function regionFlags(system: any, window: DesktopWindow, flags: number) {
  if (flags & DCX_USESTYLE) {
    flags &= ~(DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS | DCX_PARENTCLIP);

    if (flags & DCX_WINDOW) {
      if (window.style & WS_CLIPSIBLINGS) {
        flags |= DCX_CLIPSIBLINGS;
      }
    } else {
      const style = classOf(system, window)?.style ?? 0;

      if (style & CS_PARENTDC) {
        flags |= DCX_PARENTCLIP;
      }

      if (window.style & WS_CLIPCHILDREN) {
        flags |= DCX_CLIPCHILDREN;
      }

      if (window.style & WS_CLIPSIBLINGS) {
        flags |= DCX_CLIPSIBLINGS;
      }

      if (window.state === 'minimized') {
        flags &= ~DCX_CLIPCHILDREN;
      }

      if (!(style & (CS_OWNDC | CS_CLASSDC))) {
        flags |= DCX_CACHE;
      }
    }
  }

  let of = window;
  const parent = window.parent;

  if (
    flags & DCX_PARENTCLIP &&
    parent &&
    !(parent.style & WS_CLIPCHILDREN) &&
    !(flags & (DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS)) &&
    parent.visible === window.visible
  ) {
    of = parent;

    if (parent.style & WS_CLIPSIBLINGS) {
      flags |= DCX_CLIPSIBLINGS;
    }
  }

  return { flags, of };
}

/** A window's rectangle on the screen, or its client area's. */
function rectOf(window: DesktopWindow, client: boolean) {
  return client
    ? ClipRegion.rect(
        window.left + window.client.left,
        window.top + window.client.top,
        window.left + window.client.right,
        window.top + window.client.bottom
      )
    : ClipRegion.rect(
        window.left,
        window.top,
        window.left + window.width,
        window.top + window.height
      );
}

/**
 * A region less the window rectangles of `parent`'s visible children above
 * `stop` -- all of them where `stop` is null -- but not those with
 * `WS_EX_TRANSPARENT` (seg1 `16f2`).
 */
function lessChildren(
  desktop: Desktop,
  parent: DesktopWindow | null,
  stop: DesktopWindow | null,
  region: ClipRegion
) {
  for (const other of desktop.windows) {
    if (other === stop) {
      break;
    }

    if (other.parent === parent && other.visible && !(other.exStyle & WS_EX_TRANSPARENT)) {
      region = region.subtract(rectOf(other, false));
    }
  }

  return region;
}

/**
 * Whether a window and the windows it is in show, for its region (seg1
 * `1c5f`): each visible, none minimized but the window itself, and that
 * one only for its whole rectangle or where its class has no icon.
 */
function shows(system: any, window: DesktopWindow, client: boolean) {
  for (let at: DesktopWindow | null = window; at; at = at.parent) {
    if (!at.visible) {
      return false;
    }

    if (at.state === 'minimized' && (at !== window || (client && classOf(system, at)?.hIcon))) {
      return false;
    }
  }

  return true;
}

/** The window `LockWindowUpdate` locked, if one is. */
function lockedWindow(system: any): DesktopWindow | null {
  const lock = system._windowLock;
  const raster = lock ? system.handles.resolve(lock.hwnd) : null;

  return raster instanceof RasterWindow ? raster.window : null;
}

/**
 * A window's visible region by USER's rule (seg1 `1582`), in the screen's
 * terms, for `flags` as `regionFlags` gives them:
 *
 * 1. Nothing where the window or a window it is in is hidden or minimized
 *    (`1c5f`), or where it is within the window `LockWindowUpdate` locked
 *    and `DCX_LOCKWINDOWUPDATE` is not given (`1c12`).
 * 2. The client rectangle of `of` -- the window, or its parent's for
 *    `DCX_PARENTCLIP` -- or its window rectangle with `DCX_WINDOW` (`16b7`).
 * 3. With `DCX_CLIPCHILDREN`, its visible children taken out (`162c`).
 * 4. Then up the parents (`1658`-`16ad`): at each, the visible siblings
 *    above taken out where `DCX_CLIPSIBLINGS` says for the first and the
 *    level's own `WS_CLIPSIBLINGS` after, then the region cut to the
 *    parent's client area (`1774`); the screen for the desktop's.
 */
export function windowRegion(
  system: any,
  desktop: Desktop,
  window: DesktopWindow,
  of: DesktopWindow,
  flags: number
) {
  const client = !(flags & DCX_WINDOW);

  if (!shows(system, window, client)) {
    return ClipRegion.EMPTY;
  }

  const locked = lockedWindow(system);

  if (locked && !(flags & DCX_LOCKWINDOWUPDATE)) {
    for (let at: DesktopWindow | null = window; at; at = at.parent) {
      if (at === locked) {
        return ClipRegion.EMPTY;
      }
    }
  }

  let region = rectOf(of, client);

  if (flags & DCX_CLIPCHILDREN) {
    region = lessChildren(desktop, of, null, region);
  }

  let siblings = !!(flags & DCX_CLIPSIBLINGS);

  for (let level = of; ;) {
    const parent = level.parent;

    if (siblings) {
      region = lessChildren(desktop, parent, level, region);
    }

    region = region.intersect(
      parent
        ? rectOf(parent, true)
        : ClipRegion.rect(0, 0, desktop.screen.width, desktop.screen.height)
    );

    if (!parent || region.kind === 1) {
      return region;
    }

    siblings = !!(parent.style & WS_CLIPSIBLINGS);
    level = parent;
  }
}

/** How a region given to `GetDCEx` is combined with the window's. */
export type Given = { shape: ClipRegion; keep: 'intersect' | 'exclude' } | null;

/**
 * USER's rule given to a context it hands out for a window, as
 * `SelectVisRgn` of the region worked out and `SetDCOrg` of the window's
 * corner (`86b2`-`86cd`; the origin is the surface's own view's): the
 * region worked out again whenever the windows change, as USER's hook
 * does for a context in use (seg1 `8a00`). A region `GetDCEx` was given,
 * in the screen's terms, intersected or taken out after (`86e7`-`87a0`).
 */
export function selectWindowRegion(
  system: any,
  surface: Surface,
  window: DesktopWindow,
  flags: number,
  given: Given = null
) {
  const { flags: used, of } = regionFlags(system, window, flags);

  select(system, surface, window, of, used, given);
}

/** What a context's region is worked out from: the rule's terms, and the region given. */
type Source = VisibleSource & {
  window: DesktopWindow;
  of: DesktopWindow;
  flags: number;
  given: Given;
};

function select(
  system: any,
  surface: Surface,
  window: DesktopWindow,
  of: DesktopWindow,
  used: number,
  given: Given
) {
  const desktop: Desktop | undefined = system.rasterDesktop;

  if (!desktop || !(surface instanceof Surface)) {
    return;
  }

  let stamp = -1;
  const source: Source = {
    window,
    of,
    flags: used,
    given,
    region() {
      stamp = desktop.generation;

      /* A window destroyed since has nothing. */
      if (!desktop.windows.includes(window) || !desktop.windows.includes(of)) {
        return ClipRegion.EMPTY;
      }

      const region = windowRegion(system, desktop, window, of, used);

      if (!given) {
        return region;
      }

      return given.keep === 'intersect'
        ? region.intersect(given.shape)
        : region.subtract(given.shape);
    },
    current() {
      return stamp === desktop.generation;
    },
  };

  surface.dcOrigin = null;
  surface.visFrom = source;
}

/**
 * A region given to `GetDCEx` let go as its context is released, or a
 * paint's as it ends: `RestoreVisRgn` of what was there before it (seg1
 * `8805`), the window's region by the same rule.
 */
export function dropGivenRegion(system: any, surface: any) {
  const source = surface instanceof Surface ? (surface.visFrom as Source | null) : null;

  if (source?.given) {
    select(system, surface, source.window, source.of, source.flags, null);
  }
}
