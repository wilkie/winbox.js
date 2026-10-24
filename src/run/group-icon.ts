'use strict';

import { type Icon } from '../layers/groups.js';
import { type IconData } from '../raster/icon.js';
import { DevicePalette } from '../raster/device-palette.js';
import { DISPLAY_MODES } from '../win16/display-modes.js';

/**
 * An item's icon from its group file's own bits (`kb/formats/grp.md`), as
 * the page shows it under a kept program: nothing drawn but what the file
 * holds.
 *
 * The bits are `DumpIcon`'s (`USER.EXE` seg12 `01bb`): the AND plane, a bit
 * a pixel, `widthBytes` a row, then the XOR plane in the display's format,
 * each row its planes in turn, each `cx` times the bits a pixel rounded up
 * to a whole word -- the layout of USER's icon block, which Program Manager
 * copies an item's header and bits into to draw it (`icon-block.ts`). So
 * the header's own planes and bits are those the bits are read by; a group
 * file's icon format (`1Ch`) is the same where the file is the display's,
 * and Program Manager makes the icons again where it is not (seg4 `17ae`).
 */

const wordRow = (bits: number) => ((bits + 15) >> 3) & ~1;

/**
 * The icon's pixels as indices: the mask, 1 where the screen is kept, and
 * the picture's colour index, plane `p` bit `p` of it (one plane of more
 * bits its value). Null where the bits are fewer than the header says.
 */
export function iconIndices(icon: Icon): IconData | null {
  const { cx: width, cy: height, widthBytes } = icon;
  const planes = Math.max(1, icon.planes);
  const bits = Math.max(1, icon.bitsPixel);
  const pictureRow = wordRow(width * bits);

  if (
    !width ||
    !height ||
    icon.and.length < height * widthBytes ||
    icon.xor.length < height * planes * pictureRow
  ) {
    return null;
  }

  const and = new Uint8Array(width * height);
  const xor = new Uint8Array(width * height);

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const at = row * width + column;

      and[at] = (icon.and[row * widthBytes + (column >> 3)] >> (7 - (column & 7))) & 1;

      let index = 0;

      for (let plane = 0; plane < planes; plane++) {
        const bit = column * bits;
        const byte = icon.xor[(row * planes + plane) * pictureRow + (bit >> 3)];
        const value = (byte >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);

        index |= value << (plane * bits);
      }

      xor[at] = index;
    }
  }

  return { width, height, and, xor };
}

/**
 * The colours a display's icons are drawn in, and the index of its window
 * colour: the palette of its bitmaps of the icon's depth
 * (`DevicePalette.forDisplay`; the display's own where the icon is in its
 * format) and `COLOR_WINDOW` (5) as USER's defaults have it for that
 * display, the background of Program Manager's group windows (`PMGroup`'s
 * `COLOR_WINDOW + 1`, seg3 `0d73`-`0dd6`) -- white on every display the
 * `chrome` probe recorded. A group file not in the display's format -- an
 * installation's groups made on another display and not yet loaded on this
 * one -- is read in its own depth's colours.
 */
export function displayColours(display: string, depth?: number) {
  const mode = (DISPLAY_MODES as any)[display] ?? DISPLAY_MODES.vga;
  const palette = DevicePalette.forDisplay(mode, depth ?? DevicePalette.depthOf(mode));
  const window = (mode.sysColors?.[5] ?? 0xffffff) as number;

  return {
    palette,
    window: palette.index(window & 0xff, (window >> 8) & 0xff, (window >> 16) & 0xff),
  };
}

/**
 * The icon as drawn on a group window: each pixel the window's colour index
 * ANDed with the mask, then XORed with the picture, as a display's icon is
 * drawn on its screen, in indices; then that index's colour. RGBA, top row
 * first; null as `iconIndices`.
 */
export function iconPixels(icon: Icon, display: string): Uint8ClampedArray<ArrayBuffer> | null {
  const indices = iconIndices(icon);

  if (!indices) {
    return null;
  }

  const { palette, window } = displayColours(
    display,
    Math.max(1, icon.planes) * Math.max(1, icon.bitsPixel)
  );
  const pixels = new Uint8ClampedArray(indices.width * indices.height * 4);

  for (let at = 0; at < indices.and.length; at++) {
    const index = ((indices.and[at] ? window : 0) ^ indices.xor[at]) & (palette.colours.length - 1);
    const [red, green, blue] = palette.colours[index];

    pixels.set([red, green, blue, 255], at * 4);
  }

  return pixels;
}
