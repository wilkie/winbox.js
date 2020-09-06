"use strict";

/**
 * The **GetBitmapBits** function copies the bits of the specified bitmap into a
 * buffer.
 *
 * An application can use the {@link Gdi.GetObject GetObject} function to
 * determine the number of bytes to copy into the buffer pointed to by the
 * *`lpvBits`* parameter;
 *
 * **See also**:
 * {@link Gdi.GetObject GetObject}
 * {@link Gdi.SetBitmapBits SetBitmapBits}
 *
 * @static
 * @function GetBitmapBits
 * @memberof Gdi
 *
 * @param {Types.HDC} hbm - Identifies the bitmap.
 * @param {Types.LONG} cbBuffer - Specifies the number of bytes to be copied.
 * @param {Types.FARPTR} lpvBits - Points to the buffer that is to receive the
 *                                 bitmap. The bitmap is an array of bytes. This
 *                                 array conforms to a structure in which
 *                                 horizontal scan lines are multiples of 16
 *                                 bits.
 *
 * @return {Types.LONG} The return value specifies the number of bytes in the
 *                      bitmap if the function is successful. It is zero if
 *                      there is an error.
 */
export function GetBitmapBits(hbm, cbBuffer, lpvBits) {
    let memory = this.machine.memory;
    let item = this.handles.resolve(hbm);

    if (!item) {
        return 0;
    }

    let destSegment = ((lpvBits >> 16) & 0xffff) >> 3;
    let destOffset = lpvBits & 0xffff;

    let bpRow = item.bpp * item.width;
    bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
    let widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

    let copied = 0;
    let size = Math.min(widthBytes * item.height, cbBuffer);

    // Copy the bitmap to the specified array.
    for (let i = 0; i < size; i++) {
        memory.write8(destSegment, destOffset, item.view.getUint8(i));
    }

    return size;
}
