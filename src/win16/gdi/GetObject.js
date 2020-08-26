"use strict";

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
    if (hgdiobj & HandleManager.TAGS.HBITMAP) {
        let bitmapInfo = new BITMAP();
        let ptr = ((item.view.segment << 19) | 0x3) | item.view.offset;
        bitmapInfo.loadFromMemory(memory, srcSegment, srcOffset);
        bitmapInfo.bmType = 0;
        bitmapInfo.bmWidth = item.width;
        bitmapInfo.bmHeight = item.height;
        bitmapInfo.bmWidthBytes = ((item.width * item.bpp) / 8) >>> 0;
        bitmapInfo.bmPlanes = 1;
        bitmapInfo.bmBitsPixel = item.bpp;
        bitmapInfo.bmBits = ptr;

        return 14;
    }

    // Error out if we don't understand the object
    return 0;
}
