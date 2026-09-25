'use strict';

import { BitmapContext } from './bitmap-context.js';
import { type DevicePalette } from './device-palette.js';

/**
 * A `BitmapContext` whose pixels are palette indices, a byte each: the store
 * of a device-dependent bitmap. Everything that draws -- glyphs, lines,
 * polygons, fills -- reaches the pixels through `setPixel`, which turns the
 * colour into the palette's index for it as it is drawn, the way a display
 * driver does. A colour with no alpha draws nothing.
 *
 * `pixels` and `getImageData` still hand back RGBA bytes, built from the
 * indices when asked, so anything that reads a context as colours reads this
 * one the same way.
 *
 * The store may be another's: a window's context draws into the screen's
 * pixels, from where the window's client area starts (`base`) a screen row at
 * a time (`stride`), and only where `clip` says the window is what shows --
 * which is how a window covered by another cannot draw over it. What such a
 * context writes is marked on the screen's context, where it is shown from.
 */
export class IndexedContext extends BitmapContext {
  readonly indices: Uint8Array;
  readonly palette: DevicePalette;

  /**
   * The rectangle written since it was last taken, as left, top, right and
   * bottom, the last two outside it -- what a window's presenter copies to its
   * canvas. `onDirty` is told when the first pixel after a clean frame is
   * written, so a frame can be asked for then and not before.
   */
  #left = Infinity;
  #top = Infinity;
  #right = -Infinity;
  #bottom = -Infinity;
  onDirty: (() => void) | null = null;

  /** The last colour turned into an index, and the index it turned into. */
  #lastColour = -1;
  #lastIndex = 0;

  /** Where pixel (0, 0) is in `indices`, and how far apart two rows are. */
  base = 0;
  stride: number;

  /** Whether a pixel may be written, or `null` for all of them. */
  clip: ((x: number, y: number) => boolean) | null = null;

  /** The context whose pixels these are, and where this one's start in it. */
  owner: IndexedContext | null = null;
  ownerX = 0;
  ownerY = 0;

  constructor(width: number, height: number, indices: Uint8Array, palette: DevicePalette) {
    super(width, height, new Uint8Array(0));
    this.indices = indices;
    this.palette = palette;
    this.stride = width;
  }

  /** Where a pixel is in `indices`, or -1 outside the context. */
  address(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return -1;
    }

    return this.base + y * this.stride + x;
  }

  /** The index for a colour given as RGBA bytes. */
  indexOf(colour: number[]) {
    const key = (colour[0] << 16) | (colour[1] << 8) | colour[2];

    if (key !== this.#lastColour) {
      this.#lastColour = key;
      this.#lastIndex = this.palette.index(colour[0], colour[1], colour[2]);
    }

    return this.#lastIndex;
  }

  setPixel(x, y, colour) {
    if (colour[3] === 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }

    if (this.clip && !this.clip(x, y)) {
      return;
    }

    this.indices[this.base + y * this.stride + x] = this.indexOf(colour);
    this.markRect(x, y, x + 1, y + 1);
  }

  /** Records that a rectangle was written, the right and bottom edges outside it. */
  markRect(left: number, top: number, right: number, bottom: number) {
    if (this.owner) {
      this.owner.markRect(
        left + this.ownerX,
        top + this.ownerY,
        right + this.ownerX,
        bottom + this.ownerY
      );
      return;
    }

    const clean = this.#right <= this.#left;

    if (left < this.#left) this.#left = left;
    if (top < this.#top) this.#top = top;
    if (right > this.#right) this.#right = right;
    if (bottom > this.#bottom) this.#bottom = bottom;

    if (clean && this.onDirty) {
      this.onDirty();
    }
  }

  /** The rectangle written since the last call, clipped to the pixels, or `null`. */
  takeDirty() {
    const left = Math.max(0, this.#left);
    const top = Math.max(0, this.#top);
    const right = Math.min(this.width, this.#right);
    const bottom = Math.min(this.height, this.#bottom);

    this.#left = this.#top = Infinity;
    this.#right = this.#bottom = -Infinity;

    return right > left && bottom > top ? { left, top, right, bottom } : null;
  }

  /** The pixels as RGBA bytes, made from the indices. */
  get pixels() {
    const rgba = new Uint8Array(this.width * this.height * 4);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const at = y * this.width + x;
        const [red, green, blue] = this.palette.colours[
          this.indices[this.base + y * this.stride + x]
        ] ?? [0, 0, 0];

        rgba[at * 4] = red;
        rgba[at * 4 + 1] = green;
        rgba[at * 4 + 2] = blue;
        rgba[at * 4 + 3] = 0xff;
      }
    }

    return rgba;
  }

  getImageData(x, y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);

    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const sx = x + column;
        const sy = y + row;

        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) {
          continue;
        }

        const [red, green, blue] = this.palette.colours[
          this.indices[this.base + sy * this.stride + sx]
        ] ?? [0, 0, 0];
        const to = (row * width + column) * 4;

        data[to] = red;
        data[to + 1] = green;
        data[to + 2] = blue;
        data[to + 3] = 0xff;
      }
    }

    return { width, height, data };
  }
}
