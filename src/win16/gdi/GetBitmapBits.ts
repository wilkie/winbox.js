'use strict';

import { bitsSize, readByte } from './ddb.js';

/**
 * Copies a bitmap's bits into a buffer, in rows padded to 16-bit words.
 *
 * Recorded by `bitbits`: the bits follow what was drawn into the bitmap, not
 * what it was created with; a row is padded to a word; and a buffer smaller
 * than the bitmap gets exactly as many bytes as it holds, which is what the
 * call returns. Earlier this wrote every byte to the buffer's first address,
 * from the bitmap as it was created, in rows padded to four bytes. See
 * `ddb.ts`.
 *
 * @param {Types.HBITMAP} hbm - The bitmap.
 * @param {Types.LONG} cbBuffer - How many bytes the buffer holds.
 * @param {Types.FARPTR} lpvBits - The buffer.
 *
 * @returns {Types.LONG} How many bytes were copied.
 */
export function GetBitmapBits(hbm, cbBuffer, lpvBits) {
  const item = this.handles.resolve(hbm);

  if (!item || !lpvBits) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lpvBits >>> 16) & 0xffff;
  const offset = lpvBits & 0xffff;
  const size = Math.min(bitsSize(item), cbBuffer);

  for (let at = 0; at < size; at++) {
    core.write8(segment, offset + at, readByte(item, at));
  }

  return size;
}
