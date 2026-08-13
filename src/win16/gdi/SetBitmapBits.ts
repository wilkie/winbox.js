'use strict';

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

  let bpRow = item.bpp * item.width;
  bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
  const widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

  const copied = 0;
  const size = Math.min(widthBytes * item.height, cbBuffer);

  // Copy the bitmap to the bitmap's data view.
  for (let i = 0; i < size; i++) {
    item.view.setUint8(i, cpu.read8(srcSegment, srcOffset));
  }

  return size;
}
