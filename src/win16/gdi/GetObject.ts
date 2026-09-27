'use strict';

import { Brush } from '../../raster/brush.js';
import { DEFAULT_ENTRIES } from '../../raster/palette-colour.js';
import { LogicalPalette } from './gdi-objects.js';

import { NULL } from '../consts.js';

import { BITMAP } from '../gdi.js';

import { HandleManager } from '../handle-manager.js';

export function GetObject(hgdiobj, cbBuffer, lpvObject) {
  const memory = this.machine.memory;
  const item = this.handles.resolve(hgdiobj);

  const srcSegment = ((lpvObject >> 16) & 0xffff) >> 3;
  const srcOffset = lpvObject & 0xffff;

  // If we could not resolve the handle, fail.
  if (!item) {
    return 0;
  }

  // What kind of item is it?
  if (cbBuffer >= 14 && this.handles.isBitmap(item)) {
    const bitmapInfo = new BITMAP();

    let bpRow = item.bpp * item.width;
    bpRow = (bpRow + (8 - 1)) & ~(8 - 1);
    const widthBytes = ((bpRow >> 3) + (4 - 1)) & ~(4 - 1);

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

  /* A palette: its count of entries, a word. **Recorded** by `palette`. */
  if (item instanceof LogicalPalette && cbBuffer > 0) {
    const count = (item.entries ?? DEFAULT_ENTRIES).length;
    const size = Math.min(cbBuffer, 2);
    const core = this.machine.cpu.core;

    core.write8((lpvObject >>> 16) & 0xffff, lpvObject & 0xffff, count & 0xff);

    if (size > 1) {
      core.write8((lpvObject >>> 16) & 0xffff, ((lpvObject & 0xffff) + 1) & 0xffff, (count >> 8) & 0xff);
    }

    return size;
  }

  /* A pattern brush: its `LOGBRUSH`, `BS_PATTERN` and the bitmap's handle. */
  if (item instanceof Brush && item.pattern && cbBuffer > 0) {
    const bytes = [3, 0, 0, 0, 0, 0, item.bitmap & 0xff, (item.bitmap >> 8) & 0xff];
    const size = Math.min(cbBuffer, 8);
    const core = this.machine.cpu.core;

    for (let at = 0; at < size; at++) {
      core.write8((lpvObject >>> 16) & 0xffff, (lpvObject & 0xffff) + at, bytes[at]);
    }

    return size;
  }

  /* A font: the `LOGFONT` it was made from, as much of its fifty bytes as
   * there is room for. */
  const logfont = (item as any).logfont;

  if (logfont && cbBuffer > 0) {
    const bytes = new Uint8Array(50);
    const view = new DataView(bytes.buffer);

    view.setInt16(0, logfont.height, true);
    view.setInt16(2, logfont.width, true);
    view.setInt16(4, logfont.escapement, true);
    view.setInt16(6, logfont.orientation, true);
    view.setInt16(8, logfont.weight, true);
    bytes.set(
      [
        logfont.italic,
        logfont.underline,
        logfont.strikeout,
        logfont.charset,
        logfont.outPrecision,
        logfont.clipPrecision,
        logfont.quality,
        logfont.pitchAndFamily,
      ],
      10
    );

    for (let at = 0; at < Math.min(logfont.face.length, 31); at++) {
      bytes[18 + at] = logfont.face.charCodeAt(at) & 0xff;
    }

    const size = Math.min(cbBuffer, 50);
    const core = this.machine.cpu.core;

    for (let at = 0; at < size; at++) {
      core.write8((lpvObject >>> 16) & 0xffff, (lpvObject & 0xffff) + at, bytes[at]);
    }

    return size;
  }

  // Error out if we don't understand the object
  return 0;
}
