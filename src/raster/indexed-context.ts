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
 */
export class IndexedContext extends BitmapContext {
  readonly indices: Uint8Array;
  readonly palette: DevicePalette;

  /** The last colour turned into an index, and the index it turned into. */
  #lastColour = -1;
  #lastIndex = 0;

  constructor(width: number, height: number, indices: Uint8Array, palette: DevicePalette) {
    super(width, height, new Uint8Array(0));
    this.indices = indices;
    this.palette = palette;
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

    this.indices[y * this.width + x] = this.indexOf(colour);
  }

  /** The pixels as RGBA bytes, made from the indices. */
  get pixels() {
    const rgba = new Uint8Array(this.width * this.height * 4);

    for (let at = 0; at < this.indices.length; at++) {
      const [red, green, blue] = this.palette.colours[this.indices[at]] ?? [0, 0, 0];

      rgba[at * 4] = red;
      rgba[at * 4 + 1] = green;
      rgba[at * 4 + 2] = blue;
      rgba[at * 4 + 3] = 0xff;
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

        const [red, green, blue] = this.palette.colours[this.indices[sy * this.width + sx]] ?? [
          0, 0, 0,
        ];
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
