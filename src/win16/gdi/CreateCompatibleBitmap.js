"use strict";

import { Bitmap } from '../../raster/bitmap.js';

import { NULL } from '../consts.js';

export function CreateCompatibleBitmap(hdc, nWidth, nHeight) {

    // If the handle is NULL, fail
    if (hdc == NULL) {
        return NULL;
    }

    // Resolve the handle.
    let surface = this.handles.resolve(hdc);

    // If we cannot resolve the handle, fail.
    if (!surface) {
        return NULL;
    }

    // Create the bitmap data
    let data = new Uint8Array(nWidth * nHeight);
    let view = new DataView(data.buffer);

    // Create a bitmap that works for the given HDC.
    let bitmap = new Bitmap(nWidth, nHeight, 4, Bitmap.ABGR, view);

    let handle = this.handles.allocate(bitmap);

    return handle;
}
