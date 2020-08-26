"use strict";

import { Bitmap } from '../../raster/bitmap.js';

import { NULL } from '../consts.js';

export function CreateBitmap(nWidth, nHeight, cbPlanes, cbBits, lpvBits) {
    let memory = this.machine.memory;

    let segment = ((lpvBits >> 16) & 0xffff) >> 3;
    let offset = lpvBits & 0xffff;

    // Get bitmap data
    // TODO: we need to align by the width with padding
    let size = ((cbBits * nWidth * nHeight) / 8) >>> 0;

    // We also need to allocate some room for the palette, if there is one
    if (cbBits <= 8) {
        size += (1 << cbBits) * 4;
    }

    let data = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
        data[i] = memory.read8(segment, offset);
        offset++;
    }

    // Create the view
    let view = new DataView(data.buffer);

    // Allocate the bitmap in memory
 
    // Create a bitmap.
    let bitmap = new Bitmap(nWidth, nHeight, cbBits, Bitmap.ABGR, view);
    let handle = this.handles.allocate(bitmap);

    return handle;
}
