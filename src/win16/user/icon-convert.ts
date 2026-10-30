'use strict';

import { decodeIcon } from '../../raster/icon.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { monoStretchRows, stretchColumns, stretchMap, stretchRows } from '../../raster/stretch.js';

/**
 * What USER's resource handlers make of an icon or cursor resource: the
 * resource, read into its block by KERNEL's own handler, made USER's own
 * block in place (`icon-block.ts`'s layout). **Read out of `USER.EXE`**
 * seg12 and **recorded** by `iconhand` on the VGA. As the Rust engine's
 * `icon_convert.rs`.
 *
 * The work is done in the block, as USER does it: what it writes lands at
 * the offsets it writes them, and every byte it does not write is the
 * resource's still -- so a colour cursor, which USER lays out as a
 * monochrome one before it adds its picture, keeps 128 bytes of its
 * resource between its mask and its picture (`iconhand`'s cursor 7).
 *
 * The block's header, as `icon-block.ts`: */
const HOTSPOT_X = 0;
const HOTSPOT_Y = 2;
const WIDTH = 4;
const HEIGHT = 6;
const ROW = 8;
const PLANES = 10;
const BITS = 11;
/** The header's size: the mask follows it. */
export const HEADER = 12;

/** A device-independent bitmap's header: the old one of 12 bytes, or the new. */
const CORE_HEADER = 12;
/** The colour table of the new header, wherever its size says it ends: USER takes it at 28h (seg12 `11e0`). */
const INFO_TABLE = 0x28;
/** A resource of more than this many colours has no table (seg12 `121f`, `119b`). */
const TRUE_COLOUR = 24;
/** The stretch mode USER sets to stretch an icon (seg12 `08d3`). */
const COLORONCOLOR = 3;

/** A row of so many pixels of a bit, in whole words. */
export const wordRow = (pixels: number) => ((pixels + 15) >> 4) << 1;

/** The sizes USER makes icons and cursors: `SM_CXICON` and the rest. */
export interface IconMetrics {
  cxIcon: number;
  cyIcon: number;
  cxCursor: number;
  cyCursor: number;
}

/** The display's format and colours, as a bitmap compatible with it has them. */
export interface DisplayFormat {
  planes: number;
  bits: number;
  palette: DevicePalette;
}

/** What a conversion leaves: the block's bytes and the size to give it. */
export interface Converted {
  bytes: Uint8Array;
  size: number;
}

const word = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const signed = (value: number) => (value << 16) >> 16;

function putWord(bytes: Uint8Array, at: number, value: number) {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >> 8) & 0xff;
}

/**
 * Whether two colours of a table are black and white, in either order
 * (seg12 `05ed`-`066f`): four bytes each in the new header, their fourth
 * nought too; three each in the old.
 */
function blackAndWhite(bytes: Uint8Array, at: number, quads: boolean) {
  const size = quads ? 4 : 3;
  const is = (entry: number, value: number) =>
    [0, 1, 2].every((i) => bytes[at + entry * size + i] === value) &&
    (!quads || bytes[at + entry * size + 3] === 0);

  return (is(0, 0) && is(1, 0xff)) || (is(0, 0xff) && is(1, 0));
}

/**
 * Whether a size is the system's on each axis, where USER leaves a resource
 * as it is (seg12 `124d`-`12ac`): only for an icon or cursor size above 32,
 * and a resource no larger -- its height counted as the bitmap's, twice the
 * icon's -- does it keep its own; otherwise it is made the system's.
 */
function stretches(
  width: number,
  height: number,
  icon: boolean,
  metrics: IconMetrics,
  strict: boolean
) {
  const cx = icon ? metrics.cxIcon : metrics.cxCursor;
  const cy = icon ? metrics.cyIcon : metrics.cyCursor;
  const fits = (size: number, system: number) =>
    system > 32 && (strict ? signed(size) <= signed(system) : size <= system);

  return !(fits(width, cx) && fits(height, cy));
}

/**
 * The size a block needs (seg12 `15ff`-`165e`): the header, the mask, and
 * the picture -- the mask's size again for one plane of a bit -- at the
 * system's size where it is stretched, else its own.
 */
function needed(
  icon: boolean,
  bits: number,
  planes: number,
  stretch: boolean,
  width: number,
  height: number,
  metrics: IconMetrics
) {
  const w = stretch ? (icon ? metrics.cxIcon : metrics.cxCursor) : width;
  const h = stretch ? (icon ? metrics.cyIcon : metrics.cyCursor) : height;
  const picture = wordRow(bits * w) * h * planes;

  return HEADER + (planes === 1 && bits === 1 ? picture * 2 : picture + wordRow(w) * h);
}

/**
 * Rows of a bit a pixel made another size (seg12 `0bd1`-`0de8`), in the
 * block: an icon's hotspot its middle, a cursor's moved with its picture;
 * the rows, the mask's, or the mask's and a monochrome picture's together,
 * halved across where they are twice as wide (seg5 `050f`, each pair of
 * pixels anded), reduced down where they are a whole number of times as
 * high (seg5 `056e`, each group of rows anded), and otherwise stretched by
 * `StretchBlt` between monochrome bitmaps in `COLORONCOLOR` (`087a`): GDI's
 * monochrome stretcher, each row and column the first of its group
 * (`monoStretchRows`) -- `iconhand`'s 48 square icon made 32, its rows 0,
 * 2, 3, 5 and on. Its end: where a colour picture goes.
 */
function fitRows(
  block: Uint8Array,
  icon: boolean,
  scale: boolean,
  colour: boolean,
  stretch: boolean,
  metrics: IconMetrics
) {
  const width = word(block, WIDTH);
  const height = word(block, HEIGHT);
  const W = stretch ? (icon ? metrics.cxIcon : metrics.cxCursor) : width;
  const H = stretch ? (icon ? metrics.cyIcon : metrics.cyCursor) : height;

  if (icon) {
    putWord(block, HOTSPOT_X, signed(W) >> 1);
    putWord(block, HOTSPOT_Y, signed(H) >> 1);
  }

  /* An icon's colour mask is rows of its own; anything else has its
   * picture's rows below the mask's (`0c28`-`0c4a`). */
  const both = !(icon && colour);
  let rows = both ? height * 2 : height;
  const goal = both ? H * 2 : H;
  const row = wordRow(W);
  const size = (row * goal) & 0xffff;

  if (!scale || (width === W && height === H)) {
    return size + HEADER;
  }

  if (!icon) {
    putWord(block, HOTSPOT_X, Math.trunc((signed(word(block, HOTSPOT_X)) * W) / width));
    putWord(block, HOTSPOT_Y, Math.trunc((signed(word(block, HOTSPOT_Y)) * H) / height));
  }

  let general = false;

  if (width !== W) {
    if (width % W === 0 && width / W === 2) {
      halveAcross(block, rows, word(block, ROW));
      putWord(block, WIDTH, W);
      putWord(block, ROW, row);
    } else {
      general = true;
    }
  }

  if (height !== H) {
    if (height % H === 0) {
      reduceDown(block, Math.trunc(height / H), rows, word(block, ROW));
      putWord(block, HEIGHT, H);
      rows = goal;
    } else {
      general = true;
    }
  }

  if (general) {
    const from = word(block, WIDTH);
    const stride = word(block, ROW);
    const source = block.slice(HEADER, HEADER + stride * rows);
    const pixel = (x: number, y: number) => (source[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
    const stretched = monoStretchRows(
      pixel,
      [0, 0, from, rows],
      W,
      goal,
      COLORONCOLOR,
      0,
      goal - 1
    );
    const out = new Uint8Array(row * goal);

    stretched.forEach((bits, y) =>
      bits.forEach((bit, x) => {
        out[y * row + (x >> 3)] |= bit << (7 - (x & 7));
      })
    );

    block.set(out.subarray(0, Math.max(0, Math.min(out.length, block.length - HEADER))), HEADER);
    putWord(block, WIDTH, W);
    putWord(block, HEIGHT, H);
    putWord(block, ROW, row);
  }

  return size + HEADER;
}

/**
 * Rows halved across, in place (seg5 `050f`-`056b`): each word of a row
 * made a byte, each of its pixels the and of a pair; a row's bytes, where
 * they are odd, followed by a byte left as it was.
 */
function halveAcross(block: Uint8Array, rows: number, rowBytes: number) {
  const words = rowBytes >> 1;
  const pad = words & 1;
  let from = HEADER;
  let to = HEADER - pad;

  for (let r = 0; r < rows; r++) {
    to += pad;

    for (let w = 0; w < words; w++) {
      const value = block[from] | (block[from + 1] << 8);
      const paired = value & (((value << 1) | (value >> 15)) & 0xffff);
      const low = paired & 0xff;
      const high = paired >> 8;
      let out = 0;

      for (let bit = 7; bit >= 1; bit -= 2) {
        out = (out << 1) | ((low >> bit) & 1);
      }

      for (let bit = 7; bit >= 1; bit -= 2) {
        out = (out << 1) | ((high >> bit) & 1);
      }

      block[to++] = out;
      from += 2;
    }
  }
}

/**
 * Rows reduced down by a whole number, in place (seg5 `056e`-`05db`): each
 * group of so many rows anded, a word at a time.
 */
function reduceDown(block: Uint8Array, factor: number, rows: number, rowBytes: number) {
  if (factor <= 1) {
    return;
  }

  const kept = Math.trunc(rows / factor);
  let to = HEADER;

  for (let r = 0; r < kept; r++) {
    for (let w = 0; w < rowBytes >> 1; w++) {
      const at = HEADER + r * factor * rowBytes + w * 2;
      let value = word(block, at);

      for (let n = 1; n < factor; n++) {
        value &= word(block, at + n * rowBytes);
      }

      putWord(block, to, value);
      to += 2;
    }
  }
}

/**
 * A picture of the display's colours another size, as `StretchBlt` makes
 * one between bitmaps of the display's in `COLORONCOLOR` (seg12 `087a`):
 * each row and column one of the source's.
 */
function stretchPicture(
  indices: Uint8Array,
  width: number,
  height: number,
  W: number,
  H: number,
  mono: boolean
) {
  const out = new Uint8Array(W * H);
  const within = Math.abs(width - W) <= 1 && Math.abs(height - H) <= 1;

  if (within || mono) {
    const across = stretchMap(width, W, height, H, 'columns', mono);
    const down = stretchMap(height, H, width, W, 'rows', mono);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        out[y * W + x] = indices[down[y] * width + across[x]];
      }
    }

    return out;
  }

  const across = stretchColumns(width, W);
  const down = stretchRows(height, H, false);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const columns = across[x];

      out[y * W + x] = indices[(down[y]?.[0] ?? 0) * width + columns[columns.length - 1]];
    }
  }

  return out;
}

/** A picture's bytes as the display's bitmaps hold them: each row, its planes in turn. */
function pictureBytes(
  indices: Uint8Array,
  width: number,
  height: number,
  planes: number,
  bits: number
) {
  const row = wordRow(width * bits);
  const out = new Uint8Array(row * planes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = indices[y * width + x];

      for (let plane = 0; plane < planes; plane++) {
        const value = (index >> (plane * bits)) & ((1 << bits) - 1);
        const bit = x * bits;

        out[(y * planes + plane) * row + (bit >> 3)] |= value << (8 - bits - (bit & 7));
      }
    }
  }

  return out;
}

/** A device-independent bitmap in the new header, for `decodeIcon`: the old one's made so. */
function asInfo(dib: Uint8Array, core: boolean, colours: number) {
  if (!core) {
    return dib;
  }

  const width = word(dib, 4);
  const height = word(dib, 6);
  const bits = word(dib, 10);
  const table = dib.subarray(CORE_HEADER, CORE_HEADER + colours * 3);
  const rest = dib.subarray(CORE_HEADER + colours * 3);
  const out = new Uint8Array(40 + colours * 4 + rest.length);
  const view = new DataView(out.buffer);

  view.setUint32(0, 40, true);
  view.setInt32(4, width, true);
  view.setInt32(8, height, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, bits, true);
  view.setUint32(32, colours, true);

  for (let i = 0; i < colours; i++) {
    out.set(table.subarray(i * 3, i * 3 + 3), 40 + i * 4);
  }

  out.set(rest, 40 + colours * 4);

  return out;
}

/**
 * A Windows 3 module's icon or cursor, a device-independent bitmap -- a
 * cursor's after its hotspot's two words -- made USER's block in place
 * (seg12 `1138`-`15c6`). `bytes` is the block as KERNEL's own handler left
 * it, `length` the resource's size. Null where USER fails it.
 *
 * * Its header, the old (12 bytes) or the new; its colour table, of the
 *   colours it says it uses or as many as its bits give, none for 24 bits.
 *   Black and white in either order, of a bit a pixel, it stays one plane
 *   of a bit: the bitmap, mask over picture, laid out as it is. Otherwise
 *   the mask of a bit a pixel, and the picture in the display's format and
 *   colours (`1029`).
 * * Made the system's size unless that is above 32 and it fits
 *   (`stretches`); the block made larger first where it needs to be
 *   (`15ff`), and smaller after where it holds less.
 */
export function convertDib(
  bytes: Uint8Array,
  length: number,
  icon: boolean,
  metrics: IconMetrics,
  display: DisplayFormat
): Converted | null {
  const at = icon ? 0 : 4;
  const core = word(bytes, at) === CORE_HEADER;
  const width = word(bytes, at + 4);
  const fullHeight = core ? word(bytes, at + 6) : word(bytes, at + 8);
  const bits = core ? word(bytes, at + 10) : word(bytes, at + 14);
  const used = core ? 0 : word(bytes, at + 32) | (word(bytes, at + 34) << 16);
  const tableAt = at + (core ? CORE_HEADER : INFO_TABLE);
  let colours = 0;
  let mono = false;

  if (used) {
    colours = used;
    mono = used === 2 && blackAndWhite(bytes, tableAt, !core);
  } else if (bits !== TRUE_COLOUR) {
    colours = 1 << bits;
    mono = bits === 1 && blackAndWhite(bytes, tableAt, !core);
  }

  const bitsAt = tableAt + colours * (core ? 3 : 4);
  const stretch = stretches(width, fullHeight, icon, metrics, false);
  const height = fullHeight >> 1;
  let block = Uint8Array.from(bytes.subarray(0, Math.max(length, bytes.length)));
  let size = length;

  /* Made larger where it needs to be, its bytes kept (`14e7`-`155e`). */
  const grow = (wanted: number) => {
    if (wanted > size) {
      const larger = new Uint8Array(Math.max(wanted, block.length));

      larger.set(block);
      block = larger;
      size = wanted;
    }
  };

  if (mono) {
    /* The bitmap whole, its colour table's white a set bit. */
    const stride = ((width + 31) >> 5) << 2;
    const row = wordRow(width);
    const white = (index: number) => bytes[tableAt + index * (core ? 3 : 4)] === 0xff;
    const rows = new Uint8Array(row * fullHeight);

    for (let y = 0; y < fullHeight; y++) {
      const from = bitsAt + (fullHeight - 1 - y) * stride;

      for (let x = 0; x < width; x++) {
        const index = (bytes[from + (x >> 3)] >> (7 - (x & 7))) & 1;

        if (white(index)) {
          rows[y * row + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }

    grow(needed(icon, 1, 1, stretch, width, height, metrics));

    if (icon) {
      putWord(block, HOTSPOT_X, 0);
      putWord(block, HOTSPOT_Y, 0);
    }

    putWord(block, WIDTH, width);
    putWord(block, HEIGHT, height);
    putWord(block, ROW, row);
    block[PLANES] = 1;
    block[BITS] = 1;
    block.set(rows.subarray(0, Math.min(rows.length, block.length - HEADER)), HEADER);

    const end = fitRows(block, icon, true, false, stretch, metrics);

    return finish(block, size, end);
  }

  const info = asInfo(bytes.subarray(at), core, colours);
  const decoded = decodeIcon(info, display.palette);
  const row = wordRow(width);
  const mask = new Uint8Array(row * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (decoded.and[y * width + x]) {
        mask[y * row + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  if (icon) {
    putWord(block, HOTSPOT_X, 0);
    putWord(block, HOTSPOT_Y, 0);
  }

  putWord(block, WIDTH, width);
  putWord(block, HEIGHT, height);
  putWord(block, ROW, row);
  block[PLANES] = 1;
  block[BITS] = 1;
  block.set(mask.subarray(0, Math.min(mask.length, block.length - HEADER)), HEADER);
  grow(needed(icon, display.bits, display.planes, stretch, width, height, metrics));

  const end = fitRows(block, icon, true, true, stretch, metrics);

  /* The picture at the icon's size (`1029`-`10cb`): an icon's at once after
   * its mask, a cursor's where a monochrome picture would be. */
  let picture = decoded.xor;
  let W = width;
  let H = height;

  if (stretch && (width !== metrics.cxIcon || height !== metrics.cyIcon)) {
    W = metrics.cxIcon;
    H = metrics.cyIcon;
    picture = stretchPicture(decoded.xor, width, height, W, H, display.planes * display.bits === 1);
  }

  const laid = pictureBytes(picture, W, H, display.planes, display.bits);

  block[PLANES] = display.planes;
  block[BITS] = display.bits;

  if (end + laid.length > block.length) {
    const larger = new Uint8Array(end + laid.length);

    larger.set(block);
    block = larger;
  }

  block.set(laid, end);

  return finish(block, size, end + laid.length);
}

/**
 * The block made the size of what it holds where that is less (`15a7`):
 * never larger, so a colour cursor's picture, which runs past its block in
 * Windows, is cut at the block's end here.
 */
function finish(block: Uint8Array, size: number, end: number): Converted {
  const kept = size > end ? end : size;

  return { bytes: block.subarray(0, kept), size: kept };
}

/**
 * A Windows 2 module's icon or cursor, made USER's block in place (seg12
 * `0e4c`-`0fee`): its first byte 1 for an icon, its second set for one
 * independent of the device; those two bytes dropped, the rest already
 * USER's layout, made one plane of a bit. A dependent one of the icon size
 * is left that size. Unless the system's sizes are above 32 and it fits,
 * it is made the system's size as `fitRows` makes one, the block made
 * larger first where that needs it, and smaller after where it holds less.
 */
export function convertOld(bytes: Uint8Array, length: number, metrics: IconMetrics): Converted {
  const icon = bytes[0] === 1;
  const independent = bytes[1] !== 0;
  let block = Uint8Array.from(bytes);

  block.copyWithin(0, 2, length);

  const scale = !(
    !independent &&
    word(block, WIDTH) === metrics.cxIcon &&
    word(block, HEIGHT) === metrics.cyIcon
  );

  block[BITS] = 1;
  block[PLANES] = 1;

  if (!stretches(word(block, WIDTH), word(block, HEIGHT), icon, metrics, true)) {
    return { bytes: block.subarray(0, length), size: length };
  }

  let size = length;
  const wanted = needed(icon, 1, 1, true, 0, 0, metrics);

  if (scale && wanted > size) {
    const larger = new Uint8Array(wanted);

    larger.set(block);
    block = larger;
    size = wanted;
  }

  const end = fitRows(block, icon, scale, false, true, metrics);

  return finish(block, size, end);
}
