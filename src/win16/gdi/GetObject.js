"use strict";

import { NULL } from '../consts.js';

import { BITMAP } from '../gdi.js';

import { HandleManager } from '../handle-manager.js';

export function GetObject(hgdiobj, cbBuffer, lpvObject) {
    let memory = this.machine.memory;
    let item = this.handles.resolve(hgdiobj);

    let srcSegment = ((lpvObject >> 16) & 0xffff) >> 3;
    let srcOffset = lpvObject & 0xffff;

    // If we could not resolve the handle, fail.
    if (!item) {
        return 0;
    }

    // What kind of item is it?
    if (cbBuffer >= 14 && this.handles.isBitmap(item)) {
        let bitmapInfo = new BITMAP();

        let bpRow = item.bpp * item.width;
        bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
        let widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

        bitmapInfo.loadFromMemory(memory, srcSegment, srcOffset);
        bitmapInfo.bmType = 0;
        bitmapInfo.bmWidth = item.width;
        bitmapInfo.bmHeight = item.height;
        bitmapInfo.bmWidthBytes = widthBytes;
        bitmapInfo.bmPlanes = 1;
        bitmapInfo.bmBitsPixel = item.bpp;
        bitmapInfo.bmBits = NULL; // The bits are retrieved with GetBitmapBits

        return 14;
    }

    // Error out if we don't understand the object
    return 0;
}
