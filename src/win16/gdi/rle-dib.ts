'use strict';

import { dibToDevice } from '../../raster/dib.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { realizedMatch } from '../../raster/palette-colour.js';
import { hugeRead8 } from '../huge.js';
import { isHercules } from './driver-hercules.js';
import { isVga256 } from './driver-vga256.js';
import { walkRle } from './rle-runs.js';

/**
 * A run-length encoded DIB, `BI_RLE8` or `BI_RLE4`, set into a bitmap of
 * the display's or drawn on the screen as the display driver's routine of
 * run lengths does it (`rle-runs.ts`): GDI hands the driver the DIB as it
 * is. **Recorded** by `rledib` on the VGA and the 256-colour display.
 *
 * * `SetDIBits`: the driver's `DeviceBitmapBits`, with the bitmap's
 *   rectangle to clip to, so nothing is clipped. On the VGA (`VGA.DRV`
 *   seg9 `0d1e`, export 501) the first line is the bitmap's row
 *   `height - 1 - start`, and a run past the right edge goes on into the
 *   next plane's row, the last plane's into the next row's first; on the
 *   256-colour display (seg9 `0000`, `15ac`) the first line is the DIB's
 *   height less one whatever the start, a line past the top ends the walk,
 *   and a run past the right edge goes on into the next row. The count is
 *   not read; the answer is 1, and nought for a monochrome bitmap on the
 *   256-colour display. What the stream leaves is left as it was.
 * * `SetDIBitsToDevice`: the driver's, at GDI's place for the DIB -- its
 *   bottom line at `yDest + ySrc + cy - 1`, its left at `xDest - xSrc` --
 *   clipped to the destination rectangle only where the DIB's rectangle
 *   does not lie inside it (`VGA.DRV` `1325`-`134a`; `SVGA256.DRV`
 *   `179f`-`17de`): inside it, lines past the DIB's top and runs past its
 *   right edge are drawn beyond. The VGA's DIB rectangle is the one GDI
 *   gives, its first line `start` higher (`0f02`-`0f1c`); the 256-colour
 *   driver's place moves down by the DIB's height less the start and the
 *   count (`0dc4`-`0dd7`). The answer is 1.
 */

const BI_RLE8 = 1;
const BI_RLE4 = 2;

/** A DIB's header as the drivers read it. */
interface Header {
  width: number;
  height: number;
  compression: number;
}

function dword(core: any, far: number, at: number) {
  const word = (offset: number) =>
    core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + offset) & 0xffff);

  return (word(at) | (word(at + 2) << 16)) >>> 0;
}

/** The header of a compressed DIB, or `null` for any other. */
export function rleHeader(system: any, info: number): Header | null {
  const core = system.machine.cpu.core;

  if (!info || dword(core, info, 0) === 12) {
    return null;
  }

  const compression = dword(core, info, 16);

  if (compression !== BI_RLE8 && compression !== BI_RLE4) {
    return null;
  }

  return {
    width: dword(core, info, 4) | 0,
    height: Math.abs(dword(core, info, 8) | 0),
    compression,
  };
}

/**
 * The DIB's colour table, red, green and blue: `biClrUsed` entries, 256
 * at most, or as many as its bits give. With `DIB_PAL_COLORS`, words that
 * index the palette selected where it is drawn, an index past its end its
 * first, as `dibAt` reads them (`paldib`).
 */
function coloursFrom(system: any, info: number, usage: number, surface: any) {
  const core = system.machine.cpu.core;
  const size = dword(core, info, 0);
  const bitCount = dword(core, info, 14) & 0xffff;
  const used = dword(core, info, 32);
  const count = Math.min(used || 1 << Math.min(bitCount, 8), 256);
  const entries = surface?.palette?.entries;
  const byte = (at: number) => core.read8((info >>> 16) & 0xffff, ((info & 0xffff) + at) & 0xffff);
  const colours: [number, number, number][] = [];

  for (let index = 0; index < count; index++) {
    if (usage === 1 && entries) {
      const slot = byte(size + index * 2) | (byte(size + index * 2 + 1) << 8);
      const [red, green, blue] = entries[slot] ?? entries[0];

      colours.push([red, green, blue]);
      continue;
    }

    const at = size + index * 4;

    colours.push([byte(at + 2), byte(at + 1), byte(at)]);
  }

  return colours;
}

/** Which driver's routine: the VGA's, the 256-colour display's, or none WinBox has. */
function familyOf(system: any) {
  return isVga256(system) ? 'vga256' : isHercules(system) ? null : 'vga';
}

/**
 * The DIB's colour table as the destination's indices, matched as GDI
 * and the driver match any DIB's (`dibToDevice`); and on the 256-colour
 * display whether they are other than the indices in order
 * (`SVGA256.DRV` `176f`-`179e`).
 */
function coloursOf(
  system: any,
  info: number,
  usage: number,
  depth: number,
  palette: DevicePalette,
  surface: any
) {
  const colours = coloursFrom(system, info, usage, surface);
  const matched = dibToDevice(
    {
      width: colours.length,
      height: 1,
      bitCount: 8,
      colours,
      pixels: Uint8Array.from(colours, (_, index) => index),
    },
    depth,
    palette,
    system.display,
    surface ? realizedMatch(surface) : null
  );
  const table = Array.from(matched.indices);
  const sum = table.reduce((total, index, entry) => (total + ((index - entry) & 0xff)) & 0xffff, 0);

  return { table, translated: sum !== 0 };
}

/** An index through the table, as the driver takes it (`rleIndex`). */
function indexOf(
  family: string,
  colours: { table: number[]; translated: boolean },
  eight: boolean,
  index: number
) {
  if (family === 'vga256' && eight && !colours.translated) {
    return index;
  }

  return colours.table[index] ?? 0;
}

/**
 * A pixel put where the driver's bitmap has it, in a bitmap of WinBox's:
 * on the VGA a plane's row after another's, each row word-aligned
 * (`VGA.DRV` seg9 `1ad8`); on the 256-colour display a byte a pixel
 * (`SVGA256.DRV` `1738`). What lands past the last row, or before the
 * first -- the VGA's lines past the top -- is beyond the bitmap.
 */
function putInto(family: string, target: DeviceBitmap, x: number, y: number, index: number) {
  if (x < 0 || y < 0) {
    return;
  }

  const { width, height } = target;

  if (family === 'vga256') {
    const widthBytes = (width + 1) & ~1;
    const at = y * widthBytes + x;
    const row = Math.floor(at / widthBytes);
    const column = at % widthBytes;

    if (row < height && column < width) {
      target.indices[target.context.address(column, row)] = index;
    }

    return;
  }

  const planes = target.depth === 1 ? 1 : 4;
  const widthBytes = ((width + 15) >> 4) * 2;

  for (let plane = 0; plane < planes; plane++) {
    const at = y * widthBytes * planes + plane * widthBytes + (x >> 3);
    const row = Math.floor(at / (widthBytes * planes));
    const into = Math.floor((at % (widthBytes * planes)) / widthBytes);
    const column = (at % widthBytes) * 8 + (x & 7);

    if (row < height && column < width) {
      const address = target.context.address(column, row);
      const bit = 1 << into;

      target.indices[address] =
        (index >> plane) & 1 ? target.indices[address] | bit : target.indices[address] & ~bit;
    }
  }
}

/**
 * `SetDIBits` of a compressed DIB into a bitmap of the display's: the
 * answer, or `null` where WinBox has no driver's routine for it (the
 * Hercules's), which leaves it to the DIB's own reading.
 */
export function setRleDIBits(
  system: any,
  target: DeviceBitmap,
  start: number,
  bits: number,
  info: number,
  usage: number
) {
  const header = rleHeader(system, info);
  const family = familyOf(system);

  if (!header || !family) {
    return null;
  }

  /* A monochrome bitmap the 256-colour driver refuses (`16d9`). */
  if (family === 'vga256' && target.depth === 1) {
    return 0;
  }

  const eight = header.compression === BI_RLE8;
  const colours = coloursOf(system, info, usage, target.depth, target.devicePalette, null);
  const core = system.machine.cpu.core;

  walkRle({
    eight,
    read: (at) => hugeRead8(core, bits, at),
    odd: (at) => (((bits & 0xffff) + at) & 1) !== 0,
    x: 0,
    y: family === 'vga256' ? header.height - 1 : target.height - 1 - start,
    top: family === 'vga256' ? 0 : null,
    plot: (x, y, index) => putInto(family, target, x, y, indexOf(family, colours, eight, index)),
  });

  target.context.markRect(0, 0, target.width, target.height);

  return 1;
}

/** What `SetDIBitsToDevice` is handed, in the device's units. */
export interface ToDevice {
  x: number;
  y: number;
  width: number;
  height: number;
  srcX: number;
  srcY: number;
  start: number;
  count: number;
  bits: number;
  info: number;
  usage: number;
}

/**
 * `SetDIBitsToDevice` of a compressed DIB on the screen: the answer, or
 * `null` where WinBox has no driver's routine for it.
 */
export function rleToDevice(system: any, surface: any, args: ToDevice) {
  const header = rleHeader(system, args.info);
  const family = familyOf(system);
  const bitmap = surface.bitmap;

  if (!header || !family || !(bitmap instanceof DeviceBitmap)) {
    return null;
  }

  const eight = header.compression === BI_RLE8;
  const colours = coloursOf(
    system,
    args.info,
    args.usage,
    bitmap.depth,
    bitmap.devicePalette ?? DevicePalette.forDisplay(system.display),
    surface
  );
  const core = system.machine.cpu.core;
  const height = header.height;

  /* GDI's place for the DIB, and its clip: the destination's rectangle,
   * within what the device context reaches. */
  const left = args.x - args.srcX;
  let top = args.y - (height - args.srcY - args.height);
  const reach = bitmap.context.reach ?? {
    left: 0,
    top: 0,
    right: bitmap.width,
    bottom: bitmap.height,
  };
  const clip = {
    left: Math.max(args.x, reach.left),
    top: Math.max(args.y, reach.top),
    right: Math.min(args.x + args.width, reach.right),
    bottom: Math.min(args.y + args.height, reach.bottom),
  };
  let first: number;

  if (family === 'vga256') {
    top += height - args.start - args.count;
    first = top + height - 1;
  } else {
    first = top + height - 1 - args.start;
  }

  const inside =
    left >= clip.left &&
    left + header.width <= clip.right &&
    top >= clip.top &&
    top + height <= clip.bottom;
  const drawn = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };

  walkRle({
    eight,
    read: (at) => hugeRead8(core, args.bits, at),
    odd: (at) => (((args.bits & 0xffff) + at) & 1) !== 0,
    x: left,
    y: first,
    top: family === 'vga256' ? clip.top : null,
    plot: (x, y, index) => {
      if (!inside && (x < clip.left || x >= clip.right || y < clip.top || y >= clip.bottom)) {
        return;
      }

      bitmap.put(x, y, indexOf(family, colours, eight, index));
      drawn.left = Math.min(drawn.left, x);
      drawn.top = Math.min(drawn.top, y);
      drawn.right = Math.max(drawn.right, x + 1);
      drawn.bottom = Math.max(drawn.bottom, y + 1);
    },
  });

  if (drawn.right > drawn.left) {
    bitmap.context.markRect(drawn.left, drawn.top, drawn.right, drawn.bottom);
  }

  return 1;
}
