'use strict';

import { ClipRegion } from '../../raster/clip-region.js';
import { regionOf } from '../gdi/regions.js';
import { DSP_ALLCHILDREN, DSP_ENUMCLIPPEDCHILDREN, syncPaintFrom } from './erase.js';
import {
  RDW_ALLCHILDREN,
  RDW_CALLED,
  RDW_ERASENOW,
  RDW_FRAME,
  RDW_INVALIDATE,
  RDW_NOCHILDREN,
  RDW_UPDATENOW,
  RDW_VALIDATE,
  invalidateThrough,
  redrawThrough,
} from './invalidate-through.js';
import { DesktopHandle } from './desktop-handle.js';
import { tellLock } from './lock-window-update.js';
import { RasterWindow } from './raster-window.js';
import { updateNow } from './UpdateWindow.js';

/**
 * The **RedrawWindow** function updates the specified rectangle or region in
 * the given window's client area.
 *
 * When the **RedrawWindow** function is used to invalidate part of the desktop
 * window, the desktop window does not receive a `WM_PAINT` message. To repaint
 * the desktop, an application should use the `RDW_ERASE` flag to generate a
 * `WM_ERASEBKGND` message.
 *
 * **See also**:
 * {@link User.GetUpdateRect GetUpdateRect}
 * {@link User.GetUpdateRgn GetUpdateRgn}
 * {@link User.InvalidateRect InvalidateRect}
 * {@link User.InvalidateRgn InvalidateRgn}
 * {@link User.UpdateWindow UpdateWindow}
 *
 * @static
 * @function RedrawWindow
 * @memberof User
 *
 * @param {Types.HWND} hwnd - Identifies the window to be redrawn. If this
 *                            parameter is `NULL`, the desktop window is
 *                            updated.
 * @param {Types.RECT} lprcUpdate - Points to a RECT structure containing the
 *                                  coordinates of the update rectangle. This
 *                                  parameter is ignored if the *`hrgnUpdate`*
 *                                  parameter contains a valid region handle.
 * @param {Types.HRGN} hrgnUpdate - Identifies the update region. If both
 *                                  *`hrgnUpdate`* and *`lprcUpdate`* parameters
 *                                  are `NULL`, the entire client area is added
 *                                  to the update region.
 * @param {Types.UINT} fuRedraw - Specifies one or more redraw flags. This
 *                                parameter can be a combination of flags:
 *
 * The following flags are used to invalidate the window:
 * * `RDW_ERASE`: Causes the window to receive a `WM_ERASEBKGND` message when
 *                the window is repainted. The `RDW_INVALIDATE` flag must also
 *                be specified; otherwise, `RDW_ERASE` has no effect.
 * * `RDW_FRAME`: Causes any part of the non-client area of the window that
 *                intersects the update region to receive a `WM_NCPAINT`
 *                message. The `RDW_INVALIDATE` flag must also be specified;
 *                otherwise, `RDW_FRAME` has no effect. The `WM_NCPAINT`
 *                message is typically not sent during the execution of the
 *                **RedrawWindow** function unless either `RDW_UPDATENOW` or
 *                `RDW_ERASENOW` is specified.
 * * `RDW_INTERNALPAINT`: Causes a `WM_PAINT` message to be posted to the window
 *                        regardless of whether the window contains an invalid
 *                        region.
 * * `RDW_INVALIDATE`: Invalidate *`lprcUpdate`* or *`hrgnUpdate`* (only one may
 *                     be non-`NULL`). If both are `NULL` the entire window is
 *                     invalidated.
 *
 * The following flags are used to validate the window:
 * * `RDW_NOERASE`: Suppresses any pending `WM_ERASEBKGND` messages.
 * * `RDW_NOFRAME`: Suppresses any pending `WM_NCPAINT` messages. This flag must
 *                  be used with `RDW_VALIDATE` and is typically used with
 *                  `RDW_NOCHILDREN`. This option should be used with care, as
 *                  it could cause parts of a window from painting properly.
 * * `RDW_NOINTERNALPAINT`: Suppresses any pending internal `WM_PAINT` messages.
 *                          This flag does not affect `WM_PAINT` messages
 *                          resulting from invalid areas.
 * * `RDW_VALIDATE`: Validates *`lprcUpdate`* or *`hrgnUpdate`* (only one may
 *                   be non-`NULL`). If both are `NULL` the entire window is
 *                   validated. This flag does not affect internal `WM_PAINT`
 *                   messages.
 *
 * The following flags control when repainting occurs. No painting is performed
 * by the **RedrawWindow** function unless one of these bits is specified.
 * * `RDW_ERASENOW`: Causes the affected windows (as specified by the
 *                   `RDW_ALLCHILDREN` and `RDW_NOCHILDREN` flags) to receive
 *                   `WM_NCPAINT` and `WM_ERASEBKGND` messages, if necessary,
 *                   before the function returns. `WM_PAINT` messages are
 *                   deferred.
 * * `RDW_UPDATENOW`: Causes the affected windows (as specified by the
 *                    `RDW_ALLCHILDREN` and `RDW_NOCHILDREN` flags) to receive
 *                    `WM_NCPAINT`, `WM_ERASEBKGND`, and `WM_PAINT` messages, if
 *                    necessary, before the function returns.
 *
 * By default, the windows affected by the **RedrawWindow** function depend on
 * whether the specified window has the `WS_CLIPCHILDREN` style. The child
 * windows of `WS_CLIPCHILDREN` windows are not affected; however,
 * non-`WS_CLIPCHILDREN` windows are recursively validated or invalidated until
 * a `WS_CLIPCHILDREN` window is encountered. The following flags control which
 * windows are affected by the **RedrawWindow** function:
 * * `RDW_ALLCHILDREN`: Includes child windows, if any, in the repainting
 *                      operation.
 * * `RDW_NOCHILDREN`: Excludes child windows, if any, from the repainting
 *                     operation.
 *
 * **Read out** (`USER.EXE` seg1 `aabf`, `3e1e`, `3ed7`; [[probe:rdwwalk]]):
 *
 * * A handle that is no window, or a region that is no region, answers
 *   nought (`aac8`, `aadd`-`aaec`, KERNEL's `HandleParamError`); flags
 *   above 0FFFh are warned of and go on (`aaef`-`aafa`). Else it answers 1,
 *   for a window that does not show too (`3ecd`).
 * * The rectangle or region is in the client area's terms, put on the
 *   screen (`3e5c`-`3ebb`); with neither, all of the window. Only with
 *   `RDW_INVALIDATE` or `RDW_VALIDATE` (`3e56`).
 * * Made due or validated through USER's walk (`invalidate-through.ts`).
 * * Then `RDW_UPDATENOW` paints the window, and the windows in it but with
 *   `RDW_NOCHILDREN` (`3f93`-`3fad`, seg1 `441d`); else `RDW_ERASENOW` draws
 *   the frames and erases now (`3faf`-`3fcf`, seg1 `7913`): the windows in it
 *   with `RDW_ALLCHILDREN`, none with `RDW_NOCHILDREN`, else those of a
 *   window with `WS_CLIPCHILDREN`.
 *
 * @return {Types.BOOL} The return value is nonzero if the function is
 *                      successful. Otherwise, it is zero.
 */
export async function RedrawWindow(hwnd, lprcUpdate, hrgnUpdate, fuRedraw) {
  const desktop = this.rasterDesktop;
  const resolved = hwnd ? this.handles.resolve(hwnd) : null;
  /* The desktop's own handle is the desktop, as none is (`3e2d`-`3e31`). */
  const owner = resolved instanceof DesktopHandle ? null : resolved;

  if (!desktop || (owner && !(owner instanceof RasterWindow)) || (hwnd && !resolved)) {
    return 0;
  }

  const given = hrgnUpdate ? regionOf(this, hrgnUpdate) : null;

  if (hrgnUpdate && !given) {
    return 0;
  }

  const window = owner ? owner.window : null;
  const x = window ? window.left + window.client.left : 0;
  const y = window ? window.top + window.client.top : 0;
  let region: ClipRegion | null = null;

  if (fuRedraw & (RDW_INVALIDATE | RDW_VALIDATE)) {
    if (given) {
      region = given.shape.offset(x, y);
    } else if (lprcUpdate) {
      region = ClipRegion.rect(
        lprcUpdate.left + x,
        lprcUpdate.top + y,
        lprcUpdate.right + x,
        lprcUpdate.bottom + y
      );
    }
  }

  if (window) {
    const box = given ? given.shape.box : lprcUpdate;

    const told = () => tellLock(this, window, box, !!(fuRedraw & RDW_FRAME));

    if (!redrawThrough(desktop, window, region, fuRedraw, told)) {
      return 1;
    }
  } else {
    invalidateThrough(desktop, null, region, fuRedraw | RDW_CALLED);
  }

  if (fuRedraw & RDW_UPDATENOW) {
    if (window) {
      await updateNow(this, desktop, window, !(fuRedraw & RDW_NOCHILDREN));
    } else if (!(fuRedraw & RDW_NOCHILDREN)) {
      /* The desktop's own drawn first; the windows at the top, front to
       * back (`44c5`-`450e`). */
      desktop.paintBackgroundDue();

      for (const top of desktop.windows.filter((one: any) => !one.parent)) {
        await updateNow(this, desktop, top, true);
      }
    }
  } else if (fuRedraw & RDW_ERASENOW) {
    await syncPaintFrom(
      this,
      window,
      fuRedraw & RDW_NOCHILDREN
        ? 0
        : fuRedraw & RDW_ALLCHILDREN
          ? DSP_ALLCHILDREN
          : DSP_ENUMCLIPPEDCHILDREN
    );
  }

  return 1;
}
