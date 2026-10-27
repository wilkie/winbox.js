'use strict';

import { Region } from './gdi-objects.js';
import { GetDCOrg } from './queries.js';
import { GetModuleHandle } from '../kernel/GetModuleHandle.js';
import { GetProcAddress } from '../kernel/GetProcAddress.js';

/**
 * GDI's calls on a device context that USER and the drivers make, and a
 * program may: the logical font selected, the relative-or-absolute mode,
 * the hook a context calls, its clip region's own handle, and `ResetDC`.
 *
 * **Recorded** by `dcinner` on the VGA and the 256-colour display, and
 * **read out** of `GDI.EXE`, each where it is told.
 */

/** USER's `DCHOOK`, ordinal 362, the hook USER sets on the contexts it lends. */
const USER_DCHOOK = 362;

/** Whether a handle stands for a device context. */
function contextOf(system: any, hdc: number) {
  const surface = hdc ? system.handles.resolve(hdc) : null;

  return surface && 'font' in surface ? surface : null;
}

/** Whether a context is one of a window's own surfaces, which stands for a context USER lends. */
function isWindows(system: any, surface: any) {
  const desktop = system.rasterDesktop;

  return !!desktop?.windows.some((w: any) => system.handles.resolve(w.hwnd)?.surface === surface);
}

/**
 * The logical font selected into a device context: its handle, the System
 * font's for a new context. **Read out** of seg1 `511a`, which reads the
 * context's word at 16h without asking what the handle is; nought here for
 * a handle that is no context. **Recorded** by `dcinner`.
 *
 * @returns {Types.HFONT} The font's handle.
 */
export function GetCurLogFont(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  return surface?.font ? (this.handles.lookup(surface.font) ?? 0) : 0;
}

/**
 * Sets whether `MoveTo` and the rest take points as absolute or relative:
 * GDI keeps the mode, which nothing it draws reads. **Read out** of seg1
 * `5218` and `51a6`: the word at the context's 80h, the one before
 * answered; a metafile's context records it (`META_SETRELABS`). **Recorded**
 * by `dcinner`: any number is kept, and `SaveDC` saves it.
 *
 * @returns {Types.INT} The mode before.
 */
export function SetRelAbs(this: any, hdc: number, mode: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  const before = surface.relAbs ?? 1;

  surface.relAbs = mode & 0xffff;

  return before;
}

/**
 * The relative-or-absolute mode, `ABSOLUTE`, 1, for a new context. **Read
 * out** of seg1 `5145` and `5162`: the dword at the context's 80h, so the
 * high word is the next field's, the polygon fill mode; nought for a handle
 * that is no context. **Recorded** by `dcinner`.
 *
 * @returns {Types.DWORD} The mode, and the fill mode above it.
 */
export function GetRelAbs(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  return (((surface.relAbs ?? 1) & 0xffff) | (((surface.polyFillMode ?? 1) & 0xffff) << 16)) >>> 0;
}

/** Whether a procedure is USER's `DCHOOK`, which WinBox runs itself. */
function isUserHook(system: any, proc: number) {
  if (!(proc >>> 0)) {
    return false;
  }

  const user = GetModuleHandle.call(system, 'USER');

  return !!user && GetProcAddress.call(system, user, USER_DCHOOK) >>> 0 === proc >>> 0;
}

/**
 * Sets the procedure GDI calls on a device context before using it, and
 * the dword it is given. **Read out** of seg31 `04ec`: both kept; a
 * procedure of nought clears the flag that has GDI call it. It answers 1,
 * the data's high word in DX. **Recorded** by `dcinner`.
 *
 * GDI calls the procedure -- the context, `DCHC_INVALIDVISRGN`, the data
 * and nought -- before a call uses the context while the flag
 * `SetHookFlags` sets is set (seg1 `4423`, `43f3`; `callHook`).
 *
 * @returns {Types.DWORD} 1.
 */
export function SetDCHook(this: any, hdc: number, lpfnHook: number, dwData: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  surface.dcHook = { proc: lpfnHook >>> 0, data: dwData >>> 0, user: isUserHook(this, lpfnHook) };

  if (!(lpfnHook >>> 0)) {
    surface.dcHookFlag = false;
  }

  return (((dwData >>> 16) << 16) | 1) >>> 0;
}

/**
 * The procedure a device context calls, written where `lplpfn` points, and
 * its data answered. **Read out** of seg31 `04b5`. **Recorded** by
 * `dcinner`: nought and nought for a new memory context; for a context USER
 * lends, USER's `DCHOOK` and data of USER's own -- the context's entry in
 * its cache, which here is the context's own handle.
 *
 * @returns {Types.DWORD} The data.
 */
export function GetDCHook(this: any, hdc: number, lplpfn: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  let hook = surface.dcHook;

  /* USER's own, which WinBox runs itself: its address as USER exports it. */
  if (hook?.user || (!hook && isWindows(this, surface))) {
    const user = GetModuleHandle.call(this, 'USER');

    hook = {
      proc: user ? GetProcAddress.call(this, user, USER_DCHOOK) : 0,
      data: hook?.data ?? hdc & 0xffff,
    };
  }

  if (lplpfn >>> 0) {
    const core = this.machine.cpu.core;
    const segment = (lplpfn >>> 16) & 0xffff;
    const offset = lplpfn & 0xffff;
    const proc = hook?.proc ?? 0;

    core.write16(segment, offset, proc & 0xffff);
    core.write16(segment, (offset + 2) & 0xffff, (proc >>> 16) & 0xffff);
  }

  return (hook?.data ?? 0) >>> 0;
}

/**
 * Sets or clears the flag that has GDI call a device context's hook:
 * `DCHF_INVALIDATEVISRGN`, 1, sets it, anything else clears it. **Read
 * out** of seg1 `76b0`: it answers 1 where the flag was set and 2 where it
 * was not, in AX and DX both. **Recorded** by `dcinner`.
 *
 * @returns {Types.DWORD} The flag before.
 */
export function SetHookFlags(this: any, hdc: number, flags: number) {
  const surface = contextOf(this, hdc);

  if (!surface) {
    return 0;
  }

  const before = surface.dcHookFlag ? 1 : 2;

  surface.dcHookFlag = (flags & 1) === 1;

  return ((before << 16) | before) >>> 0;
}

/**
 * The device context's own clip region: nought where it has none.
 * **Read out** of seg1 `5130`, the word at the context's 0Eh. **Recorded**
 * by `dcinner`: `SelectClipRgn` gives the context a region of its own, not
 * the one selected, and `IntersectClipRect` and `ExcludeClipRect` make one
 * where there was none. Its coordinates are the screen's: a window's
 * context's region is moved by its client area's corner.
 *
 * The region answered here is the clip region as it is when asked, made a
 * region object the context keeps; a program changing it changes nothing.
 *
 * @returns {Types.HRGN} The region, or nought.
 */
export function GetClipRgn(this: any, hdc: number) {
  const surface = contextOf(this, hdc);

  if (!surface?.clipRegion) {
    return 0;
  }

  const origin = GetDCOrg.call(this, hdc);
  const x = (origin << 16) >> 16;
  const y = origin >> 16;
  const shape = surface.clipRegion.offset(x, y);

  if (
    surface.clipRgnHandle &&
    this.handles.resolve(surface.clipRgnHandle) === surface.clipRgnObject
  ) {
    surface.clipRgnObject.shape = shape;

    return surface.clipRgnHandle;
  }

  surface.clipRgnObject = new Region(shape);
  surface.clipRgnHandle = this.handles.allocateGDI(surface.clipRgnObject);

  return surface.clipRgnHandle;
}

/**
 * Updates a printer's device context for a new `DEVMODE`. **Read out** of
 * seg31 `009c` and `0372`: nought for a context in a document's page, and
 * for one whose device is a raster display or whose driver does not answer
 * `QUERYESCSUPPORT` for `RESETDEVICE` (128); otherwise a new context is made
 * for the driver, the device and the port with the `DEVMODE`, the driver's
 * `RESETDEVICE` given the old, and the two contexts' contents exchanged.
 * **Recorded** by `dcinner`: a memory context's, a window's and the
 * screen's answer nought. WinBox's own printer answers no escape it is
 * asked about, so nought too; a driver's from the drive is not followed,
 * and answers nought.
 *
 * @returns {Types.HDC} The context, or nought.
 */
export function ResetDC(this: any, _hdc: number, _lpdm: number) {
  return 0;
}
