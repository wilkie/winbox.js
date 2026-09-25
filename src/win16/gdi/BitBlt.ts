'use strict';

import { rasterOp } from '../../raster/raster-op.js';

import { TRUE, FALSE } from '../consts.js';

/**
 * Combines a rectangle of one device context into another under a raster
 * operation: any of the 256, each its own truth table over the brush, the
 * source and the destination, applied bit by bit to palette indices. See
 * `rasterOp`, and `kb/gdi/bitblt.md` for what the `bitblt` probe recorded.
 *
 * Not yet recorded, and not handled: a source and destination whose extents
 * differ, which Windows stretches, and a source that overlaps the destination.
 *
 * @param {Types.HDC} hdcDest - Where to draw.
 * @param {Types.INT} nXDest - The rectangle's left edge in the destination.
 * @param {Types.INT} nYDest - Its top edge.
 * @param {Types.INT} nWidth - Its width.
 * @param {Types.INT} nHeight - Its height.
 * @param {Types.HDC} hdcSrc - Where the source pixels come from, if the
 *                             operation reads any.
 * @param {Types.INT} nXSrc - The source rectangle's left edge.
 * @param {Types.INT} nYSrc - Its top edge.
 * @param {Types.DWORD} dwRop - The raster operation.
 *
 * @returns {Types.BOOL} Whether there was a destination to draw on.
 */
export function BitBlt(hdcDest, nXDest, nYDest, nWidth, nHeight, hdcSrc, nXSrc, nYSrc, dwRop) {
  const destination = this.handles.resolve(hdcDest);

  if (!destination) {
    return FALSE;
  }

  const source = hdcSrc ? this.handles.resolve(hdcSrc) : null;

  rasterOp(
    this.display,
    destination,
    nXDest,
    nYDest,
    nWidth,
    nHeight,
    dwRop >>> 0,
    source ?? null,
    nXSrc,
    nYSrc
  );

  return TRUE;
}
