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

  constructor(
    width: number,
    height: number,
    depth: number,
    indices?: Uint8Array,
    palette = DevicePalette.forDepth(depth)
  ) {
    super(width, height, depth, Bitmap.RGBA, undefined, []);

    this.depth = depth;
    this.devicePalette = palette;
    this.indices = indices ?? new Uint8Array(Math.max(width * height, 0));
    this.context = new IndexedContext(width, height, this.indices, this.devicePalette);
  }

  /**
   * Where this bitmap's pixel (0, 0) is on the bitmap it is a view of, if it
   * is one; a brush's pattern is anchored there, to the screen. See `view`.
   */
  originX = 0;
  originY = 0;

  /**
   * A view of `parent`'s pixels: `width` by `height` from `left, top`, drawn
   * only where `clip` allows. Nothing is copied; what is drawn through the
   * view is drawn on the parent, and marked there. This is a window's client
   * area on the screen.
   */
  static view(
    parent: DeviceBitmap,
    left: number,
    top: number,
    width: number,
    height: number,
    clip: ((x: number, y: number) => boolean) | null = null
  ) {
    const view = new DeviceBitmap(
      width,
      height,
      parent.depth,
      parent.indices,
      parent.devicePalette
    );
    const context = view.context;

    context.base = top * parent.width + left;
    context.stride = parent.width;
    context.clip = clip;
    context.owner = parent.context;
    context.ownerX = left;
    context.ownerY = top;
    view.originX = parent.originX + left;
    view.originY = parent.originY + top;

    return view;
  }

  /** Whether this bitmap's pixels are another's. */
  get isView() {
    return this.context.owner !== null;
  }

  /** Writes an index at a pixel, where the pixel exists and may be written. */
  put(x: number, y: number, index: number) {
    const at = this.context.address(x, y);

    if (at >= 0 && (!this.context.clip || this.context.clip(x, y))) {
      this.indices[at] = index;
    }
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
    const at = this.context.address(x, y);

    return at < 0 ? null : this.indices[at];
  }
}
