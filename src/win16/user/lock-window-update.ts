'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { boundsOf } from '../gdi/bounds.js';
import { DCX_EMPTY, entriesOf, makeStale, type Entry } from './dc-entries.js';
import type { DesktopWindow } from './desktop.js';
import { DesktopHandle } from './desktop-handle.js';
import {
  invalidateThrough,
  RDW_ALLCHILDREN,
  RDW_ERASE,
  RDW_INVALIDATE,
} from './invalidate-through.js';
import { RasterWindow } from './raster-window.js';
import { setUpdate, updateOf } from './update-region.js';
import { discardSaved } from './save-bits.js';

/**
 * One window at a time kept from drawing on the screen, as `USER.EXE`
 * keeps it (seg13 `2276`). Twin of
 * `crates/winbox-win16/src/user_calls/lock_update.rs`. **Read out**:
 *
 * * Locking answers 1; locking while a window is locked, and unlocking with
 *   none locked, nought (`22af`, `22e5`).
 * * The window locked and those in it have no visible region, unless asked
 *   with `DCX_LOCKWINDOWUPDATE` (seg1 `15c4`-`15df`): drawing on them shows
 *   nothing. Locking and unlocking make their contexts stale (`22dd`,
 *   `2306`).
 * * USER keeps the lock as it keeps the bits a `CS_SAVEBITS` window saved
 *   (seg13 `1e72`, flag 2, no bits): the window's rectangle on the screen,
 *   and what of it is still as it was, all of it to start with. GDI keeps
 *   in every context the bounds of what is drawn, Windows' own, whatever
 *   shows; locking empties them (`1eaa`-`1ec3`), and USER takes them back
 *   from each of its contexts (seg1 `06ff`) as it lends one for another
 *   window (`8666`, `868f`), as a window is placed (seg7 `057a`) and as the
 *   window is unlocked (`22ee`). What a context drew counts where its
 *   window is the locked window's parent, the locked window, one in it with
 *   no window before it among its brothers over the drawing, or a window
 *   behind it with no window between them over the drawing -- not one in
 *   front, nor drawing with `DCX_LOCKWINDOWUPDATE` (seg1 `087b`); it is
 *   taken out of what is as it was (`079a`). So is what is made due in a
 *   window there (`3f41`-`3f7c`) and what a scroll moves (seg13 `159d`).
 * * As it locks, what the windows from the locked one back, and those in
 *   them, and its parent, were due within its rectangle is no longer due,
 *   and counts as drawn (seg13 `206b`).
 * * Unlocking makes due what was drawn over -- the rectangle less what is
 *   as it was -- through the desktop: in the windows that show there,
 *   erased (`2315`-`2374`, `0x85`). Where all of it was drawn over, the
 *   lock was let go then (`081c`), and unlocking makes everything due.
 *
 * **Recorded** by `lockupd` and `vislock`.
 */

type Rect = [number, number, number, number];

const DCX_WINDOW = 0x0001;
const DCX_LOCKWINDOWUPDATE = 0x0400;

interface Lock {
  hwnd: number;
  window: DesktopWindow;
  /** The window's rectangle on the screen as it was locked, none where it was off it. */
  rect: Rect | null;
  /** What of it is still as it was: null for all of it, until something is drawn. */
  still: ClipRegion | null;
  /** All of it drawn over: the lock let go of its rectangle (`081c`). */
  gone: boolean;
}

/**
 * One of USER's records of a rectangle of the screen kept as it was, the
 * list at its word 13Eh (seg13 `1e72`): the lock's (its flag 2), and those
 * of the bits a `CS_SAVEBITS` window saved (`save-bits.ts`), kept in
 * `system._saves`. Each is told what is drawn alike (seg1 `074e`).
 */
export interface Kept {
  window: DesktopWindow;
  rect: Rect | null;
  still: ClipRegion | null;
  gone: boolean;
  /** A record of saved bits, not the lock's. */
  saved?: boolean;
}

/** The records of saved bits, newest first (`USER.EXE` seg13 `2017`-`2024`). */
export function savesOf(system: any): Kept[] {
  return (system._saves ??= []);
}

/** Whether USER keeps any record, the lock or saved bits (its word 13Eh). */
export function anyKept(system: any) {
  return !!lockOf(system) || savesOf(system).length > 0;
}

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

/** `SubtractRect` (`USER.EXE` seg1 `20b8`): cut only where `b` spans the whole of `a` one way. */
function subtract(a: Rect, b: Rect): Rect {
  const r: Rect = [...a];

  if (isEmpty(cut(a, b))) {
    return r;
  }

  if (b[1] <= a[1] && b[3] >= a[3]) {
    if (b[0] <= a[0]) {
      r[0] = Math.min(b[2], a[2]);
    } else if (b[2] >= a[2]) {
      r[2] = Math.max(b[0], a[0]);
    }
  }

  if (b[0] <= a[0] && b[2] >= a[2]) {
    if (b[1] <= a[1]) {
      r[1] = Math.min(b[3], a[3]);
    } else if (b[3] >= a[3]) {
      r[3] = Math.max(b[1], a[1]);
    }
  }

  return r;
}

function lockOf(system: any): Lock | null {
  return system._windowLock ?? null;
}

/** The windows in `parent`, front to back; the windows at the top for null. */
function childrenOf(system: any, parent: DesktopWindow | null): DesktopWindow[] {
  const desktop = system.rasterDesktop;

  return desktop ? desktop.windows.filter((other: DesktopWindow) => other.parent === parent) : [];
}

/** Whether a window shows, for USER (seg1 `1c5f`); the desktop, null, always. */
function shows(system: any, window: DesktopWindow | null, client: boolean) {
  if (!window) {
    return true;
  }

  for (let at: DesktopWindow | null = window; at; at = at.parent) {
    if (!at.visible || (at !== window && at.state === 'minimized')) {
      return false;
    }
  }

  if (window.state === 'minimized' && client) {
    const owner = system.handles.resolve(window.hwnd);
    const name = owner?.options?.windowClass;

    return !(name && system.handles.retrieve(name)?.hIcon);
  }

  return true;
}

/**
 * Whether drawing in `window` (null, the desktop) over `rect` counts
 * against the lock, and the part that does (seg1 `087b`).
 */
function counts(system: any, lock: Kept, window: DesktopWindow | null, rect: Rect, flags: number) {
  const locked = lock.window;

  /* Drawing with `DCX_LOCKWINDOWUPDATE` does not count against the lock,
   * and does against saved bits (`08a9`-`08b3`). */
  if (
    !shows(system, window, !(flags & DCX_WINDOW)) ||
    (flags & DCX_LOCKWINDOWUPDATE && !lock.saved)
  ) {
    return null;
  }

  const within = (r: Rect) => {
    const part = cut(r, lock.rect!);

    return isEmpty(part) ? null : part;
  };

  if (locked.parent === window) {
    return within(rect);
  }

  /* The window, or the one it is in, among the locked window's brothers. */
  let at: DesktopWindow | null = window;

  while (at && at.parent !== locked.parent) {
    at = at.parent;
  }

  if (!at || !window) {
    return null;
  }

  /* Taken out where a window between covers it one way across (`20b8`). */
  const between = (from: DesktopWindow[], stop: DesktopWindow) => {
    for (const other of from) {
      if (other === stop) {
        break;
      }

      if (other.visible) {
        rect = subtract(rect, windowRect(other));

        if (isEmpty(rect)) {
          return false;
        }
      }
    }

    return true;
  };

  if (at === locked) {
    /* The saving window's own drawing, and its children's, does not count
     * against what it saved (`08cd`-`08d7`). */
    if (lock.saved) {
      return null;
    }

    if (window === locked) {
      return within(rect);
    }

    let child: DesktopWindow = window;

    while (child.parent !== locked) {
      child = child.parent!;
    }

    return between(childrenOf(system, locked), child) ? within(rect) : null;
  }

  const brothers = childrenOf(system, locked.parent);
  const atIndex = brothers.indexOf(at);
  const lockedIndex = brothers.indexOf(locked);

  /* In front of the locked window, it does not count. */
  if (lockedIndex > atIndex) {
    return null;
  }

  return between(brothers.slice(lockedIndex + 1), at) ? within(rect) : null;
}

/**
 * Drawing in `window` (null, the desktop) over a rectangle of the screen,
 * told to the lock (seg1 `074e`, `079a`): what counts is no longer as it
 * was. `flags` are the context's, `DCX_WINDOW` and `DCX_LOCKWINDOWUPDATE`.
 */
export function lockTouched(system: any, window: DesktopWindow | null, rect: Rect, flags: number) {
  const lock = lockOf(system);

  if (lock) {
    touch(system, lock, window, rect, flags);
  }

  /* Saved bits all drawn over are let go (`081c`, seg1 `0959`). */
  for (const kept of [...savesOf(system)]) {
    if (touch(system, kept, window, rect, flags)) {
      discardSaved(system, kept.window);
    }
  }
}

/** One record told of drawing (seg1 `079a`): true where all of it is now drawn over. */
function touch(system: any, lock: Kept, window: DesktopWindow | null, rect: Rect, flags: number) {
  if (lock.gone || !lock.rect) {
    return false;
  }

  const part = counts(system, lock, window, rect, flags);

  if (!part) {
    return false;
  }

  lock.still = (lock.still ?? regionOf(lock.rect)).subtract(regionOf(part));

  if (lock.still.kind === 1) {
    lock.gone = true;
    return true;
  }

  return false;
}

/** The window an entry is lent for, null for the desktop's, undefined for none. */
function entryWindow(system: any, entry: Entry): DesktopWindow | null | undefined {
  if (!entry.hwnd) {
    return undefined;
  }

  const owner = system.handles.resolve(entry.hwnd);

  if (owner instanceof DesktopHandle) {
    return null;
  }

  return owner instanceof RasterWindow ? owner.window : undefined;
}

/**
 * Windows' bounds taken back from a context and emptied, and told to the
 * lock cut to its window's rectangle (seg1 `06ff`).
 */
export function harvest(system: any, entry: Entry) {
  const bounds = boundsOf(entry.surface);

  if (!(bounds.flags & 1)) {
    return;
  }

  const drawn: Rect = [...bounds.windows];

  bounds.windows.splice(0, 4, 0x7fff, 0x7fff, -0x8000, -0x8000);
  bounds.flags &= ~1;

  const window = entryWindow(system, entry);

  if (window === undefined) {
    return;
  }

  const screen = system.screen.bitmap;
  const part = cut(drawn, window ? windowRect(window) : [0, 0, screen.width, screen.height]);

  if (!isEmpty(part)) {
    lockTouched(system, window, part, entry.flags);
  }
}

/** Every context's bounds taken back, where a window is locked (seg1 `06df`). */
export function harvestAll(system: any) {
  if (!anyKept(system) || !system._dcEntries) {
    return;
  }

  for (const entry of entriesOf(system).list) {
    if (!(entry.flags & DCX_EMPTY)) {
      harvest(system, entry);
    }
  }
}

/**
 * What a window was due within the lock's rectangle no longer due, and
 * counted as drawn; then the windows in it, with `deep` (seg13 `206b`):
 * false where all of the rectangle was taken.
 */
export function takeDue(system: any, lock: Kept, window: DesktopWindow, deep: boolean): boolean {
  if (window.needsPaint) {
    const due = updateOf(window);
    let box: Rect = (window as any).dirtyRect
      ? [due.box.left, due.box.top, due.box.right, due.box.bottom]
      : windowRect(window);

    /* Shown, and cut to the client areas it is in (seg1 `8bb3`). */
    let visible = window.visible;

    for (let at = window.parent; visible && at; at = at.parent) {
      if (!at.visible || at.state === 'minimized') {
        visible = false;
      } else {
        box = cut(box, [
          at.left + at.client.left,
          at.top + at.client.top,
          at.left + at.client.right,
          at.top + at.client.bottom,
        ]);
      }
    }

    if (visible && !isEmpty(box)) {
      /* `RDW_VALIDATE | RDW_NOCHILDREN` of the lock's rectangle. */
      setUpdate(window, due.subtract(regionOf(lock.rect!)), false);

      if (!window.needsPaint) {
        window.needsErase = false;
      }

      /* Told to this record alone (seg13 `20e1`, seg1 `079a`). */
      if (touch(system, lock, window, box, DCX_WINDOW) && lock.saved) {
        discardSaved(system, lock.window);
      }

      if (lock.gone) {
        return false;
      }
    }
  }

  if (deep) {
    for (const child of childrenOf(system, window)) {
      if (!takeDue(system, lock, child, true)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * What a window is made due, told to the records USER keeps (`USER.EXE` seg1
 * `3f41`-`3f7c`): the rectangle given, in its client area's terms, or all,
 * within its client area -- within its whole window with `frame`,
 * `RDW_FRAME` (`3edd`-`3efc`; [[probe:rdwmore]]: a child locked and given
 * `RDW_FRAME` all of itself has the lock let go of, everything due as it
 * is unlocked).
 */
export function tellLock(system: any, window: DesktopWindow, lprc: any, frame = false) {
  if (!anyKept(system)) {
    return;
  }

  const x = window.left + window.client.left;
  const y = window.top + window.client.top;
  const within: Rect = frame
    ? windowRect(window)
    : [x, y, x + window.clientWidth, y + window.clientHeight];
  const r: Rect = lprc
    ? cut([lprc.left + x, lprc.top + y, lprc.right + x, lprc.bottom + y], within)
    : within;

  if (r[0] < r[2] && r[1] < r[3]) {
    lockTouched(system, window, r, 0);
  }
}

/**
 * What is made due of the desktop told to the records USER keeps, as
 * `tellLock` tells a window's (`USER.EXE` seg1 `3f41`-`3f7c`): the box
 * given, within the screen, the desktop window's client area.
 */
export function tellDesktop(system: any, box: Rect) {
  const desktop = system.rasterDesktop;

  if (!anyKept(system) || !desktop) {
    return;
  }

  const r = cut(box, [0, 0, desktop.screen.width, desktop.screen.height]);

  if (r[0] < r[2] && r[1] < r[3]) {
    lockTouched(system, null, r, 0);
  }
}

export function LockWindowUpdate(this: any, hwndLock: number) {
  const lock = lockOf(this);
  const desktop = this.rasterDesktop;

  if (hwndLock) {
    const owner = this.handles.resolve(hwndLock);

    if (lock || !(owner instanceof RasterWindow)) {
      return 0;
    }

    const window = owner.window;

    /* Windows' bounds emptied in every context (`1eaa`-`1ec3`) -- taken
     * back for the records kept, where USER keeps any (`1e9c`-`1ea8`). */
    harvestAll(this);

    for (const entry of entriesOf(this).list) {
      const bounds = boundsOf(entry.surface);

      bounds.windows.splice(0, 4, 0x7fff, 0x7fff, -0x8000, -0x8000);
      bounds.flags &= ~1;
    }

    const screen = this.screen.bitmap;
    const rect = cut(windowRect(window), [0, 0, screen.width, screen.height]);
    const made: Lock = {
      hwnd: hwndLock,
      window,
      rect: isEmpty(rect) ? null : rect,
      still: null,
      gone: false,
    };

    this._windowLock = made;

    /* What was due there, from the window back (`2028`-`2063`). */
    if (made.rect) {
      if (window.parent) {
        takeDue(this, made, window.parent, false);
      }

      const brothers = childrenOf(this, window.parent);

      for (const brother of brothers.slice(brothers.indexOf(window))) {
        if (!takeDue(this, made, brother, true)) {
          break;
        }
      }
    }

    makeStale(this, hwndLock, 1);
    return 1;
  }

  if (!lock) {
    return 0;
  }

  harvestAll(this);
  this._windowLock = null;
  makeStale(this, lock.hwnd, 1);

  if (!desktop) {
    return 1;
  }

  const flags = RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN;

  if (lock.gone || !lock.rect) {
    invalidateThrough(desktop, null, null, flags);
  } else if (lock.still) {
    const drawn = regionOf(lock.rect).subtract(lock.still);

    if (drawn.kind > 1) {
      invalidateThrough(desktop, null, drawn, flags);
    }
  }

  return 1;
}
