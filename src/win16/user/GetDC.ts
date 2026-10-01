'use strict';

import { lockedSurface } from './lock-window-update.js';

import { NULL } from '../consts.js';

import { SYSTEM_FONT, stockFontHandle } from '../gdi/stock-fonts.js';
import { GetStockObject } from '../gdi/GetStockObject.js';
import { Surface } from '../../raster/surface.js';
import { Color } from '../../raster/color.js';

const BLACK_PEN = 7;
const WHITE_BRUSH = 0;

/**
 * The **GetDC** function retrieves the handle of a device context for the
 * client area of the given window. The device context can be used in
 * subsequent graphics device interface (GDI) functions to draw in the client
 * area.
 *
 * The **GetDC** function retrieves a common, class, or private device context
 * depending on the class style specified for the given window. For common
 * device contexts, **GetDC** assigns default attributes to the context each
 * time it is retrieved. For class and private contexts, **GetDC** leaves the
 * previously assigned attributes unchanged.
 *
 * Unless the device context belongs to a window class, the
 * {@link User.ReleaseDC ReleaseDC} function must be called to release the
 * context after drawing. Since only five common device contexts are available
 * at any given time, failure to release a device context can prevent other
 * applications from accessing a device context. If the *`hwnd`* parameter of
 * the **GetDC** function is `NULL`, the first parameter of **ReleaseDC** should
 * also be `NULL`.
 *
 * A device context with special characteristics is returned by the **GetDC**
 * function if `CS_CLASSDC`, `CS_OWNDC`, or `CS_PARENTDC` style was specified
 * in the `WNDCLASS` structure when the class was registered. For more
 * information about these characteristics, see the description of the
 * `WNDCLASS` structure.
 *
 * @static
 * @function GetDC
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window where the drawing will
 *                            occur. If this parameter is `NULL`, the function
 *                            returns a device context for the screen.
 *
 * @returns {Types.HDC} The return value is a handle of the device context for
 *                      the given window's client area, if the function is
 *                      successful. Otherwise, it is `NULL`.
 */
export function GetDC(hwnd) {
  let surface;

  if (hwnd == NULL) {
    /* The screen itself. This used to answer 1 -- a number that resolves to
     * nothing, so every GDI call made with it found no surface. Programs ask
     * the screen how big it is and how wide their text will be before they
     * have a window to ask, which is what both of the drawing probes do.
     */
    surface = this.screen;
  } else {
    const dialog = this.handles.resolve(hwnd);

    if (!dialog) {
      return NULL;
    }

    /* The window `LockWindowUpdate` locked draws where it does not show. */
    const locked = lockedSurface(this, hwnd);

    surface = locked ?? dialog.surface;

    if (locked) {
      (this._windowDCs ??= new WeakMap()).set(locked, hwnd);
    }
  }

  if (!surface) {
    return NULL;
  }

  /* A device context comes with the system font already in it. Nothing has to
   * select a font before asking about text, and a program that never selects
   * one still draws in something -- so a context with no font is not a state
   * Windows ever hands out.
   *
   * Windows resets a common context's attributes on every `GetDC`, and this
   * does not: our context is the window's surface rather than a separate thing
   * borrowed from a pool of five, so what a program selects into it outlives
   * the release. That divergence is older and wider than this function.
   */
  if (!surface.font) {
    const font = stockFontHandle(this, SYSTEM_FONT);

    if (font) {
      surface.font = this.handles.resolve(font);
    }
  }

  /* A clip region or saved levels a program left do not outlive the device
   * context it had: Windows hands out a fresh one. Not recorded. */
  if (surface !== this.screen) {
    surface.clipRegion = null;
    surface.saved = [];

    /* And its brush origin, the client area's corner again (`brushorg`). */
    surface.brushOrg = undefined;

    resetCommon(this, hwnd, surface);
  }

  return takeFromCache(this, surface) ?? this.handles.allocate(surface);
}

const CACHED = 5;

/** The contexts released and not yet given out again, the oldest first. */
function cacheOf(system: any): { handle: number; surface: any }[] {
  return (system._dcCache ??= []);
}

/** A context given back: kept, still answering, for its surface to be given again. */
export function releaseToCache(system: any, hdc: number, surface: any) {
  const cache = cacheOf(system);

  if (cache.some((entry) => entry.handle === hdc)) {
    return;
  }

  cache.push({ handle: hdc, surface });

  while (cache.length > CACHED) {
    system.handles.free(cache.shift()!.handle);
  }
}

/** The context released last over a surface, given out again; none if none is. */
function takeFromCache(system: any, surface: any) {
  const cache = cacheOf(system);

  for (let at = cache.length - 1; at >= 0; at--) {
    if (cache[at].surface === surface && system.handles.resolve(cache[at].handle) === surface) {
      return cache.splice(at, 1)[0].handle;
    }
  }

  return null;
}

const CS_OWNDC = 0x0020;
const CS_CLASSDC = 0x0040;

/**
 * A common device context as `GetDC` and `BeginPaint` give it: what was
 * selected and set in the last forgotten -- the System font, black text on
 * white, opaque, `R2_COPYPEN`, the black pen and the white brush -- for a
 * window whose class has no device context of its own. One with `CS_OWNDC`
 * keeps everything (`dcreset`). Cribbage draws its status line in a context
 * it selected nothing into, after selecting a fixed font into the one
 * before; Windows draws it in the System font.
 */
export function resetCommon(system: any, hwnd: number, surface: any) {
  const live = surface.liveDCs ?? 0;

  surface.liveDCs = live + 1;

  /* winbox.js keeps one surface for a window, where Windows gives each
   * context its own: while another context of the window is still out --
   * a paint's, and a `GetDC` inside it, as Championship Slots' forms do --
   * resetting would take what that one has selected, and is left. */
  if (live > 0) {
    return;
  }

  const window = hwnd ? system.handles.resolve(hwnd) : null;
  const style = window?.options
    ? (system.handles.retrieve(window.options.windowClass)?.style ?? 0)
    : 0;

  if (!window || style & (CS_OWNDC | CS_CLASSDC)) {
    return;
  }

  /* What `dcreset` measured going back to its default, and no more. */
  const fresh: any = Surface.memory();

  for (const field of ['backMode', 'backcolor', 'rop2']) {
    surface[field] = fresh[field];
  }

  surface.textColor = new Color(0, 0, 0);

  const font = stockFontHandle(system, SYSTEM_FONT);

  if (font) {
    surface.font = system.handles.resolve(font);
  }

  surface.pen = system.handles.resolve(GetStockObject.call(system, BLACK_PEN));
  surface.brush = system.handles.resolve(GetStockObject.call(system, WHITE_BRUSH));
}
