"use strict";

import { Palette } from '../../raster/palette.js';
import { Bitmap } from '../../raster/bitmap.js';

import { NULL } from '../consts.js';

export function CreateBitmap(nWidth, nHeight, cbPlanes, cbBits, lpvBits) {
    let memory = this.machine.memory;

    let srcSegment = ((lpvBits >> 16) & 0xffff) >> 3;
    let srcOffset = lpvBits & 0xffff;

    // Get bitmap data
    let bpRow = cbBits * nWidth;
    bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
    let widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

    let copied = 0;
    let size = widthBytes * nHeight;

    // We also need to determine a palette
    let palette = null;
    if (cbBits == 1) {
        palette = Palette.PALETTE2;
    }
    else if (cbBits == 4) {
        palette = Palette.PALETTEWIN16;
    }
    else if (cbBits == 8) {
        palette = Palette.PALETTEWIN256;
    }

    let data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
        data[i] = memory.read8(srcSegment, srcOffset);
        srcOffset++;
    }

    // Create the view
    let view = new DataView(data.buffer);

    // Get the local heap.
    let segment = this.machine.cpu.ds >> 3;
    let heap = this.allocator.heapOf(segment);

    // Allocate the bitmap in memory
    heap.insert(view);
 
    // Create a bitmap.
    let bitmap = new Bitmap(nWidth, nHeight, cbBits, Bitmap.RGBA, view, palette);
    let handle = this.handles.allocate(bitmap);

    return handle;
}
