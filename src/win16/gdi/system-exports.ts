'use strict';

import { SelectObject } from './SelectObject.js';

/**
 * GDI's small exports for USER and the system, as `GDI.EXE` has them
 * (**read out**; **recorded** by `gdimisc`). As the Rust engine's
 * `gdi/system_exports.rs`.
 */

/**
 * An object marked private to the system, or the mark taken off (seg1
 * `0e68`): flag 2000h of the word at +2 of the object's header, set for any
 * `fPrivate` not nought, the flag as it was answered -- 2000h or nought.
 * No handle is checked: WinBox answers nought for one that names no
 * object. The mark changes nothing else here; in Windows it keeps
 * `DeleteObject` and the task's clean-up from the object.
 */
export function MakeObjectPrivate(this: any, hObject: number, fPrivate: number) {
  const object = this.handles.resolve(hObject);

  if (!object || typeof object !== 'object') {
    return 0;
  }

  const before = object.privateToSystem ? 0x2000 : 0;

  object.privateToSystem = (fPrivate & 0xffff) !== 0;
  return before;
}

/** GDI's library exit (seg1 `1ec0`): `mov ax,1` and back, whatever is asked. */
export function WEP(this: any, _code: number) {
  return 1;
}

/**
 * A memory device context's bitmap selected, or with nought the stock
 * bitmap every memory context starts with (seg1 `1ac6`: GDI's word 15Bh
 * for nought, then `SelectObject`'s own selecting of a bitmap at `1be2`):
 * the bitmap before. WinBox makes its stock bitmap's handle the first time
 * a memory context's first bitmap is replaced (`SelectObject`); before
 * that no context holds another, and nought is answered.
 */
export function SelectBitmap(this: any, hdc: number, hbm: number) {
  const bitmap = hbm & 0xffff ? hbm : (this.stockBitmap ?? 0);

  return bitmap ? SelectObject.call(this, hdc, bitmap) : 0;
}

/**
 * A bitmap's bits let move (seg2 `0403`): `GlobalWire` and `GlobalUnWire`
 * of the block its header names at +0Ah, `GlobalUnWire`'s answer --
 * -1, its count back to nought, for a block no one has locked. WinBox's
 * bitmaps keep their bits in no global block: -1.
 */
/**
 * Bytes copied for the spooler (seg28 `0000`): `rep movsb` of `count` bytes
 * from `lpSource` to `lpDestination`, forward a byte at a time, so a copy
 * onto bytes just past its source repeats them. Nothing is answered.
 */
export function Copy(this: any, lpDestination: number, lpSource: number, count: number) {
  const core = this.machine.cpu.core;
  const to = lpDestination >>> 0;
  const from = lpSource >>> 0;

  for (let at = 0; at < (count & 0xffff); at++) {
    core.write8(
      to >>> 16,
      ((to & 0xffff) + at) & 0xffff,
      core.read8(from >>> 16, ((from & 0xffff) + at) & 0xffff)
    );
  }
}

/**
 * A memory bitmap's fonts walked for a driver (seg13 `0163`): `mov ax,1`
 * and `retf 10h` -- a bitmap has no fonts of its own, and none is walked.
 */
export function DMEnumDFonts(
  this: any,
  _lpDestDev: number,
  _lpFaceName: number,
  _lpCallbackFunc: number,
  _lpClientData: number
) {
  return 1;
}

export function GDIMoveBitmap(this: any, _hbm: number) {
  return 0xffff;
}
