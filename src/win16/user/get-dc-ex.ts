'use strict';

import { Region } from '../gdi/gdi-objects.js';

import { lendsTo, takeEntry } from './dc-entries.js';
import { withFont } from './GetDC.js';

/**
 * A device context of a window's, as `GetDC` and `GetWindowDC` give one,
 * its visible region worked out by the flags (`USER.EXE` seg1 `a64c`, the
 * checks, then `847b`-`87b7`). **Recorded** by `getdcex` and `visrgn`:
 *
 * * No window, nought.
 * * Without `DCX_CACHE`, a window whose class has no context of its own
 *   gets none: USER looks among its contexts for the window's own or its
 *   class's (`8560`-`85b3`), and answers nought where there is none
 *   (`85b6`).
 * * `DCX_CACHE` gives the client area's, as `GetDC` does; with
 *   `DCX_WINDOW`, the whole window's, as `GetWindowDC` does.
 * * The region is USER's rule's for the flags (`visible-region-rule.ts`):
 *   `DCX_CLIPCHILDREN` keeps drawing off the window's children,
 *   `DCX_CLIPSIBLINGS` off its siblings above, `DCX_PARENTCLIP` gives the
 *   parent's, `DCX_USESTYLE` takes them from the styles.
 * * `DCX_INTERSECTRGN` keeps it inside a region given in the screen's
 *   terms; `DCX_EXCLUDERGN` out of it (`86e7`, `8745`). The region is
 *   deleted when the context is released, unless `DCX_KEEPCLIPRGN` is
 *   given too (`8703`-`8709`). For `DCX_INTERSECTRGN`, nought leaves
 *   nothing (`8711`-`871d`); for `DCX_EXCLUDERGN`, nought is nothing
 *   given (`874e`). A handle that is no region answers nought (`a658`):
 *   1, which the body takes for the whole screen (`86f0`, `876b`), is for
 *   USER's own callers.
 *
 * These are in the visible region, as Windows keeps them: `SelectClipRgn`
 * after leaves them. The entry USER lends, and when its region is worked
 * out, are `dc-entries.ts`'s.
 */
export function GetDCEx(this: any, hwnd: number, hrgnClip: number, flags: number) {
  if (!hwnd || !lendsTo(this, hwnd)) {
    return 0;
  }

  /* A region given that is not one, nought (`a658`-`a66d`): even 1, which
   * USER's own callers pass for the whole screen (`visrule`). */
  if (hrgnClip && !(this.handles.resolve(hrgnClip) instanceof Region)) {
    return 0;
  }

  const hdc = takeEntry(this, hwnd, hrgnClip, flags >>> 0);

  if (hdc) {
    withFont(this, this.handles.resolve(hdc));
  }

  return hdc;
}
