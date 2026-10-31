'use strict';

import { setUpdate, shapeOf, updateOf } from './update-region.js';
import { User } from '../user.js';
import { RasterWindow } from './raster-window.js';
import { paintsItself } from './desktop.js';
import { windowVersion } from '../module.js';
import { GetDC } from './GetDC.js';
import { ReleaseDC } from './ReleaseDC.js';
import { paintsIcon, WM_ICONERASEBKGND } from './paint-icon.js';
import { CreateRectRgn } from '../gdi/gdi-objects.js';
import { DeleteObject } from '../gdi/DeleteObject.js';
import { ClipRegion } from '../../raster/clip-region.js';
import { releaseEntry, takeEntry } from './dc-entries.js';
import { DCX_INTERSECTRGN } from './visible-region-rule.js';

/** The high word of the flags USER erases a window with (seg1 `7ac1`). */
const ERASE_FLAGS = 0x00050000;

/**
 * Erasing a window's background, as USER does it (`USER.EXE` seg1 `7a83`,
 * the only place `WM_ERASEBKGND` is sent from). **Read out** and recorded by
 * the `nobrush` probe.
 *
 * * An erase not done -- the window procedure answered nought -- is noted on
 *   the window, and `BeginPaint` hands the note back as `fErase`, 4 (seg1
 *   `7afa`, `76ac`). The note stays until the next erase is tried.
 * * For a program made for a Windows before 3.1, an erase not done is still
 *   to be done: `BeginPaint` asks again (seg1 `7afe`; `CreateWindow` marks a
 *   window of a 3.1 program at seg8 `42d`).
 */

/**
 * `WM_NCPAINT` to a window whose frame is due: 1 for all of it, or a
 * region of the screen for the part due, a handle of its own made for the
 * message and deleted after it (`showseq`: a window a pop-up had covered
 * part of, as the pop-up went). Where what it is due is a region of its
 * own, `shape`, a copy of it, whatever it covers (`USER.EXE` seg1
 * `7ba0`-`7be4`, `7b52`; [[probe:rdwwalk]]); 1 where it is due all of
 * itself (`7bab`).
 */
export async function sendNcPaint(
  system: any,
  hwnd: number,
  dialog: RasterWindow,
  due: number[] | undefined,
  shape?: ClipRegion
) {
  const window: any = dialog.window;
  const windowClass = system.handles.retrieve(dialog.options.windowClass);
  let copy: ClipRegion | null = null;

  /* Its frame changed, or it was sized: a region of all of it
   * (`swpframe`). */
  if (window.frameRegion) {
    window.frameRegion = false;
    due = [window.left, window.top, window.left + window.width, window.top + window.height];
  } else if (
    due &&
    shape &&
    shape.kind > 1 &&
    shape.box.left === due[0] &&
    shape.box.top === due[1] &&
    shape.box.right === due[2] &&
    shape.box.bottom === due[3]
  ) {
    copy = shape;
  } else if (
    !due ||
    (due[0] <= window.left &&
      due[1] <= window.top &&
      due[2] >= window.left + window.width &&
      due[3] >= window.top + window.height)
  ) {
    /* A box with no region of its own that covers it: all of it. */
    due = undefined;
  }

  const whole = !due;
  const region = due ? CreateRectRgn.call(system, due[0], due[1], due[2], due[3]) : 1;

  if (copy) {
    const made = system.handles.resolve(region);

    if (made) {
      made.shape = copy;
    }
  }

  await system.scheduler.callWndProc(windowClass, hwnd, User.WM_NCPAINT, region, 0);

  if (!whole) {
    DeleteObject.call(system, region);
  }
}

/** Sends the window its erase message, on `hdc`, and notes what came of it. */
export async function sendErase(system: any, hwnd: number, dialog: RasterWindow, hdc: number) {
  const window: any = dialog.window;
  const windowClass = system.handles.retrieve(dialog.options.windowClass);
  const message = paintsIcon(system, hwnd) ? WM_ICONERASEBKGND : User.WM_ERASEBKGND;

  window.needsErase = false;
  window.unerased = false;

  const answer = await system.scheduler.callWndProc(windowClass, hwnd, message, hdc, 0);

  if ((answer & 0xffff) === 0) {
    window.unerased = true;
    window.needsErase = expectedVersion(system, dialog) < 0x30a;
  }
}

/** `PAINTSTRUCT.fErase` for a window: 4 when its last erase was not done. */
export function eraseNotDone(dialog: RasterWindow) {
  return (dialog.window as any).unerased ? 4 : 0;
}

/**
 * The erase a window is due, done now rather than at `BeginPaint`: what the
 * end of `SetWindowPos` does for the windows it showed or uncovered (seg7
 * `28d`, seg1 `7913`). A window of another task is left to its `BeginPaint`
 * -- USER sends it `WM_SYNCPAINT` instead, not followed here.
 */
export async function eraseNow(system: any, hwnd: number) {
  const dialog = system.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow) || !dialog.window.needsErase || !dialog.window.visible) {
    return;
  }

  const task = system.scheduler.windowTask?.(hwnd);

  if (task && task !== system.scheduler.active) {
    return;
  }

  /* USER's entry for the client area with `DCX_INTERSECTRGN` of what is
   * due, its visible region within it (seg1 `7a83`-`7ac6`: `GetDCEx` with
   * 50080h; `swpunc`): its clip box what the window is told is to be
   * erased, nothing where nothing is (`swpframe`). All of it, where it is
   * due all over. An icon is erased as before, through `GetDC`. */
  const window: any = dialog.window;
  const clip: number[] | undefined = window.paintClip;
  const icon = window.state === 'minimized';
  const due =
    clip && !icon
      ? clip[2] <= clip[0] || clip[3] <= clip[1]
        ? ClipRegion.EMPTY
        : window.paintShape
          ? ClipRegion.rect(clip[0], clip[1], clip[2], clip[3]).intersect(window.paintShape)
          : ClipRegion.rect(clip[0], clip[1], clip[2], clip[3])
      : undefined;
  const hdc = due
    ? takeEntry(system, hwnd, 0, ERASE_FLAGS | DCX_INTERSECTRGN, due)
    : GetDC.call(system, hwnd);
  const surface = icon && clip ? system.handles.resolve(hdc) : null;
  const before = surface?.clipRegion ?? null;

  if (surface && clip) {
    const x = window.left + window.client.left;
    const y = window.top + window.client.top;

    surface.clipRegion =
      clip[2] <= clip[0] || clip[3] <= clip[1]
        ? ClipRegion.EMPTY
        : ClipRegion.rect(clip[0] - x, clip[1] - y, clip[2] - x, clip[3] - y);
  }

  await sendErase(system, hwnd, dialog, hdc);

  if (surface) {
    surface.clipRegion = before;
  }

  /* Given back as `EndPaint` gives one, its region given let go (`7b0e`-`7b13`: seg1 `8805` with 1). */
  if (due) {
    releaseEntry(system, hdc, true);
  } else {
    ReleaseDC.call(system, hwnd, hdc);
  }
}

/**
 * Every window due an erase, erased now, as `SetWindowPos` ends -- showing,
 * hiding, moving, a menu closing -- and not only what that uncovered (seg1
 * `7913` on the desktop, which walks every window). Each is sent
 * `WM_NCPAINT` if its frame is due, then erased where it is due. Its
 * `WM_PAINT` waits for its program to take its messages. **Recorded** by
 * `uncover`, `uncovr2` and `menuinv`: a window invalidated while a menu was
 * up is erased the moment the menu goes.
 */
export async function eraseDue(system: any) {
  const desktop = system.rasterDesktop;

  for (const window of [...(desktop?.windows ?? [])]) {
    if (!paintsItself(window) || !window.visible || !(window.needsErase || window.needsNcPaint)) {
      continue;
    }

    /* A child waits for its own `BeginPaint` (`showseq`). */
    if (window.parent) {
      continue;
    }

    /* Nor within a hidden window: moved there, it is due its erase when it
     * shows, not before (`defer`). */
    if (!parentsShown(window)) {
      continue;
    }

    const dialog = system.handles.resolve(window.hwnd);
    const task = system.scheduler.windowTask?.(window.hwnd);

    if (!(dialog instanceof RasterWindow)) {
      continue;
    }

    /* A window of another task is sent `WM_SYNCPAINT`, and draws itself in
     * its own task (`syncpnt`). What it is sent with is not recorded. */
    if (task && task !== system.scheduler.active) {
      const windowClass = system.handles.retrieve(dialog.options.windowClass);

      await system.scheduler.callWndProc(windowClass, window.hwnd, WM_SYNCPAINT, 0, 0);
      continue;
    }

    await syncPaint(system, window.hwnd);
  }
}

/** `DoSyncPaint`'s flags (`USER.EXE` seg1 `7913`). */
export const DSP_ENUMCLIPPEDCHILDREN = 0x0004;
const DSP_NOCHECKPARENTS = 0x0010;
export const DSP_ALLCHILDREN = 0x0020;
const WS_CLIPCHILDREN = 0x02000000;

/**
 * Whether a window's paint waits for a window it is in: one up to the first
 * with `WS_CLIPCHILDREN` that has an update region, or is due a paint of
 * its own (`USER.EXE` seg1 `7a64`). Its paint will draw over the window.
 */
function parentPending(window: any) {
  for (let up = window.parent; up && !(up.style & WS_CLIPCHILDREN); up = up.parent) {
    if (up.needsPaint) {
      return true;
    }
  }

  return false;
}

/**
 * What the end of `SetWindowPos` draws at once (`USER.EXE` seg7 `0286`-
 * `028d`, seg1 `7913`): from the parent of the windows it placed -- the
 * desktop for null -- with `DSP_ENUMCLIPPEDCHILDREN`. **Read out**:
 *
 * * A window whose paint waits for a window it is in is passed over, and so
 *   are the windows in it (`798d`-`799f`, `7a64`); the windows below are
 *   not asked again.
 * * A window due its frame is sent `WM_NCPAINT`, and one due an erase is
 *   erased, where it has an update region (`79a2`-`79d8`, `7930`-`7961`). A
 *   window of another task is sent `WM_SYNCPAINT` instead, and the windows
 *   in it are left (`79e6`-`7a02`).
 * * Then the windows in it, front to back, where it has `WS_CLIPCHILDREN`
 *   -- the desktop has -- or `DSP_ALLCHILDREN` is given; a child of another
 *   task is passed over (`796a`-`797f`, `7a04`-`7a59`).
 *
 * Twin of `sync_paint_from` in `crates/winbox-win16/src/erase.rs`.
 */
export async function syncPaintFrom(system: any, window: any, flags = DSP_ENUMCLIPPEDCHILDREN) {
  const desktop = system.rasterDesktop;

  if (!desktop) {
    return;
  }

  /* The desktop's own part, where it is due, drawn first ([[probe:rdwmore]],
   * `RDW_ERASENOW`). */
  if (!window) {
    desktop.paintBackgroundDue();
  }

  if (window) {
    if (!(flags & DSP_NOCHECKPARENTS)) {
      if (parentPending(window)) {
        return;
      }

      flags |= DSP_NOCHECKPARENTS;
    }

    if (window.needsNcPaint || window.needsErase) {
      if (!window.visible) {
        window.needsNcPaint = false;
        window.needsErase = false;
      } else {
        /* With no update region it is not erased (`79ce`-`79d8`). A frame
         * changed in place is due its frame alone, kept as an empty box
         * (`Desktop.frameChanged`): it has one. */
        if (!window.needsPaint && !window.dirtyRect) {
          window.needsErase = false;
        }

        const task = system.scheduler.windowTask?.(window.hwnd);

        if (task && task !== system.scheduler.active) {
          const dialog = system.handles.resolve(window.hwnd);

          if (dialog instanceof RasterWindow) {
            const windowClass = system.handles.retrieve(dialog.options.windowClass);

            await system.scheduler.callWndProc(windowClass, window.hwnd, WM_SYNCPAINT, 0, 0);
          }

          return;
        }

        if (paintsItself(window)) {
          await syncPaint(system, window.hwnd);
        }
      }
    }
  }

  /* The windows in it with `DSP_ALLCHILDREN`, or with
   * `DSP_ENUMCLIPPEDCHILDREN` where it has `WS_CLIPCHILDREN` -- the desktop
   * has (`796a`-`797c`). */
  if (!(
    flags & DSP_ALLCHILDREN ||
    (flags & DSP_ENUMCLIPPEDCHILDREN && (!window || window.style & WS_CLIPCHILDREN))
  )) {
    return;
  }

  for (const child of desktop.windows.filter((other: any) => other.parent === window)) {
    if (window) {
      const task = system.scheduler.windowTask?.(child.hwnd);

      if (task && task !== system.scheduler.active) {
        continue;
      }
    }

    await syncPaintFrom(
      system,
      child,
      flags & (DSP_ALLCHILDREN | DSP_NOCHECKPARENTS | DSP_ENUMCLIPPEDCHILDREN)
    );
  }
}

/** Whether every window a window is in is shown. */
function parentsShown(window: any) {
  for (let parent = window.parent; parent; parent = parent.parent) {
    if (!parent.visible) {
      return false;
    }
  }

  return true;
}

/**
 * What an uncovered window is due, drawn now: `WM_NCPAINT` where its frame
 * was uncovered, then its erase, clipped to what was uncovered, as
 * `BeginPaint`'s is. `DefWindowProc` does this for `WM_SYNCPAINT`.
 */
export async function syncPaint(system: any, hwnd: number) {
  const dialog = system.handles.resolve(hwnd);

  if (!(dialog instanceof RasterWindow) || !dialog.window.visible) {
    return;
  }

  const window: any = dialog.window;

  if (window.needsNcPaint) {
    window.needsNcPaint = false;
    await sendNcPaint(
      system,
      hwnd,
      dialog,
      window.needsPaint ? window.dirtyRect : undefined,
      window.needsPaint ? shapeOf(window, window.dirtyRect) : undefined
    );
  }

  /* What it is due cut to its client area as its frame is drawn: nothing
   * left, it is due no paint (seg1 `7ba0` with 1, `7bfa`-`7c5b`). The erase
   * goes by what was due before (`7bdc`, `7a83`). */
  const box = window.dirtyRect;
  const due = window.needsPaint && box ? updateOf(window) : null;

  if (due) {
    const left = window.left + window.client.left;
    const top = window.top + window.client.top;
    const erase = window.needsErase;

    setUpdate(
      window,
      due.intersect(
        ClipRegion.rect(left, top, left + window.clientWidth, top + window.clientHeight)
      ),
      erase
    );
    window.needsErase = erase;
  }

  const clip = window.paintClip;
  const shape = window.paintShape;

  window.paintClip = box;
  window.paintShape = due ?? undefined;
  await eraseNow(system, hwnd);
  window.paintClip = clip;
  window.paintShape = shape;
}

export const WM_SYNCPAINT = 0x0088;

/**
 * The Windows version the window's module was made for: the module of the
 * instance it was made with, as the Rust engine's `expected_version`.
 */
function expectedVersion(system: any, dialog: RasterWindow) {
  return windowVersion(system, dialog);
}
