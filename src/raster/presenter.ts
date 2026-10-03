'use strict';

import { type DeviceBitmap } from './device-bitmap.js';
import { shownColours } from './shown-colours.js';

/** Asks for `callback` at the next frame the browser draws, or soon, without one. */
const nextFrame = (callback: () => void) => {
  const host: any = globalThis;

  if (typeof host.requestAnimationFrame === 'function') {
    host.requestAnimationFrame(callback);
  } else {
    setTimeout(callback, 0);
  }
};

/**
 * Shows a window's pixels on its canvas.
 *
 * A window draws into a device-dependent bitmap of palette indices, like any
 * memory device context (see `DeviceBitmap`), and the canvas is only where the
 * browser is shown the result. What was written since the last frame is one
 * rectangle; once a frame, that rectangle alone is turned into colours through
 * a table of the palette's 32-bit colours and put on the canvas. Nothing is
 * read back from the canvas, and a frame with nothing written costs nothing.
 */
export class Presenter {
  readonly bitmap: DeviceBitmap;
  readonly canvas: any;
  #pending = false;

  /** Each palette index's colour as the canvas holds it: RGBA bytes, one word. */
  readonly #lookup: Uint32Array;

  constructor(bitmap: DeviceBitmap, canvas: any, display: any = null) {
    this.bitmap = bitmap;
    this.canvas = canvas;

    /* As the screen shows them (`shown-colours.ts`). */
    const colours = shownColours(display, bitmap.devicePalette.colours);
    const bytes = new Uint8Array(colours.length * 4);

    colours.forEach(([red, green, blue], index) => {
      bytes.set([red, green, blue, 0xff], index * 4);
    });

    this.#lookup = new Uint32Array(bytes.buffer);

    bitmap.context.onDirty = () => this.schedule();
    bitmap.context.markRect(0, 0, bitmap.width, bitmap.height);

    /* The first frame is asked for here: pixels written before there was a
     * presenter left the bitmap dirty, and `onDirty` is only told when a
     * clean one is first written. */
    this.schedule();
  }

  /** Asks for a frame, once, however many pixels are written before it. */
  schedule() {
    if (this.#pending) {
      return;
    }

    this.#pending = true;

    nextFrame(() => {
      this.#pending = false;
      this.present();
    });
  }

  /** Puts what was written since the last frame on the canvas. */
  present() {
    const context = this.canvas?.getContext?.('2d');
    const dirty = this.bitmap.context.takeDirty();

    if (!context || !dirty) {
      return;
    }

    const width = dirty.right - dirty.left;
    const height = dirty.bottom - dirty.top;
    const image = context.createImageData(width, height);
    const out = new Uint32Array(image.data.buffer);
    const indices = this.bitmap.indices;
    const stride = this.bitmap.width;
    const lookup = this.#lookup;

    for (let row = 0; row < height; row++) {
      const from = (dirty.top + row) * stride + dirty.left;
      const to = row * width;

      for (let column = 0; column < width; column++) {
        out[to + column] = lookup[indices[from + column]];
      }
    }

    context.putImageData(image, dirty.left, dirty.top);
  }

  /** Stops showing this bitmap: the window has a new one. */
  detach() {
    if (this.bitmap.context.onDirty) {
      this.bitmap.context.onDirty = null;
    }
  }
}
