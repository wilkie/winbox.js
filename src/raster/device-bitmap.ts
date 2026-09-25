'use strict';

import { Bitmap } from './bitmap.js';
import { DevicePalette } from './device-palette.js';
import { IndexedContext } from './indexed-context.js';

/**
 * A device-dependent bitmap: what `CreateBitmap`, `CreateCompatibleBitmap` and
 * `LoadBitmap` make, and what a memory device context draws into.
 *
 * One byte a pixel, holding an index into the palette for the bitmap's depth
 * -- black and white for a monochrome bitmap, the display's colours for any
 * other. There is one store: a memory device context's drawing, `BitBlt`,
 * `PatBlt`, `GetPixel` and the bits calls all work on these bytes, so nothing
 * drawn one way is missed by another. Colours are turned into indices when
 * they are drawn, as a display driver does, and back into colours only when
 * something asks for them.
 */
export class DeviceBitmap extends Bitmap {
  readonly indices: Uint8Array;
  readonly devicePalette: DevicePalette;
  readonly context: IndexedContext;
  readonly depth: number;

  constructor(width: number, height: number, depth: number, indices?: Uint8Array) {
    super(width, height, depth, Bitmap.RGBA, undefined, []);

    this.depth = depth;
    this.devicePalette = DevicePalette.forDepth(depth);
    this.indices = indices ?? new Uint8Array(Math.max(width * height, 0));
    this.context = new IndexedContext(width, height, this.indices, this.devicePalette);
  }

  /* A device bitmap's size is its own, whatever surface it is selected into. */
  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  get bpp() {
    return this.depth;
  }

  /** The index at a pixel, or `null` outside the bitmap. */
  indexAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this._width || y >= this._height) {
      return null;
    }

    return this.indices[y * this._width + x];
  }
}
