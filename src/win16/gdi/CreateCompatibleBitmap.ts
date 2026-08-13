"use strict";

import { Palette } from '../../raster/palette.js';
import { Bitmap } from '../../raster/bitmap.js';

import { NULL } from '../consts.js';

export function CreateCompatibleBitmap(hdc, nWidth, nHeight) {
    // If the handle is NULL, fail
    if (hdc == NULL) {
        return NULL;
    }

    // Resolve the handle.
    const surface = this.handles.resolve(hdc);

    // If we cannot resolve the handle, fail.
    if (!surface) {
        return NULL;
    }

    // TODO: Get the bpp from the device
    let bpp = 8;

    if (surface.bitmap) {
        bpp = surface.bitmap.bpp;
    }

    // Each row has to be a multiple of 4 bytes
    let bpRow = bpp * nWidth;
    bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
    const widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

    // Create the bitmap data
    const data = new Uint8Array(widthBytes * nHeight);
    const view = new DataView(data.buffer);

    // Get the local heap.
    //let segment = this.machine.cpu.core.ds >> 3;
    //let heap = this.allocator.heapOf(segment);

    // Allocate the bitmap handle in memory?
    //heap.insert(view);

    // Create a bitmap that works for the given HDC.
    const bitmap = new Bitmap(nWidth, nHeight, bpp, Bitmap.RGBA, view, Palette.PALETTEWIN256);

    const handle = this.handles.allocate(bitmap);
    return handle;
}
