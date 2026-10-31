'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { saveScreenBitmap, saveScreenBitmapRule } from '../display-driver.js';
import { boundsOf } from '../gdi/bounds.js';
import { entriesOf } from './dc-entries.js';
import type { Desktop, DesktopWindow } from './desktop.js';
import { harvestAll, savesOf, takeDue, type Kept } from './lock-window-update.js';
import { RasterWindow } from './raster-window.js';

/**
 * The bits beneath a window of a class with `CS_SAVEBITS`, kept by USER as
 * the window is shown and put back where it uncovers them (`USER.EXE` seg13
 * `1e72`, `211e`, seg1 `0959`). Twin of
 * `crates/winbox-win16/src/save_bits.rs`. **Read out**:
 *
 * * **Kept** as `SetWindowPos` places a window with `SWP_SHOWWINDOW` and
 *   without `SWP_NOREDRAW`, of a class with `CS_SAVEBITS` (seg7
 *   `0b75`-`0bde`), where no window before it among its brothers shows
 *   (`0b8e`-`0bc5`), it is at the top (seg13 `1e82`-`1e99`), and no system
 *   error box is up -- USER's word at E0h (`1e78`, set by `SysErrorBox`,
 *   seg1 `9359`, `9a9a`). That is before anything of the list is drawn: the
 *   screen as it was. Its rectangle on the screen (`1ed8`-`1f0e`; the
 *   `Edsun=` widening at `1ee9` not followed), in the display driver
 *   through its `SaveScreenBitmap` where the driver has `RC_SAVEBITMAP`
 *   (seg3 `1c06`-`1c28`) and answers it (seg13 `1f5e`-`1f7b`), else in a
 *   bitmap of USER's (`1f7e`-`1fe5`). Every context's bounds are taken back
 *   first (`1e9c`-`1ec3`), and what the windows from it back were due in
 *   the rectangle is no longer due, and counts as drawn (`2028`-`2063`,
 *   `206b`), as for the lock.
 * * **Spoiled** by what is drawn behind it, as the lock is
 *   (`lock-window-update.ts`): all of it drawn over, let go (seg1 `081c`).
 * * **Put back** by `SetWindowPos` for a window that had them where what
 *   showed of it does not now (seg7 `076d`-`07f3`), `restoreUnder`.
 * * **Let go** as a window that had them is placed with anything asked but
 *   `SWP_NOZORDER | SWP_NOMOVE | SWP_NOSIZE` alone and not shown (seg7
 *   `088f`-`08b3`), and as it is destroyed (seg1 `0830`).
 *
 * **Recorded** by `savebit`. Of the drivers, `VGA.DRV`'s answer is read
 * out (`saveScreenBitmap`); a driver with `RC_SAVEBITMAP` not read out
 * keeps nothing here.
 */

type Rect = [number, number, number, number];

interface Saved extends Kept {
  saved: true;
  rect: Rect;
  /** The screen's indices in the rectangle, row by row. */
  bits: Uint8Array;
  /** Kept by the driver's `SaveScreenBitmap` rather than in USER's bitmap. */
  inDriver: boolean;
}

const CS_SAVEBITS = 0x0800;

function savedOf(system: any, window: DesktopWindow) {
  return savesOf(system).find((one) => one.window === window) as Saved | undefined;
}

/** Whether USER keeps bits saved for a window (its byte at 24h's bit 80h). */
export function hasSaved(system: any, window: DesktopWindow) {
  return !!savedOf(system, window);
}

/** A window's class's style. */
export function classStyleOf(system: any, window: DesktopWindow) {
  const owner = window.hwnd ? system?.handles?.resolve(window.hwnd) : null;

  if (!(owner instanceof RasterWindow)) {
    return 0;
  }

  return system.handles.retrieve(owner.options.windowClass)?.style ?? 0;
}

/**
 * The bits under a window shown by `SetWindowPos` kept, where they are to be
 * (seg7 `0b75`-`0bde`): `screen` is the screen as it was before the list
 * was drawn.
 */
export function saveUnder(
  system: any,
  desktop: Desktop,
  window: DesktopWindow,
  screen: Uint8Array
) {
  if (!(classStyleOf(system, window) & CS_SAVEBITS) || window.parent || system._inSysErrorBox) {
    return;
  }

  /* No window before it among its brothers shows (`0b8e`-`0bc5`). */
  for (const other of desktop.windows) {
    if (other === window) {
      break;
    }

    if (!other.parent && other.visible) {
      return;
    }
  }

  const rule = saveScreenBitmapRule(system.display?.driverFile);

  if (rule === 'unread') {
    return;
  }

  /* A window that had bits saved has them no more (`0959` as they are
   * kept again). */
  discardSaved(system, window);

  /* Every context's bounds taken back for the records kept, then emptied
   * (`1e9c`-`1ec3`). */
  harvestAll(system);

  for (const entry of system._dcEntries ? entriesOf(system).list : []) {
    const bounds = boundsOf(entry.surface);

    bounds.windows.splice(0, 4, 0x7fff, 0x7fff, -0x8000, -0x8000);
    bounds.flags &= ~1;
  }

  const stride = desktop.screen.width;
  const rect: Rect = [
    Math.max(window.left, 0),
    Math.max(window.top, 0),
    Math.min(window.left + window.width, stride),
    Math.min(window.top + window.height, desktop.screen.height),
  ];

  if (rect[2] <= rect[0] || rect[3] <= rect[1]) {
    return;
  }

  const inDriver = rule === 'driver' && saveScreenBitmap(system, rect, 0) !== 0;
  const [width, height] = [rect[2] - rect[0], rect[3] - rect[1]];
  const bits = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const from = (rect[1] + y) * stride + rect[0];

    bits.set(screen.subarray(from, from + width), y * width);
  }

  const saved: Saved = { window, rect, still: null, gone: false, saved: true, bits, inDriver };

  savesOf(system).unshift(saved);

  /* What the windows from it back were due there, no longer due (`2028`-
   * `2063`): the desktop's own is not kept as a window's here. */
  const brothers = desktop.windows.filter((other) => !other.parent);

  for (const brother of brothers.slice(brothers.indexOf(window) + 1)) {
    if (!takeDue(system, saved, brother, true)) {
      break;
    }
  }
}

/**
 * The bits a window saved put back where `region` of the screen, what
 * showed of it and does not now, is (seg13 `211e`), and let go. Answers
 * what is still to be made due there and whether anything is: nothing
 * where all of it was put back.
 *
 * * Only what is still as it was is put back; nothing at all, and all of
 *   `region` due, where none of it is (`213c`-`2162`).
 * * Kept by the driver: it puts back all of its rectangle, whatever lies
 *   there now, and what of the rectangle was not as it was is due --
 *   nothing put back and all due where the driver answers nought
 *   (`2171`-`21cd`).
 * * Kept by USER: what is as it was is blitted back, no more, and the rest
 *   of `region` is due (`21d0`-`2253`).
 */
export function restoreUnder(
  system: any,
  desktop: Desktop,
  window: DesktopWindow,
  region: ClipRegion
): { due: boolean; region: ClipRegion } {
  const saved = savedOf(system, window);

  if (!saved) {
    return { due: true, region };
  }

  let restorable = region;
  let spoiled = false;

  if (saved.still) {
    spoiled = true;
    restorable = region.intersect(saved.still);

    if (restorable.kind <= 1) {
      discardSaved(system, window);
      return { due: true, region };
    }
  }

  const rect = saved.rect;
  const width = rect[2] - rect[0];
  const put = (x: number, y: number) =>
    desktop.screen.put(x, y, saved.bits[(y - rect[1]) * width + (x - rect[0])]);

  if (saved.inDriver) {
    saved.inDriver = false;

    if (saveScreenBitmap(system, rect, 1) === 0) {
      discardSaved(system, window);
      return { due: true, region };
    }

    for (let y = rect[1]; y < rect[3]; y++) {
      for (let x = rect[0]; x < rect[2]; x++) {
        put(x, y);
      }
    }

    desktop.screen.context.markRect(rect[0], rect[1], rect[2], rect[3]);

    const left = ClipRegion.rect(rect[0], rect[1], rect[2], rect[3]).subtract(restorable);

    discardSaved(system, window);

    return left.kind <= 1 ? { due: spoiled, region: left } : { due: true, region: left };
  }

  for (const band of restorable.bands) {
    for (let y = Math.max(band.top, rect[1]); y < Math.min(band.bottom, rect[3]); y++) {
      for (const [l, r] of band.spans) {
        for (let x = Math.max(l, rect[0]); x < Math.min(r, rect[2]); x++) {
          put(x, y);
        }
      }
    }
  }

  const box = restorable.box;

  desktop.screen.context.markRect(box.left, box.top, box.right, box.bottom);
  discardSaved(system, window);

  return { due: spoiled, region: region.subtract(restorable) };
}

/** A window's saved bits let go (seg1 `0959`): the driver's discarded. */
export function discardSaved(system: any, window: DesktopWindow) {
  const list = savesOf(system);
  const at = list.findIndex((one) => one.window === window);

  if (at < 0) {
    return;
  }

  const [saved] = list.splice(at, 1) as Saved[];

  if (saved.inDriver) {
    saveScreenBitmap(system, saved.rect, 2);
  }
}

/** The saved bits of a window destroyed, and of the windows in it, let go (seg1 `0830`). */
export function discardWithin(system: any, desktop: Desktop, window: DesktopWindow) {
  for (const saved of [...savesOf(system)]) {
    for (let at: DesktopWindow | null = saved.window; at; at = at.parent) {
      if (at === window) {
        discardSaved(system, saved.window);
        break;
      }
    }
  }

  void desktop;
}
