'use strict';

import { type DeviceBitmap } from '../../raster/device-bitmap.js';
import { ditherTile } from '../../raster/dither.js';

/**
 * How USER paints its own parts of the screen -- frames, captions, scroll
 * bars, controls -- into a window: rectangles of a system colour's brush,
 * lines, the display driver's bitmaps, and the raised boxes and scroll bars
 * made of them. Coordinates are the window's; what is outside the window is
 * not painted, and a bitmap that is a view of the screen clips the rest (see
 * `DeviceBitmap.view`).
 */

export const OBM_LFARROW = 32750;
export const OBM_RGARROW = 32751;
export const OBM_DNARROW = 32752;
export const OBM_UPARROW = 32753;

const SM_CYVTHUMB = 9;
const SM_CXHTHUMB = 10;
const SM_CYVSCROLL = 20;
const SM_CXHSCROLL = 21;

const COLOR_SCROLLBAR = 0;
const COLOR_WINDOWFRAME = 6;
const COLOR_BTNFACE = 15;
const COLOR_BTNSHADOW = 16;
const COLOR_BTNHIGHLIGHT = 20;

/** What painting asks of the display. */
export interface PaintEnvironment {
  /** The display mode, whose driver patterns the brushes. */
  display: any;

  /** `GetSystemMetrics`. */
  metric(index: number): number;

  /** `GetSysColor`, as a `COLORREF`. */
  sysColor(index: number): number;

  /** The display driver's OEM bitmaps, by id, at the screen's depth. */
  oem: Map<number, DeviceBitmap>;
}

/** A brush: one index, or a pattern of them by screen pixel. */
export type Paint = number | Uint8Array;

export class Painter {
  readonly screen: DeviceBitmap;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly environment: PaintEnvironment;

  constructor(
    screen: DeviceBitmap,
    left: number,
    top: number,
    width: number,
    height: number,
    environment: PaintEnvironment
  ) {
    this.screen = screen;
    this.left = left;
    this.top = top;
    this.width = width;
    this.height = height;
    this.environment = environment;
  }

  /** A brush of a colour, patterned as the display driver patterns it. */
  solid(colorref: number): Paint {
    const palette = this.screen.devicePalette;
    const [red, green, blue] = [colorref & 0xff, (colorref >> 8) & 0xff, (colorref >> 16) & 0xff];

    return (
      ditherTile(this.environment.display, palette, red, green, blue) ??
      palette.index(red, green, blue)
    );
  }

  /** A brush of a system colour. */
  colour(system: number): Paint {
    return this.solid(this.environment.sysColor(system));
  }

  /** Fills a rectangle, its right and bottom edges outside it. */
  fill(x0: number, y0: number, x1: number, y1: number, paint: Paint) {
    const screen = this.screen;

    /* Marked, so the screen's presenter shows it. */
    screen.context.markRect(this.left + x0, this.top + y0, this.left + x1, this.top + y1);

    for (let y = Math.max(y0, 0); y < Math.min(y1, this.height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x1, this.width); x++) {
        const sx = this.left + x;
        const sy = this.top + y;

        screen.put(sx, sy, typeof paint === 'number' ? paint : paint[((sy & 7) << 3) | (sx & 7)]);
      }
    }
  }

  /** Inverts a rectangle: every bit of each pixel's index, as `DSTINVERT` does. */
  invert(x0: number, y0: number, x1: number, y1: number) {
    const screen = this.screen;
    const mask = (1 << screen.depth) - 1;

    screen.context.markRect(this.left + x0, this.top + y0, this.left + x1, this.top + y1);

    for (let y = Math.max(y0, 0); y < Math.min(y1, this.height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x1, this.width); x++) {
        const index = screen.indexAt(this.left + x, this.top + y);

        if (index !== null) {
          screen.put(this.left + x, this.top + y, index ^ mask);
        }
      }
    }
  }

  /** A rectangle's edges, a pixel wide, inside it. */
  outline(x0: number, y0: number, x1: number, y1: number, paint: Paint) {
    this.fill(x0, y0, x1, y0 + 1, paint);
    this.fill(x0, y1 - 1, x1, y1, paint);
    this.fill(x0, y0, x0 + 1, y1, paint);
    this.fill(x1 - 1, y0, x1, y1, paint);
  }

  /**
   * Part of a bitmap, from `sx, sy`, `w` by `h`, at `x, y`: `w` defaults to
   * the bitmap's width and `h` to its height.
   */
  blit(
    bitmap: DeviceBitmap | undefined,
    x: number,
    y: number,
    w = bitmap?.width ?? 0,
    sx = 0,
    h = bitmap?.height ?? 0,
    sy = 0
  ) {
    if (!bitmap) {
      return;
    }

    for (let row = 0; row < Math.min(h, bitmap.height - sy); row++) {
      for (let column = 0; column < Math.min(w, bitmap.width - sx); column++) {
        this.fill(
          x + column,
          y + row,
          x + column + 1,
          y + row + 1,
          bitmap.indices[(sy + row) * bitmap.width + sx + column]
        );
      }
    }
  }

  /**
   * A bitmap scaled to `w` by `h` at `x, y`, as USER scales a scroll bar's
   * arrows to the bar: each row and column of the result is one of the
   * bitmap's, by `stretchSource`.
   */
  stretch(bitmap: DeviceBitmap | undefined, x: number, y: number, w: number, h: number) {
    if (!bitmap) {
      return;
    }

    for (let row = 0; row < h; row++) {
      const sy = stretchSource(row, bitmap.height, h);

      for (let column = 0; column < w; column++) {
        const sx = stretchSource(column, bitmap.width, w);

        this.fill(
          x + column,
          y + row,
          x + column + 1,
          y + row + 1,
          bitmap.indices[sy * bitmap.width + sx]
        );
      }
    }
  }

  /**
   * A raised box in the button face, outlined in the frame colour, lit one
   * pixel along the top and left and shadowed two along the bottom and right:
   * a scroll bar's thumb.
   */
  thumb(x0: number, y0: number, x1: number, y1: number) {
    const shadow = this.colour(COLOR_BTNSHADOW);
    const light = this.colour(COLOR_BTNHIGHLIGHT);

    this.fill(x0, y0, x1, y1, this.colour(COLOR_BTNFACE));
    this.fill(x0 + 1, y0 + 1, x1 - 2, y0 + 2, light);
    this.fill(x0 + 1, y0 + 1, x0 + 2, y1 - 2, light);
    this.fill(x1 - 2, y0 + 1, x1 - 1, y1 - 1, shadow);
    this.fill(x0 + 1, y1 - 2, x1 - 1, y1 - 1, shadow);
    this.fill(x1 - 3, y0 + 2, x1 - 2, y1 - 2, shadow);
    this.fill(x0 + 2, y1 - 3, x1 - 2, y1 - 2, shadow);
    this.outline(x0, y0, x1, y1, this.colour(COLOR_WINDOWFRAME));
  }

  /**
   * A scroll bar over a rectangle, a window's or a control's: the scroll bar
   * colour, the driver's arrow bitmaps at each end, scaled to the bar, the thumb at the start,
   * and the whole outlined in the frame colour last -- over an arrow's last
   * row, where the bar is shorter than the bitmap.
   */
  scrollBar(x0: number, y0: number, x1: number, y1: number, vertical: boolean) {
    const oem = this.environment.oem;
    const metric = (index: number) => this.environment.metric(index);

    this.fill(x0, y0, x1, y1, this.colour(COLOR_SCROLLBAR));

    if (vertical) {
      const arrow = metric(SM_CYVSCROLL);

      this.stretch(oem.get(OBM_UPARROW), x0, y0, x1 - x0, arrow);
      this.stretch(oem.get(OBM_DNARROW), x0, y1 - arrow, x1 - x0, arrow);
      this.thumb(x0, y0 + arrow - 1, x1, y0 + arrow - 1 + metric(SM_CYVTHUMB));
    } else {
      const arrow = metric(SM_CXHSCROLL);

      this.stretch(oem.get(OBM_LFARROW), x0, y0, arrow, y1 - y0);
      this.stretch(oem.get(OBM_RGARROW), x1 - arrow, y0, arrow, y1 - y0);
      this.thumb(x0 + arrow - 1, y0, x0 + arrow - 1 + metric(SM_CXHTHUMB), y1);
    }

    this.outline(x0, y0, x1, y1, this.colour(COLOR_WINDOWFRAME));
  }
}

/**
 * Which of a bitmap's `from` rows (or columns) row `to` of a `size`-row
 * scaling of it shows.
 *
 * Measured on the `chrome` probe's scroll bar control, whose arrows each
 * display's driver draws a different height from the bar's sixteen: the EGA's
 * fourteen rows made sixteen repeat rows 3 and 10, the Hercules's eleven
 * repeat 1, 3, 5, 7 and 9, and the VGA's seventeen made sixteen show rows 0 to
 * 14, its last row under the bar's outline.
 *
 * Enlarging, row `to` shows `(to * from + from / 2) / size`, rounded down;
 * `(from - 1) / 2` in place of `from / 2` fits too, as the two differ only for
 * an even `from` and the EGA's fourteen allows both. Reducing, it shows
 * `to * from / size`, rounded down, with anything from -1 to 1 added fitting
 * as well; which rows a reduction leaves out, and whether it combines them,
 * shows only in the last row, which the outline covers. `StretchBlt` itself
 * is not recorded, and would settle both.
 */
export function stretchSource(to: number, from: number, size: number) {
  if (size >= from) {
    return Math.floor((to * from + (from >> 1)) / size);
  }

  return Math.floor((to * from) / size);
}
