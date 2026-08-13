'use strict';

import { Palette } from '../../raster/palette.js';
import { Bitmap } from '../../raster/bitmap.js';

import { NULL } from '../consts.js';

export function CreateBitmap(nWidth, nHeight, cbPlanes, cbBits, lpvBits) {
  /* UNDOCUMENTED FEATURE ALERT !!!
   *
   * Microsoft decided that CreateBitmap has "UINT" arguments but they are
   * coerced to smaller 8-bit values. So you can pass 0xab01 to cbBits and it
   * will create a monochrome bitmap. Makes sense. Seems good. Thanks a lot.
   *
   * SkiFree does this, for instance. All so it can save a byte by using a
   * MOV AL, 0x1 instead of the MOV AX, I guess.
   * */
  cbBits = cbBits & 0xff;
  cbPlanes = cbPlanes & 0xff;

  const srcSegment = (lpvBits >> 16) & 0xffff;
  let srcOffset = lpvBits & 0xffff;

  // Get bitmap data
  let bpRow = cbBits * nWidth;
  bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
  const widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

  const copied = 0;
  const size = widthBytes * nHeight;

  // We also need to determine a palette
  let palette = null;
  if (cbBits == 1) {
    palette = Palette.PALETTE2;
  } else if (cbBits == 4) {
    palette = Palette.PALETTEWIN16;
  } else if (cbBits == 8) {
    palette = Palette.PALETTEWIN256;
  }

  const data = new Uint8Array(size);

  if (lpvBits) {
    for (let i = 0; i < size; i++) {
      data[i] = this.machine.cpu.core.read8(srcSegment, srcOffset);
      srcOffset++;
    }
  }

  // Create the view
  const view = new DataView(data.buffer);

  // Get the local heap.
  //let segment = this.machine.cpu.core.ds >> 3;
  //let heap = this.allocator.heapOf(segment);

  // Allocate the bitmap handle in memory?
  //heap.insert(view);

  // Create a bitmap.
  const bitmap = new Bitmap(nWidth, nHeight, cbBits, Bitmap.RGBA, view, palette);
  const handle = this.handles.allocate(bitmap);

  return handle;
}
