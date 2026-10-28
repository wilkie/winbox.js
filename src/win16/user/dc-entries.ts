'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { Color } from '../../raster/color.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { Surface } from '../../raster/surface.js';

import { originOf } from '../gdi/clipping.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { Region } from '../gdi/gdi-objects.js';
import { GetStockObject } from '../gdi/GetStockObject.js';
import { putState, stateOf } from '../gdi/SaveDC.js';
import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { RestoreVisRgn, saveVisQuietly, selectVis } from '../gdi/visible-region.js';

import type { Desktop, DesktopWindow } from './desktop.js';
import { DesktopHandle } from './desktop-handle.js';
import { harvest } from './lock-window-update.js';
import { RasterWindow } from './raster-window.js';
import {
  DCX_CACHE,
  DCX_CLIPCHILDREN,
  DCX_CLIPSIBLINGS,
  DCX_EXCLUDERGN,
  DCX_INTERSECTRGN,
  DCX_PARENTCLIP,
  DCX_WINDOW,
  lessChildren,
  windowRegion,
} from './visible-region-rule.js';

/**
 * USER's device context entries (`USER.EXE`, the list at DS:12Eh): the five
 * common contexts USER makes as Windows starts (seg3 `0635`-`0662`), and
 * one for each window of a `CS_OWNDC` class and each `CS_CLASSDC` class
 * (seg8 `0707`-`071e`). Each entry is a device context of its own -- its
 * own drawing surface and attributes -- the window it is lent for, the
 * window whose region it has, a region given, and its flags. `GetDC`,
 * `GetWindowDC`, `GetDCEx` and `BeginPaint` take one (seg1 `847b`),
 * `ReleaseDC` and `EndPaint` give it back (seg1 `8805`), and windows
 * changing make entries stale (seg1 `8aa0`), to be worked out again when
 * next taken or by USER's hook when next used (seg1 `8a00`).
 * `kb/topics/visible-regions.md`, phase 4. Twin of
 * `crates/winbox-win16/src/dc_entries.rs`.
 */

/** An entry whose region is gone: free, to be worked out when next taken (`8b6e`). */
export const DCX_EMPTY = 0x0800;
/** An entry lent and not given back (`8698`, cleared at `884e`). */
export const DCX_INUSE = 0x1000;
/** An entry in use made stale: USER's hook works it out again (`8ba0`). */
export const DCX_STALE = 0x2000;
const DCX_KEEPCLIPRGN = 0x00040000;

/** The flags an entry is found by (`854f`), and those it is matched on (`85cd`). */
const KEY = 0x041b;
const MATCH = 0x1c1b;

const WS_CLIPCHILDREN = 0x02000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_VISIBLE = 0x10000000;
const WS_MINIMIZE = 0x20000000;
const CS_OWNDC = 0x0020;
const CS_CLASSDC = 0x0040;
const CS_PARENTDC = 0x0080;
const BLACK_PEN = 7;
const WHITE_BRUSH = 0;

export type Entry = {
  /** The context's handle, and its surface: its own drawing and attributes. */
  hdc: number;
  surface: Surface;
  /** `GetDCEx`'s flags as kept (`86a1`-`869e`), with the three of USER's own. */
  flags: number;
  /** The window it is lent for, and the window whose region it has; nought for none. */
  hwnd: number;
  clip: number;
  /** The region `GetDCEx` was given, by its handle; 1 for the whole screen. */
  region: number;
  /** A region given with no handle: `BeginPaint`'s part to paint. */
  shape: ClipRegion | null;
  /** A class's context, which outlives its windows. */
  shared: boolean;
};

type Entries = { list: Entry[]; state: any };

/** The entries, the one taken last first: made as Windows starts, five of them. */
export function entriesOf(system: any): Entries {
  if (!system._dcEntries) {
    system._dcEntries = { list: [], state: null } satisfies Entries;

    /* Five common contexts, each with no window, made empty (seg3
     * `0635`-`0662`); a copy of the last one's state kept to give a common
     * context back with (`0665`). */
    for (let made = 0; made < 5; made++) {
      makeEntry(system, 0, DCX_CACHE | DCX_EMPTY);
    }

    system._dcEntries.state = stateOf(system._dcEntries.list[0].surface);
  }

  return system._dcEntries;
}

/** Whether a handle is a window's or the desktop's, which has device contexts to lend. */
export function lendsTo(system: any, hwnd: number) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  return window instanceof RasterWindow || window instanceof DesktopHandle;
}

/** The entry of a context, by its handle. */
export function entryOf(system: any, hdc: number): Entry | null {
  return system._dcEntries?.list.find((entry: Entry) => entry.hdc === hdc) ?? null;
}

/**
 * The window a context is lent for, as `WindowFromDC` finds it by its entry
 * (seg1 `8988`): null where the context is no entry's, undefined where the
 * entry is lent for no window on the desktop -- the desktop's own.
 */
export function windowOfContext(system: any, surface: any): DesktopWindow | null | undefined {
  const entry = system._dcEntries?.list.find((one: Entry) => one.surface === surface);

  if (!entry) {
    return null;
  }

  return shownOf(system, entry.hwnd) ?? undefined;
}

/**
 * A new entry, at the head of the list (seg1 `88aa`): a display context of
 * its own with USER's hook in it and the entry as the hook's data (`890d`),
 * the window it is for. One that is not common -- a window's own, a
 * class's -- is in use from the start, and stale, so that its region is
 * worked out as it is first used (`896d`-`8972`); a class's is the class's
 * context from then on (`8965`).
 */
function makeEntry(system: any, hwnd: number, flags: number, surface?: Surface) {
  const context: Surface = surface ?? Surface.memory();
  const hdc = system.handles.allocate(context);
  const entry: Entry = {
    hdc,
    surface: context,
    flags,
    hwnd,
    clip: hwnd,
    region: 0,
    shape: null,
    shared: false,
  };

  defaultState(system, context);

  /* Where its origin is on the screen, which a brush's origin is counted
   * from (`brushorg`): a window's own surface knows already. */
  if (!surface) {
    (context as any).screenOrigin = () => {
      const [x, y] = originOf(context);

      return { x, y };
    };
  }

  context.dcHook = { proc: 0, data: hdc & 0xffff, user: true };
  context.userHook = () => dcHook(system, entry);
  system._dcEntries.list.unshift(entry);

  if (!(flags & DCX_CACHE)) {
    const windowClass = classOf(system, hwnd);

    if (windowClass && windowClass.style & CS_CLASSDC) {
      windowClass.dcEntry = entry;
      entry.shared = true;
    }

    entry.flags |= DCX_INUSE;
    staleOne(system, entry);
  }

  return entry;
}

/**
 * A new display context's attributes, as `CreateDC` gives them and USER's
 * copy of them keeps: the System font, black text on white, opaque,
 * `R2_COPYPEN`, the black pen and the white brush (`dcreset`).
 */
function defaultState(system: any, surface: any) {
  const fresh: any = Surface.memory();

  for (const field of ['backMode', 'backcolor', 'rop2']) {
    surface[field] = fresh[field];
  }

  surface.textColor = new Color(0, 0, 0);

  const font = system.fonts ? stockFontHandle(system, SYSTEM_FONT) : null;

  if (font) {
    surface.font = system.handles.resolve(font);
  }

  surface.pen = system.handles.resolve(GetStockObject.call(system, BLACK_PEN));
  surface.brush = system.handles.resolve(GetStockObject.call(system, WHITE_BRUSH));
}

/** A window's own entry made as it is created, where its class has one (seg8 `0707`-`071e`). */
export function windowCreated(system: any, hwnd: number, surface: Surface) {
  const windowClass = classOf(system, hwnd);
  const style = windowClass?.style ?? 0;

  entriesOf(system);

  if (style & CS_OWNDC || (style & CS_CLASSDC && !windowClass.dcEntry)) {
    makeEntry(system, hwnd, 0x00020000, style & CS_OWNDC ? surface : undefined);
  }
}

/**
 * A window's entries as it is destroyed and taken off the desktop (seg8
 * `0d90`-`0e05`): a common one
 * in use given back, and each emptied; a class's emptied, its region given
 * restored; a window's own let go (seg1 `89aa`).
 */
export function windowDestroyed(system: any, hwnd: number) {
  const entries: Entries | undefined = system._dcEntries;

  if (!entries || !hwnd) {
    return;
  }

  for (const entry of [...entries.list]) {
    if (entry.flags & DCX_EMPTY || (entry.hwnd !== hwnd && entry.clip !== hwnd)) {
      continue;
    }

    if (entry.flags & DCX_CACHE) {
      if (entry.flags & DCX_INUSE) {
        releaseEntry(system, entry.hdc, false);
      }

      entry.flags = DCX_CACHE | DCX_EMPTY;
    } else if (entry.shared) {
      if (entry.flags & (DCX_EXCLUDERGN | DCX_INTERSECTRGN)) {
        restoreGiven(system, entry);
      }

      entry.flags = DCX_EMPTY;
    } else {
      entries.list.splice(entries.list.indexOf(entry), 1);
      entry.surface.dcHook = null;
      entry.surface.userHook = null;
      system.handles.free(entry.hdc);
      continue;
    }

    entry.hwnd = 0;
    entry.clip = 0;
    entry.region = 0;
    entry.shape = null;
  }
}

/** The class a window was made of, as `RegisterClass` kept it. */
function classOf(system: any, hwnd: number): any {
  const window = hwnd ? system.handles.resolve(hwnd) : null;
  const name = window instanceof RasterWindow ? window.options?.windowClass : null;

  return name ? system.handles.retrieve(name) : null;
}

/** The window a handle names on the desktop; null for the desktop and for none. */
function shownOf(system: any, hwnd: number): DesktopWindow | null {
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  return window instanceof RasterWindow ? window.window : null;
}

/** A window's parent, the desktop for one at the top; nought for the desktop (the word at 4). */
function parentOf(system: any, hwnd: number): number {
  if (!hwnd || hwnd === system.desktopWindow) {
    return 0;
  }

  const window = shownOf(system, hwnd);

  if (!window) {
    return 0;
  }

  return window.parent?.hwnd || system.desktopWindow;
}

/**
 * A window's style as USER keeps it, `WS_VISIBLE` and `WS_MINIMIZE` as it
 * shows; the desktop's has `WS_CLIPCHILDREN` and is visible.
 */
function styleOf(system: any, hwnd: number): number {
  if (hwnd === system.desktopWindow) {
    return WS_CLIPCHILDREN | WS_VISIBLE;
  }

  const window = shownOf(system, hwnd);

  if (!window) {
    return 0;
  }

  return (
    (window.style & ~(WS_VISIBLE | WS_MINIMIZE)) |
    (window.visible ? WS_VISIBLE : 0) |
    (window.state === 'minimized' ? WS_MINIMIZE : 0)
  );
}

/**
 * The flags an entry is taken with, the window whose region it has, and
 * the class's context, from `GetDCEx`'s flags (seg1 `8491`-`854c`):
 *
 * * With `DCX_USESTYLE`, the clipping flags given dropped (`8497`); for
 *   the whole window, `DCX_CLIPSIBLINGS` by its style and `DCX_CACHE`
 *   (`84f1`-`84fb`); for its client area, `DCX_PARENTCLIP` by the class's
 *   `CS_PARENTDC` (`84a4`), `DCX_CACHE` unless the class has a context of
 *   its own (`84ae`-`84cd`), `DCX_CLIPCHILDREN` and `DCX_CLIPSIBLINGS` by
 *   the style, not `DCX_CLIPCHILDREN` while it is minimized (`84d1`-`84eb`).
 * * The high word's 8 drops `DCX_CLIPCHILDREN` and `DCX_PARENTCLIP` and
 *   gives `DCX_CACHE` (`84ff`).
 * * `DCX_PARENTCLIP` gives `DCX_CACHE`, and the parent's region with its
 *   `WS_CLIPSIBLINGS`, unless the parent has `WS_CLIPCHILDREN`, the flags
 *   have `DCX_CLIPCHILDREN` or `DCX_CLIPSIBLINGS`, or one of the two is
 *   visible and the other not (`850d`-`854c`). The window's bit at 26h
 *   that skips the parent's `WS_CLIPCHILDREN` (`851a`) is not followed.
 */
function takenFlags(system: any, hwnd: number, flags: number) {
  let low = flags & 0xffff;
  const high = (flags >>> 16) & 0xffff;
  let clip = hwnd;
  let classDc = 0;
  const style = styleOf(system, hwnd);

  if (high & 1) {
    low &= 0xc7;

    if (!(low & DCX_WINDOW)) {
      const classStyle = classOf(system, hwnd)?.style ?? 0;

      if (classStyle & CS_PARENTDC) {
        low |= DCX_PARENTCLIP;
      }

      if (!(low & DCX_CACHE)) {
        low |= DCX_CACHE;

        if (classStyle & CS_OWNDC) {
          low &= ~DCX_CACHE;
        } else if (classStyle & CS_CLASSDC) {
          classDc = classOf(system, hwnd)?.dcEntry?.hdc ?? 0;
          low &= ~DCX_CACHE;
        }
      }

      if (style & WS_CLIPCHILDREN) {
        low |= DCX_CLIPCHILDREN;
      }

      if (style & WS_CLIPSIBLINGS) {
        low |= DCX_CLIPSIBLINGS;
      }

      if (style & WS_MINIMIZE) {
        low &= ~DCX_CLIPCHILDREN;
      }
    } else {
      if (style & WS_CLIPSIBLINGS) {
        low |= DCX_CLIPSIBLINGS;
      }

      low |= DCX_CACHE;
    }
  }

  if (high & 8) {
    low &= ~(DCX_CLIPCHILDREN | DCX_PARENTCLIP);
    low |= DCX_CACHE;
  }

  if (low & DCX_PARENTCLIP) {
    low |= DCX_CACHE;

    const parent = parentOf(system, hwnd);
    const parentStyle = styleOf(system, parent);

    if (
      parent &&
      !(parentStyle & WS_CLIPCHILDREN) &&
      !(low & (DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS)) &&
      !((parentStyle ^ style) & WS_VISIBLE)
    ) {
      low &= ~(DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS);
      clip = parent;

      if (parentStyle & WS_CLIPSIBLINGS) {
        low |= DCX_CLIPSIBLINGS;
      }
    }
  }

  return { low, high, clip, classDc };
}

/**
 * An entry taken for a window by `GetDCEx`'s flags and a region (seg1
 * `847b`-`87b7`); its handle, or nought where the window's class has no
 * context of its own and `DCX_CACHE` is not given (`85b6`).
 *
 * * Without `DCX_CACHE`, the window's own entry or its class's
 *   (`8560`-`85b3`): the same window's taken as it is (`85b3`), another
 *   window's -- a class's -- worked out for this one (`85b0`).
 * * A common one: an entry not in use for the same window whose region it
 *   has and the same flags -- **taken as it is, its region not worked out
 *   again**, its origin set where it was another window's (`85c5`-`8656`,
 *   `865d`-`86cd`); else the first empty entry, or the last free one
 *   (`85f4`-`8619`); else, all five lent, the one taken last given back and
 *   taken again (`8625`-`867e`; `dcentry`, `dcreuse`). USER first yields
 *   while another task holds one (`8637`-`8653`), which is not followed.
 * * An entry taken afresh is in use, its region worked out by USER's rule
 *   and selected, its origin and brush origin the window's corner
 *   (`8688`-`86cd`, seg1 `1540`).
 * * It goes to the head of the list (`86d1`-`86e3`).
 * * `DCX_INTERSECTRGN` and `DCX_EXCLUDERGN`: the region saved with
 *   `SaveVisRgn`, and the window's combined with the region given
 *   (`86e7`-`87a0`). The region given is the entry's until it is released,
 *   and deleted then unless `DCX_KEEPCLIPRGN` (seg1 `885f`).
 *
 * The high word's 2, which `GetDC` and `BeginPaint` pass, selects a font
 * for a program made for Windows before 3.0 (`87be`); not followed.
 */
export function takeEntry(
  system: any,
  hwnd: number,
  region: number,
  flags: number,
  shape?: ClipRegion
) {
  const entries = entriesOf(system);
  const list = entries.list;
  const { low, high, clip, classDc } = takenFlags(system, hwnd, flags);
  const key = low & KEY;
  let entry: Entry | null;
  let afresh = false;

  if (!(low & DCX_CACHE)) {
    entry =
      list.find(
        (one) => !(one.flags & DCX_CACHE) && (one.hwnd === hwnd || (classDc && one.hdc === classDc))
      ) ?? null;

    if (!entry) {
      return 0;
    }

    if (
      entry.flags & (DCX_EXCLUDERGN | DCX_INTERSECTRGN) &&
      low & (DCX_EXCLUDERGN | DCX_INTERSECTRGN)
    ) {
      restoreGiven(system, entry);
    }

    afresh = entry.hwnd !== hwnd;
  } else {
    const minimized = !!(styleOf(system, clip) & WS_MINIMIZE);

    entry =
      list.find(
        (one) =>
          one.clip === clip && (one.flags & MATCH) === key && !(minimized && one.hwnd !== one.clip)
      ) ?? null;

    if (entry) {
      entry.flags |= DCX_INUSE;

      if (entry.hwnd !== hwnd) {
        /* What it drew for the other window, taken back (`8665`). */
        harvest(system, entry);
        entry.hwnd = hwnd;
        bind(system, entry);
      }
    } else {
      let free: Entry | null = null;

      for (const one of list) {
        if (!(one.flags & DCX_CACHE)) {
          continue;
        }

        if (one.flags & DCX_EMPTY) {
          free = one;
          break;
        }

        if (!(one.flags & DCX_INUSE)) {
          free = one;
        }
      }

      if (!free) {
        free = list[0];
        releaseEntry(system, free.hdc, false);
      }

      /* What it drew, taken back unless it was emptied (`8688`-`868f`). */
      if (!(free.flags & DCX_EMPTY)) {
        harvest(system, free);
      }

      entry = free;
      afresh = true;
    }
  }

  if (afresh) {
    entry.flags = key | DCX_INUSE;
    entry.hwnd = hwnd;
    entry.clip = clip;
    entry.region = 0;
    entry.shape = null;
    bind(system, entry);
    selectVis(entry.surface, ruleRegion(system, entry));
  }

  list.splice(list.indexOf(entry), 1);
  list.unshift(entry);

  if (low & DCX_INTERSECTRGN) {
    if (region !== 1) {
      saveVisQuietly(entry.surface);
      entry.region = region;
      entry.shape = shape ?? null;

      if (high & 4) {
        entry.flags |= DCX_KEEPCLIPRGN;
      }

      entry.flags |= DCX_INTERSECTRGN;
      entry.flags &= ~DCX_STALE;
      selectVis(entry.surface, withGiven(system, entry, visNow(entry.surface)));
    }
  } else if (low & DCX_EXCLUDERGN && (region || shape)) {
    saveVisQuietly(entry.surface);
    entry.region = region;
    entry.shape = shape ?? null;

    if (high & 4) {
      entry.flags |= DCX_KEEPCLIPRGN;
    }

    entry.flags |= DCX_EXCLUDERGN;
    selectVis(entry.surface, withGiven(system, entry, visNow(entry.surface)));
  }

  return entry.hdc;
}

/** The visible region a context has now, in the screen's terms. */
function visNow(surface: any): ClipRegion {
  return surface.visRegion ?? ClipRegion.EMPTY;
}

/**
 * The window's region combined with the region given (`86f8`-`8798`,
 * `8a3b`-`8a82`): `RGN_AND` for `DCX_INTERSECTRGN`, nothing where none was
 * given; `RGN_DIFF` for `DCX_EXCLUDERGN`, nothing where it was given 1.
 */
function withGiven(system: any, entry: Entry, region: ClipRegion) {
  const given = entry.region > 1 ? system.handles.resolve(entry.region) : null;
  const shape = given instanceof Region ? given.shape : entry.shape;

  if (entry.flags & DCX_INTERSECTRGN) {
    return shape ? region.intersect(shape) : ClipRegion.EMPTY;
  }

  if (entry.flags & DCX_EXCLUDERGN) {
    if (entry.region === 1) {
      return ClipRegion.EMPTY;
    }

    return shape ? region.subtract(shape) : region;
  }

  return region;
}

/** The region USER's rule gives an entry's window by its flags (seg1 `1582`). */
function ruleRegion(system: any, entry: Entry): ClipRegion {
  /* The desktop's: the screen, its windows at the top taken out with
   * `DCX_CLIPCHILDREN`. Asked without making the desktop, which a
   * `GetDC(NULL)` before any window does not. */
  if (entry.hwnd === system.desktopWindow) {
    const screen = system.screen.bitmap;
    const whole = ClipRegion.rect(0, 0, screen.width, screen.height);
    const made: Desktop | undefined = system._rasterDesktop;

    return entry.flags & DCX_CLIPCHILDREN && made ? lessChildren(made, null, null, whole) : whole;
  }

  const desktop: Desktop | undefined = system.rasterDesktop;

  if (!desktop) {
    return ClipRegion.EMPTY;
  }

  const window = shownOf(system, entry.hwnd);
  const of = entry.clip === system.desktopWindow ? null : shownOf(system, entry.clip);

  if (!window || !of || !desktop.windows.includes(window) || !desktop.windows.includes(of)) {
    return ClipRegion.EMPTY;
  }

  return windowRegion(system, desktop, window, of, entry.flags & 0xffff);
}

/**
 * The entry's surface pointed at its window: a view of the whole screen
 * from the window's corner, as large as its client area or, with
 * `DCX_WINDOW`, the whole window; the screen for the desktop's. A window's
 * own context is its window's surface, which follows the window itself.
 * Its origin and brush origin the corner (seg1 `1540`).
 */
function bind(system: any, entry: Entry) {
  const surface: any = entry.surface;
  const window = shownOf(system, entry.hwnd);

  if (window && surface === window.surface) {
    // A window's own: laid out with the window.
  } else if (entry.hwnd === system.desktopWindow) {
    const screen = system.screen.bitmap;

    surface.bitmap = DeviceBitmap.screenView(screen, [0, 0], screen.width, screen.height);
  } else if (window && system.rasterDesktop) {
    surface.bitmap = system.rasterDesktop.dcView(window, !!(entry.flags & DCX_WINDOW));
  }

  surface.dcOrigin = null;
  surface.brushOrg = undefined;
}

/**
 * An entry given back (seg1 `8805`): nought where it is not in use, or was
 * emptied (`881e`-`8825`). Its region given restored and let go where it is
 * a common one's or `EndPaint` gives it back (`8827`-`883b`); a common one's
 * state set back with `SetDCState` from USER's copy -- its origin and
 * visible region staying (`8844`, `GDI.EXE` seg1 `0615`) -- and no longer
 * in use (`884e`). A window's own and a class's stay in use: 1.
 */
export function releaseEntry(system: any, hdc: number, ending: boolean) {
  const entry = entryOf(system, hdc);

  if (!entry || (entry.flags & (DCX_EMPTY | DCX_INUSE)) !== DCX_INUSE) {
    return 0;
  }

  if (entry.flags & (DCX_EXCLUDERGN | DCX_INTERSECTRGN) && (entry.flags & DCX_CACHE || ending)) {
    restoreGiven(system, entry);
  }

  if (entry.flags & DCX_CACHE) {
    resetState(system, entry.surface);
    entry.flags &= ~DCX_INUSE;
  }

  return 1;
}

/**
 * A common context's attributes set back as USER's copy has them, as
 * `SetDCState` puts a state: the origin stays (`GDI.EXE` seg1 `072f`-`073f`
 * sets it back through `SetDCOrg`), and the visible region; the palette is
 * the stock one again. Its saved levels go too; not recorded.
 */
function resetState(system: any, surface: any) {
  surface.refreshVis();

  const origin = surface.dcOrigin;

  putState(surface, entriesOf(system).state);
  surface.dcOrigin = origin;
  surface.saved = [];

  /* The palette, which is in the state Windows copies (`GDI.EXE` seg1
   * `074f`-`075e`), the stock one again. */
  surface.palette = null;
}

/**
 * A window's own surface handed out as a common context would be -- the
 * context a list box or a button gives its owner to draw an item with,
 * which in Windows is one USER lends -- with a common context's attributes,
 * unless it is the window's own entry's (`CS_OWNDC`), which keeps them.
 */
export function asCommon(system: any, surface: any) {
  if (!system._dcEntries?.list.some((entry: Entry) => entry.surface === surface)) {
    resetState(system, surface);
  }
}

/**
 * A region given let go (seg1 `885f`): deleted unless `DCX_KEEPCLIPRGN`,
 * the region saved before it restored with `RestoreVisRgn`, and an entry
 * made stale while it had it made stale again (`889b`).
 */
function restoreGiven(system: any, entry: Entry) {
  entry.flags &= ~(DCX_EXCLUDERGN | DCX_INTERSECTRGN);

  if (!(entry.flags & DCX_KEEPCLIPRGN)) {
    if (entry.region > 1) {
      DeleteObject.call(system, entry.region);
    }

    entry.region = 0;
  } else {
    entry.flags &= ~DCX_KEEPCLIPRGN;
  }

  entry.shape = null;
  RestoreVisRgn.call(system, entry.hdc);

  if (entry.flags & DCX_STALE) {
    staleOne(system, entry);
  }
}

/**
 * USER's hook, which GDI calls before a context is used where its flag is
 * set (seg1 `8a00`), for `DCHC_INVALIDVISRGN`: the flag cleared
 * (`SetHookFlags(DCHF_VALIDATEVISRGN)`, `8a18`), and for an entry in use
 * its region worked out again, the region given applied again, selected,
 * and its origin and brush origin set (`8a26`-`8a94`). It answers 1, and
 * does nothing for any other code.
 */
export function dcHook(system: any, entry: Entry) {
  const surface: any = entry.surface;

  surface.dcHookFlag = false;

  if (!(entry.flags & DCX_INUSE)) {
    return 1;
  }

  bind(system, entry);
  selectVis(surface, withGiven(system, entry, ruleRegion(system, entry)));

  return 1;
}

/** USER's hook as a program calls it, by the data GDI gives it: the context's handle here. */
export function DCHook(this: any, hdc: number, code: number, data: number, _lParam: number) {
  const entry = entryOf(this, data & 0xffff) ?? entryOf(this, hdc);

  if (code !== 1 || !entry) {
    return 1;
  }

  return dcHook(this, entry);
}

/**
 * One entry made stale (seg1 `8b4f`): a free one emptied, to be worked out
 * when next taken; one in use given `DCX_CLIPCHILDREN` and
 * `DCX_CLIPSIBLINGS` by its window's style again, and USER's hook to be
 * called by GDI the next time it is used (`SetHookFlags(DCHF_INVALIDATEVISRGN)`).
 */
function staleOne(system: any, entry: Entry) {
  if (!(entry.flags & DCX_INUSE)) {
    entry.flags = (entry.flags & DCX_CACHE) | DCX_EMPTY;
    entry.hwnd = 0;
    entry.clip = 0;
    entry.region = 0;
    entry.shape = null;
    return;
  }

  const style = styleOf(system, entry.hwnd);

  entry.flags &= ~(DCX_CLIPCHILDREN | DCX_CLIPSIBLINGS);

  if (style & WS_CLIPCHILDREN && !(style & WS_MINIMIZE)) {
    entry.flags |= DCX_CLIPCHILDREN;
  }

  if (style & WS_CLIPSIBLINGS) {
    entry.flags |= DCX_CLIPSIBLINGS;
  }

  entry.flags |= DCX_STALE;
  (entry.surface as any).dcHookFlag = true;
}

/**
 * The entries a window's change makes stale (seg1 `8aa0`): those of the
 * window and of every window within it. `how` 1, a window shown or hidden
 * or its clipping styles changed, makes it its parent's -- all but the
 * parent's whole-window entries where the parent has `WS_CLIPCHILDREN`, all
 * but the parent's own where the window has `WS_CLIPSIBLINGS` -- else the
 * window's alone (`8ab1`-`8adc`). `SetWindowPos` and `ScrollWindow` give a
 * window's parent, 4 where it has `WS_CLIPCHILDREN` and 2 where not
 * (seg7 `0585`-`0595`, seg13 `1656`-`1666`). A window's own entries and
 * its class's have their `DCX_CLIPCHILDREN` set by its style as they go by
 * (`8af1`-`8b0a`).
 */
export function makeStale(system: any, hwnd: number, how: number) {
  const entries: Entries | undefined = system._dcEntries;

  if (!entries || !hwnd) {
    return;
  }

  let target = hwnd;
  let mode = how;

  if (mode & 1) {
    mode = 0;

    if (hwnd !== system.desktopWindow) {
      const parent = parentOf(system, hwnd);

      if (styleOf(system, parent) & WS_CLIPCHILDREN) {
        mode = 4;
        target = parent;
      } else if (styleOf(system, hwnd) & WS_CLIPSIBLINGS) {
        mode = 2;
        target = parent;
      }
    }
  }

  for (const entry of [...entries.list]) {
    if (entry.flags & DCX_EMPTY) {
      continue;
    }

    if (!(entry.flags & (DCX_WINDOW | DCX_CACHE))) {
      const style = styleOf(system, entry.hwnd);

      if (style & WS_CLIPCHILDREN) {
        entry.flags |= DCX_CLIPCHILDREN;
      }

      if (style & WS_MINIMIZE) {
        entry.flags &= ~DCX_CLIPCHILDREN;
      }
    }

    const own = entry.hwnd;

    for (let at = own; at; at = parentOf(system, at)) {
      if (at !== target) {
        continue;
      }

      if (own === target && (mode & 2 || (mode & 4 && entry.flags & DCX_WINDOW))) {
        continue;
      }

      staleOne(system, entry);
    }
  }
}

/** What USER's walk is told of a window's change, as WinBox finds it. */
type Seen = {
  hwnd: number;
  parent: number;
  rect: string;
  order: number;
  visible: boolean;
  clipping: number;
};

/**
 * Which windows changed since the screen's owners were last worked out,
 * and the entries each change makes stale as USER's own callers of seg1
 * `8aa0` would: a window moved, sized, given another client area or
 * placed elsewhere among its siblings as `SetWindowPos` (seg7 `0595`),
 * shown, hidden, made or destroyed shown as `ShowWindow` (seg1 `56ef`,
 * `5726`), its clipping styles changed as `SetWindowLong` (seg2 `0bce`).
 * WinBox's windows change in many places, each of which Windows passes
 * through those calls; comparing each window's place, order, showing and
 * styles finds them all in one.
 */
export function windowsChanged(system: any, desktop: Desktop) {
  if (!system._dcEntries) {
    return;
  }

  const before: Map<DesktopWindow, Seen> = (system._dcSeen ??= new Map());
  const now = new Map<DesktopWindow, Seen>();
  const places = new Map<DesktopWindow | null, number>();

  for (const window of desktop.windows) {
    const order = places.get(window.parent) ?? 0;

    places.set(window.parent, order + 1);
    now.set(window, {
      hwnd: window.hwnd,
      parent: window.parent?.hwnd || system.desktopWindow,
      rect: `${window.left},${window.top},${window.width},${window.height},${window.client.left},${window.client.top},${window.client.right},${window.client.bottom},${window.state}`,
      order,
      visible: window.visible,
      clipping: window.style & (WS_CLIPCHILDREN | WS_CLIPSIBLINGS),
    });
  }

  system._dcSeen = now;

  for (const [window, seen] of before) {
    if (now.has(window)) {
      continue;
    }

    /* Destroyed: hidden first, as `DestroyWindow` hides it; its entries
     * were let go as it was taken off the desktop (`windowDestroyed`). Its
     * handle may be another window's by now: the walk is its parent's. */
    if (seen.visible) {
      staleGone(system, seen);
    }
  }

  for (const [window, seen] of now) {
    const was = before.get(window);

    if (!was) {
      if (seen.visible) {
        staleFor(system, seen, true);
      }

      continue;
    }

    if (was.visible !== seen.visible || was.clipping !== seen.clipping) {
      staleFor(system, seen, true);
    }

    if (was.rect !== seen.rect || was.order !== seen.order || was.parent !== seen.parent) {
      staleFor(system, seen, false);
    }
  }
}

/** USER's walk for a window's change: as shown or hidden, or as placed. */
function staleFor(system: any, seen: Seen, shown: boolean) {
  if (shown) {
    makeStale(system, seen.hwnd, 1);
    return;
  }

  makeStale(system, seen.parent, styleOf(system, seen.parent) & WS_CLIPCHILDREN ? 4 : 2);
}

/** USER's walk for a window gone, as hidden, by what it had: its parent's (`8ab1`-`8adc`). */
function staleGone(system: any, seen: Seen) {
  const parentStyle = styleOf(system, seen.parent);

  if (parentStyle & WS_CLIPCHILDREN) {
    makeStale(system, seen.parent, 4);
  } else if (seen.clipping & WS_CLIPSIBLINGS) {
    makeStale(system, seen.parent, 2);
  }
}
