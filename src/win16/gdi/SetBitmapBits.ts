'use strict';

import { bitsSize, writeByte } from './ddb.js';

/**
 * The **SetBitmapBits** function sets the bits of the given bitmap to the
 * specified values.
 *
 * **See also**:
 * {@link Gdi.GetBitmapBits GetBitmapBits}
 *
 * @static
 * @function SetBitmapBits
 * @memberof Gdi
 *
 * @param {Types.HDC} hbmp - Identifies the bitmap to be set.
 * @param {Types.LONG} cbBuffer - Specifies the number of bytes pointed to by
 *                                the *`lpvBits`* parameter.
 * @param {Types.FARPTR} lpvBits - Points to an array of bytes for the bitmap
 *                                 bits.
 *
 * @return {Types.LONG} The return value is the number of bytes used in setting
 *                      the bitmap bits, if the function is successful.
 *                      Otherwise the return value is zero.
 */
export function SetBitmapBits(hbmp, cbBuffer, lpvBits) {
  const cpu = this.machine.cpu.core;
  const item = this.handles.resolve(hbmp);

  if (!item) {
    return 0;
  }

  const srcSegment = (lpvBits >> 16) & 0xffff;
  const srcOffset = lpvBits & 0xffff;

  /* Rows padded to words, as `CreateBitmap` takes them -- the documented
   * shape of a device-dependent bitmap, which `bitbits` recorded for
   * `CreateBitmap` and `GetBitmapBits`. This call itself is not recorded,
   * nor whether bits set here reach a bitmap already selected into a
   * surface; see `ddb.ts`. It used to read the same source byte every time. */
  const size = Math.min(bitsSize(item), cbBuffer);

  for (let at = 0; at < size; at++) {
    writeByte(item, at, cpu.read8(srcSegment, srcOffset + at));
  }

  return size;
}
