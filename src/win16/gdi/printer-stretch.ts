'use strict';

import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { decodeDib } from '../../raster/dib.js';
import { rasterOp } from '../../raster/raster-op.js';
import { monoStretchRows, stretchColumns } from '../../raster/stretch.js';
import { hugeRead8 } from '../huge.js';
import { DWORD, UINT } from '../types.js';
import { CreateCompatibleDC } from './CreateCompatibleDC.js';
import { DeleteDC } from './DeleteDC.js';
import { bitsSize } from './ddb.js';
import { devicePoint } from './mapping.js';
import { blitDevice, blitRects, driverStretch, sameDriver, withBlock } from './printer-blits.js';
import { callDriver, caps, drawingOf, drawMode, proc } from './printer-output.js';
import type { PDevice } from './printer-driver.js';

/**
 * What Windows' GDI draws itself for a printer's driver that cannot
 * stretch or take a DIB: bitmaps of its own, stretched and converted by
 * GDI, copied with the driver's `BitBlt`. The twin of
 * `crates/winbox-win16/src/gdi/printer_stretch.rs`.
 *
 * Followed for a printer of one plane of one bit. Not followed: a
 * printer's context as the source of a stretch, a printer of colours,
 * `DIB_PAL_COLORS`, a driver with `RC_DI_BITMAP`, and GDI's halving of its
 * bitmaps where memory runs short (only where their sizes pass a segment).
 */

const BIT_BLT = 1;
const STRETCH_BLT = 27;
const RC_STRETCHBLT = 0x800;
const SRCCOPY = 0x00cc0020;
const DP_RASTER = 0x26;
const RC_DI_BITMAP = 0x80;
const RC_DIBTODEV = 0x200;

type Rect = [number, number, number, number];
type Colour = [number, number, number];

const BLACK_AND_WHITE: Colour[] = [
  [0, 0, 0],
  [255, 255, 255],
];

function core(system: any) {
  return system.machine.cpu.core;
}

/**
 * Whether GDI makes a colour white in a monochrome bitmap: blue, twice the
 * red and five times the green come to 1020 or more (`GDI.EXE` seg11
 * `0479`).
 */
export function whiteOf([red, green, blue]: Colour) {
  return blue + 2 * red + 5 * green >= 0x3fc;
}

/** Whether a printer's own bitmaps are of one plane of one bit (`dpBitsPixel`, `dpPlanes`). */
export function printerMono(pdevice: PDevice) {
  return caps(pdevice, 0x0c) === 1 && caps(pdevice, 0x0e) === 1;
}

/** A monochrome bitmap of GDI's own, as `CreateBitmap` makes one. */
function monoBitmap(system: any, width: number, height: number) {
  return new DeviceBitmap(width, height, 1, undefined, DevicePalette.forDisplay(system.display, 1));
}

/**
 * A bitmap compatible with a context (`GDI.EXE` seg4 `01fb`): a printer's
 * of its format, one plane of one bit; a memory context's of its bitmap's.
 */
export function compatibleBitmap(system: any, surface: any, width: number, height: number) {
  if (surface.driverDevice) {
    return monoBitmap(system, width, height);
  }

  const like = surface.bitmap instanceof DeviceBitmap ? surface.bitmap : null;
  const depth = like ? like.depth : DevicePalette.depthOf(system.display);
  const palette = like ? like.devicePalette : DevicePalette.forDisplay(system.display, depth);

  return new DeviceBitmap(width, height, depth, undefined, palette);
}

interface Memory {
  handle: number;
  surface: any;
}

/** A memory context GDI makes for itself, as `CreateCompatibleDC` makes it. */
async function memoryDC(system: any, hdc: number): Promise<Memory> {
  const handle = await CreateCompatibleDC.call(system, hdc);

  return { handle, surface: system.handles.resolve(handle) };
}

async function release(system: any, memory: Memory) {
  if (memory.handle) {
    await DeleteDC.call(system, memory.handle);
  }
}

/**
 * The driver's `BitBlt` into a bitmap of a memory context of the
 * printer's, as GDI's `BitBlt` makes it (seg1 `2f9a`, `2d0d`): the
 * rectangle within the bitmap, the source moved as far, the memory
 * context's brush and `DRAWMODE`; the bitmap's bits as the driver left
 * them. 1, or nought where the driver answers so.
 */
async function blitIntoBitmap(
  system: any,
  memory: Memory,
  target: DeviceBitmap,
  [x, y, width, height]: Rect,
  source: DeviceBitmap,
  [sx, sy]: [number, number]
) {
  const pdevice: PDevice = memory.surface.compatibleDevice;
  const procedure = pdevice ? proc(pdevice, BIT_BLT) : 0;
  const l = Math.max(x, 0);
  const t = Math.max(y, 0);
  const r = Math.min(x + width, target.width);
  const b = Math.min(y + height, target.height);

  if (l >= r || t >= b) {
    return 1;
  }

  if (!procedure) {
    return 0;
  }

  return withBlock(
    system,
    target,
    (destFar) =>
      withBlock(system, source, (sourceFar) =>
        callDriver(system, procedure, [
          [destFar, DWORD],
          [l, UINT],
          [t, UINT],
          [sourceFar, DWORD],
          [(sx + l - x) & 0xffff, UINT],
          [(sy + t - y) & 0xffff, UINT],
          [r - l, UINT],
          [b - t, UINT],
          [SRCCOPY, DWORD],
          [drawingOf(memory.surface).brush?.far ?? 0, DWORD],
          [drawMode(system, memory.surface), DWORD],
        ])
      ),
    true
  );
}

/**
 * The driver's `BitBlt` to its device for each of the visible region's
 * rectangles within a band, top down and from the left, from a bitmap of
 * GDI's own: from its row as far down as the rectangle is in the band
 * (seg32 `1124`), or, where `before` stretches each rectangle's rows into
 * it afresh, from its top (`0906`).
 */
async function bandToDevice(
  system: any,
  surface: any,
  band: Rect,
  bitmap: DeviceBitmap,
  rop: number,
  before?: (rect: Rect) => void
) {
  const pdevice: PDevice = surface.driverDevice;
  const procedure = proc(pdevice, BIT_BLT);

  for (const rect of blitRects(surface, band, true, true)) {
    before?.(rect);
    await withBlock(system, bitmap, (far) =>
      callDriver(system, procedure, [
        [pdevice.lpPDevice, DWORD],
        [rect[0] & 0xffff, UINT],
        [rect[1] & 0xffff, UINT],
        [far, DWORD],
        [(rect[0] - band[0]) & 0xffff, UINT],
        [before ? 0 : (rect[1] - band[1]) & 0xffff, UINT],
        [(rect[2] - rect[0]) & 0xffff, UINT],
        [(rect[3] - rect[1]) & 0xffff, UINT],
        [rop >>> 0, DWORD],
        [drawingOf(surface).brush?.far ?? 0, DWORD],
        [drawMode(system, surface), DWORD],
      ])
    );
  }
}

/** A rectangle's edge and extent from its two corners, and whether it was turned over (seg32 `11bb`). */
function ordered(a: number, b: number): [number, number, boolean] {
  return a > b ? [b + 1, a - b, true] : [a, b - a, false];
}

/** How many bits a pixel a DIB of a bitmap of these planes and bits has (seg32 `0a6c`). */
function dibBits(depth: number) {
  return depth === 1 ? 1 : depth <= 4 ? 4 : depth <= 8 ? 8 : 24;
}

/** A DIB's row of `width` pixels, in bytes, to a doubleword (seg32 `1222`). */
function dibRow(width: number, bits: number) {
  return bits === 24 ? (width * 3 + 3) & ~3 : (((width * bits + 31) >> 5) << 2) & 0xffff;
}

/** The pixels of a bitmap's rows, as indices. */
function rowsOf(bitmap: DeviceBitmap, x: number, y: number, width: number, count: number) {
  return Array.from({ length: count }, (_, row) => {
    const line = new Uint8Array(width);

    for (let at = 0; at < width; at++) {
      line[at] = bitmap.indexAt(x + at, y + row) ?? 0;
    }

    return line;
  });
}

/** Rows of pixels written into a bitmap from its top. */
function putRows(bitmap: DeviceBitmap, rows: Uint8Array[]) {
  rows.forEach((line, row) => line.forEach((index, x) => bitmap.put(x, row, index)));
}

/** Rows of a DIB's indices made a monochrome bitmap, each colour white or black (seg12 `0cba`). */
function monoOf(system: any, width: number, rows: Uint8Array[], table: Colour[]) {
  const mono = monoBitmap(system, width, rows.length);

  putRows(
    mono,
    rows.map((line) => line.map((index) => Number(whiteOf(table[index] ?? [0, 0, 0]))))
  );

  return mono;
}

/**
 * `SetDIBits` into a bitmap of a printer's, whose driver has no
 * `RC_DI_BITMAP` (`GDI.EXE` seg11 `094c`): through a memory context made
 * compatible with the printer's with the bitmap in it, the rows put at the
 * bitmap's top as `dibToTarget` puts them. The answer as it answers.
 */
async function setRows(
  system: any,
  hdc: number,
  bitmap: DeviceBitmap,
  rows: Uint8Array[],
  table: Colour[],
  width: number
) {
  const holder = await memoryDC(system, hdc);
  const own = await memoryDC(system, holder.handle);
  const mono = monoOf(system, width, rows, table);
  if (rows.length) {
    await blitIntoBitmap(system, holder, bitmap, [0, 0, width, rows.length], mono, [0, 0]);
  }

  await release(system, own);
  await release(system, holder);

  return rows.length;
}

/**
 * `GetDIBits` of a bitmap of a printer's, whose driver has no
 * `RC_DI_BITMAP` (`GDI.EXE` seg12 `0d92`): a monochrome bitmap of GDI's own
 * as wide as the DIB and `count` rows high, two memory contexts made
 * compatible with the printer's, and the driver's `BitBlt` of the rows
 * from the bitmap into it, from `height - start - count` down. Its rows,
 * top down.
 */
async function getRows(
  system: any,
  hdc: number,
  bitmap: DeviceBitmap,
  width: number,
  height: number,
  start: number,
  count: number
) {
  const mono = monoBitmap(system, width, count);
  const into = await memoryDC(system, hdc);
  const from = await memoryDC(system, hdc);

  await blitIntoBitmap(system, into, mono, [0, 0, width, count], bitmap, [
    0,
    height - start - count,
  ]);
  await release(system, from);
  await release(system, into);

  return rowsOf(mono, 0, 0, width, count);
}

/**
 * The rows of the destination one chunk of source rows makes (`GDI.EXE`
 * seg32 `0e29`-`0f09`): enlarging down, each source row made a row and
 * copied while the error stays above nought; reducing, in `COLORONCOLOR`
 * the row at which the error falls to nought, in the others each source
 * row combined into the row until it does. A chunk starts each row afresh,
 * all ones in `BLACKONWHITE` and noughts in `WHITEONBLACK`.
 */
function chunkRows(
  chunk: Uint8Array[],
  state: { error: number },
  [sh, dh, dw]: [number, number, number],
  groups: number[][],
  mode: number,
  all: number
) {
  const out: Uint8Array[] = [];
  const fresh = () => new Uint8Array(dw).fill(mode === 1 ? all : 0);
  const combine = (row: Uint8Array, line: Uint8Array) => {
    for (let x = 0; x < dw; x++) {
      const group = groups[x];

      if (mode === 3) {
        row[x] = line[group[group.length - 1]];
        continue;
      }

      for (const column of group) {
        row[x] = mode === 1 ? row[x] & line[column] : row[x] | line[column];
      }
    }
  };

  if (dh >= sh) {
    for (const line of chunk) {
      const row = fresh();

      combine(row, line);
      out.push(row);
      state.error -= sh;

      while (state.error > 0) {
        out.push(row.slice());
        state.error -= sh;
      }

      state.error += dh;
    }
  } else if (mode === 3) {
    for (const line of chunk) {
      state.error -= dh;

      if (state.error > 0) {
        continue;
      }

      state.error += sh;

      const row = fresh();

      combine(row, line);
      out.push(row);
    }
  } else {
    let row = fresh();

    for (const line of chunk) {
      combine(row, line);
      state.error -= dh;

      if (state.error <= 0) {
        state.error += sh;
        out.push(row);
        row = fresh();
      }
    }
  }

  return out;
}

interface Stretch {
  system: any;
  surface: any;
  hdc: number;
  source: any;
  hdcSrc: number;
  from: Rect;
  to: Rect;
  mirrorX: boolean;
  mirrorY: boolean;
  colour: boolean;
  mode: number;
  rop: number;
}

/**
 * `StretchBlt` to a printer's context where the extents differ (`GDI.EXE`
 * seg32 `03ba`): both rectangles put in order, a side given the wrong way
 * round starting a pixel on from its far edge, and turned over where one
 * side is and the other is not (`11bb`).
 *
 * * Neither turned over and each within a pixel of the other's size, a
 *   copy of the smaller, and the last column and row copied again where
 *   the destination is the larger, by GDI's `BitBlt` (`04fb`): the answer
 *   the source's height, where it is not the smaller, else its width, else
 *   the last `BitBlt`'s.
 * * A driver with `RC_STRETCHBLT` stretches it (`05fa`).
 * * Neither turned over, not both of colours, the source no larger than a
 *   segment: `fast` (`06c9`); else `general` (`099e`).
 *
 * The stretch mode is the context's, `BLACKONWHITE` as it starts, and
 * `WHITEONBLACK` for any but the three. Null where winbox.js does not
 * follow what GDI does.
 */
export async function stretchOnDriver(
  system: any,
  surface: any,
  hdc: number,
  source: any,
  hdcSrc: number,
  p: Rect,
  q: Rect,
  rop: number
): Promise<number | null> {
  const pdevice: PDevice = surface.driverDevice;
  const [dx, dw, dmirror] = ordered(p[0], p[2]);
  const [dy, dh, dflip] = ordered(p[1], p[3]);
  const [sx, sw, smirror] = ordered(q[0], q[2]);
  const [sy, sh, sflip] = ordered(q[1], q[3]);
  const mirrorX = dmirror !== smirror;
  const mirrorY = dflip !== sflip;

  if (!source.memoryContext || !(source.bitmap instanceof DeviceBitmap) || !printerMono(pdevice)) {
    return null;
  }

  if (!mirrorX && !mirrorY && Math.abs(sw - dw) <= 1 && Math.abs(sh - dh) <= 1) {
    return nearCopy(system, surface, source, [dx, dy, dw, dh], [sx, sy, sw, sh], rop);
  }

  if (proc(pdevice, STRETCH_BLT) && caps(pdevice, DP_RASTER) & RC_STRETCHBLT) {
    if (!sameDriver(pdevice, source)) {
      return null;
    }

    const driven = await driverStretch(system, surface, source, p, q, rop);

    if (driven !== null) {
      return driven;
    }
  }

  const stretchMode = surface.stretchMode ?? 1;
  const job: Stretch = {
    system,
    surface,
    hdc,
    source,
    hdcSrc,
    from: [sx, sy, sw, sh],
    to: [dx, dy, dw, dh],
    mirrorX,
    mirrorY,
    colour: source.bitmap.depth !== 1,
    mode: stretchMode >= 1 && stretchMode <= 3 ? stretchMode : 2,
    rop,
  };

  if (!mirrorX && !mirrorY && bitsSize(source.bitmap) <= 0xffff) {
    const answer = await fast(job);

    if (answer !== null) {
      return answer;
    }
  }

  return general(job);
}

/** A stretch within a pixel either way, as GDI's `BitBlt`s (seg32 `04fb`). */
async function nearCopy(
  system: any,
  surface: any,
  source: any,
  [dx, dy, dw, dh]: Rect,
  [sx, sy, sw, sh]: Rect,
  rop: number
) {
  const blit = (x: number, y: number, width: number, height: number, fx: number, fy: number) =>
    !width || !height
      ? 1
      : sameDriver(surface.driverDevice, source)
        ? blitDevice(system, surface, [x, y, x + width, y + height], source.bitmap, [fx, fy], rop)
        : 0;
  const width = Math.min(sw, dw);
  const height = Math.min(sh, dh);

  await blit(dx, dy, width, height, sx, sy);

  if (sw < dw) {
    await blit(dx + width, dy, 1, height, sx + width - 1, sy);
  }

  if (sh >= dh) {
    return sh;
  }

  await blit(dx, dy + height, width, 1, sx, sy + height - 1);

  if (sw >= dw) {
    return sw;
  }

  return blit(dx + width, dy + height, 1, 1, sx + width - 1, sy + height - 1);
}

/**
 * GDI's stretch through one bitmap of its own (`GDI.EXE` seg32 `06c9`):
 * as wide as the wider side and as high as the higher, and a row more
 * where the source is first copied into it -- a source of colours, copied
 * by its own driver, made monochrome, to its bottom rows; compatible with
 * the source, or with the printer's context for a source of colours. A
 * bitmap past a segment is `general`'s (null). For each band of the
 * destination, all of it unless the source was copied in, each of the
 * visible region's rectangles within it: the rows it covers stretched into
 * the bitmap's top by `monoStretchRows`, once for each top and bottom, and
 * the driver's `BitBlt` from there to the device.
 */
async function fast(job: Stretch) {
  const { system, surface, source } = job;
  const [sx, sy, sw, sh] = job.from;
  const [dx, dy, dw, dh] = job.to;
  const copied = job.colour;
  const width = Math.max(sw, dw);
  const height = Math.max(sh, dh) + (copied ? 1 : 0);
  const size = ((width + 15) >> 3) * height;

  if (size > 0xffff || size + 0x21 > 0xffff) {
    return null;
  }

  const temp = compatibleBitmap(system, copied ? surface : source, width, height);
  let read = source.bitmap;
  let origin: [number, number] = [sx, sy];

  if (copied) {
    rasterOp(
      system.display,
      { bitmap: temp, width, height },
      0,
      height - sh,
      sw,
      sh,
      SRCCOPY,
      source,
      sx,
      sy
    );

    read = new DeviceBitmap(width, height, 1, temp.indices.slice(), temp.devicePalette);
    origin = [0, height - sh];
  }

  const pixel = (x: number, y: number) => read.indexAt(x, y) ?? 0;
  let done = 0;

  while (done < dh) {
    const band = copied && height - 1 < dh ? Math.floor((done * sh) / dh) + (height - sh) : height;
    const top = dy + done;
    const bottom = Math.min(top + band, dy + dh);
    let last: Rect | null = null;

    await bandToDevice(system, surface, [dx, top, dx + dw, bottom], temp, job.rop, (rect) => {
      if (!last || last[1] !== rect[1] || last[3] !== rect[3]) {
        putRows(
          temp,
          monoStretchRows(
            pixel,
            [origin[0], origin[1], sw, sh],
            dw,
            dh,
            job.mode,
            rect[1] - dy,
            rect[3] - dy - 1
          )
        );
        last = rect;
      }
    });

    /* Each rectangle's source starts at the bitmap's top. */
    done += band;
  }

  return 1;
}

/**
 * GDI's stretch through DIBs (`GDI.EXE` seg32 `099e`): two memory
 * contexts, compatible with the source's and the printer's; a bitmap
 * compatible with the source's as wide as the source, and one as wide as
 * the destination, compatible with the source's for a monochrome source and
 * the printer's otherwise. Their heights halve, and a band's rows with
 * them, until the DIB rows of both come within a segment (`0ba9`-`0c26`).
 * Then for each band of the source: its rows copied into the first by the
 * source's driver, with no brush; for each chunk of them, `GetDIBits`, the
 * chunk stretched (`chunkRows`, across by `stretchColumns`), `SetDIBits` of
 * as many rows as the second holds at a time into it, and the driver's
 * `BitBlt` from it to each of the visible region's rectangles within
 * those rows of the destination, from its bottom up where it is turned
 * over (`0f17`-`1033`). A `SetDIBits` of no rows fails it, nought.
 */
async function general(job: Stretch) {
  const { system, surface, source } = job;
  const [sx, sy, sw, sh] = job.from;
  const [dx, dy, dw, dh] = job.to;
  const depth = source.bitmap.depth;
  const bits = dibBits(depth);
  const table: Colour[] =
    depth === 1 ? BLACK_AND_WHITE : source.bitmap.devicePalette.colours.slice(0, 1 << bits);
  const printed = Boolean(source.compatibleDevice);
  const srcRow = dibRow(sw, bits);
  const dstRow = dibRow(dw, bits);
  const ratio = sh > dh ? 1 : Math.floor(dh / sh) + 1;
  const fits = (si: number, di: number) => {
    const srcBuf = srcRow * si;
    const dstBuf = dstRow * di;

    if (srcBuf > 0xffff || dstBuf > 0xffff) {
      return false;
    }

    return !job.mirrorY && job.mode === 3
      ? (Math.max(si, di) + 1) * Math.max(srcRow, dstRow) <= 0xffff
      : srcBuf + dstBuf <= 0xffff;
  };

  /* The rows a band, a chunk and the second bitmap take. */
  let band = sh;
  let bandRows = dh;
  let si = band;
  let di = bandRows;

  for (;;) {
    if (fits(si, di)) {
      break;
    }

    if (si >> 1 && di >> 1) {
      si = (si >> 1) + (si & 1);
      di = (di >> 1) + (di & 1) + ratio;
      continue;
    }

    if (!(band >> 1) || !(bandRows >> 1)) {
      return 0;
    }

    band = (band >> 1) + (band & 1);
    bandRows = (bandRows >> 1) + (bandRows & 1) + ratio;
    si = band;
    di = bandRows;
  }

  const ofSource = await memoryDC(system, job.hdcSrc);
  const ofDest = await memoryDC(system, job.hdc);
  const first = compatibleBitmap(system, source, sw, band);
  const second = compatibleBitmap(system, depth === 1 ? source : surface, dw, di);
  const groups = stretchColumns(sw, dw, job.mirrorX);
  const state = { error: Math.max(sh, dh) - (Math.min(sh, dh) >> 1) };
  const all = (1 << bits) - 1;
  let answer = 1;
  let srcDone = 0;
  let destDone = 0;
  let total = 0;

  stretching: for (;;) {
    const rows = Math.min(sh - srcDone, band);

    if (printed) {
      const pdevice: PDevice = source.compatibleDevice;

      await withBlock(
        system,
        first,
        (destFar) =>
          withBlock(system, source.bitmap, (sourceFar) =>
            callDriver(system, proc(pdevice, BIT_BLT), [
              [destFar, DWORD],
              [0, UINT],
              [0, UINT],
              [sourceFar, DWORD],
              [sx & 0xffff, UINT],
              [(sy + srcDone) & 0xffff, UINT],
              [sw, UINT],
              [rows, UINT],
              [SRCCOPY, DWORD],
              [0, DWORD],
              [drawMode(system, source), DWORD],
            ])
          ),
        true
      );
    } else {
      putRows(first, rowsOf(source.bitmap, sx, sy + srcDone, sw, rows));
    }

    for (let chunkDone = 0; chunkDone < rows;) {
      const count = Math.min(band - chunkDone, si);
      const start = band - chunkDone - count;
      const lines = printed
        ? await getRows(system, job.hdcSrc, first, sw, band, start, count)
        : rowsOf(first, 0, band - start - count, sw, count);
      const made = chunkRows(lines, state, [sh, dh, dw], groups, job.mode, all);

      for (let set = 0; ;) {
        const n = Math.min(made.length - set, di);
        const top = job.mirrorY ? dy + dh - destDone - set - n : dy + destDone + set;
        const slice = made.slice(set, set + n);

        if (
          !(await setRows(
            system,
            job.hdc,
            second,
            job.mirrorY ? slice.reverse() : slice,
            table,
            dw
          ))
        ) {
          answer = 0;
          break stretching;
        }

        await bandToDevice(system, surface, [dx, top, dx + dw, top + n], second, job.rop);
        total += n;

        if (total >= dh) {
          break stretching;
        }

        if (n + set < made.length) {
          set += n;
          continue;
        }

        destDone += n + set;
        break;
      }

      chunkDone += count;
    }

    srcDone += rows;

    if (srcDone >= sh) {
      break;
    }
  }

  await release(system, ofDest);
  await release(system, ofSource);

  return answer;
}

/** A DIB's header, its colour table, and its bits as far as `rows` scans of them go. */
function dibOf(system: any, info: number, bits: number, rows: number) {
  const cpu = core(system);
  const word = (at: number) => cpu.read16(info >>> 16, ((info & 0xffff) + at) & 0xffff);
  const dword = (at: number) => (word(at) | (word(at + 2) << 16)) >>> 0;
  const size = dword(0);
  const coreHeader = size === 12;
  const width = coreHeader ? word(4) : dword(4) | 0;
  const height = coreHeader ? (word(6) << 16) >> 16 : (word(8) << 16) >> 16;
  const bitCount = coreHeader ? word(10) : word(14);
  const compression = coreHeader ? 0 : dword(16);
  const used = coreHeader ? 0 : dword(32);
  const colours = bitCount <= 8 ? used || 1 << bitCount : 0;
  const header = Array.from({ length: size + colours * (coreHeader ? 3 : 4) }, (_, at) =>
    hugeRead8(cpu, info, at)
  );
  const valid =
    (!compression && [1, 4, 8, 24].includes(bitCount)) ||
    (compression === 1 && bitCount === 8) ||
    (compression === 2 && bitCount === 4);

  return {
    width,
    height,
    bitCount,
    compression,
    valid,
    decode() {
      const lines = compression ? height : rows;

      if (!compression) {
        if (coreHeader) {
          header[6] = lines & 0xff;
          header[7] = (lines >> 8) & 0xff;
        } else {
          header[8] = lines & 0xff;
          header[9] = (lines >> 8) & 0xff;
          header[10] = 0;
          header[11] = 0;
        }
      }

      const length = compression ? dword(20) : (((width * bitCount + 31) >> 5) << 2) * lines;
      const data = Array.from({ length }, (_, at) => hugeRead8(cpu, bits, at));

      return decodeDib(new Uint8Array([...header, ...data]));
    },
  };
}

/**
 * A DIB drawn by GDI itself (`GDI.EXE` seg12 `094f`): nought for a header
 * GDI does not take, or no scans from `start`; else a monochrome bitmap of
 * its own as wide as the DIB and as high as the scans given, each pixel
 * white where its colour is (`whiteOf`), the first scan at its bottom
 * (`0cba`; compressed, decoded whole, `08b3`); a memory context made
 * compatible; and GDI's `BitBlt` of it, `width` by `height` from
 * `xSrc, ySrc`, to `x, y` of the target -- a printer's context, within
 * `limit`, or a bitmap of a memory context's. The answer the scans given,
 * or 1 for a compressed DIB.
 */
async function dibToTarget(
  system: any,
  hdc: number,
  target: { surface: any; limit?: Rect } | { memory: Memory; bitmap: DeviceBitmap },
  [x, y, width, height]: Rect,
  [xSrc, ySrc]: [number, number],
  start: number,
  count: number,
  bits: number,
  info: number
) {
  const dib = dibOf(system, info, bits, count);
  const rows = dib.height - start;

  if (!dib.valid || rows <= 0) {
    return 0;
  }

  const scans = Math.min(count, rows);
  let decoded;

  try {
    decoded = dib.decode();
  } catch {
    return 0;
  }

  const lines = rowsOf(
    { indexAt: (px: number, py: number) => decoded.pixels[py * decoded.width + px] } as any,
    0,
    decoded.height - scans,
    dib.width,
    scans
  );
  const mono = decoded.rgb
    ? (() => {
        const made = monoBitmap(system, dib.width, scans);

        for (let row = 0; row < scans; row++) {
          for (let px = 0; px < dib.width; px++) {
            const at = ((decoded.height - scans + row) * dib.width + px) * 3;
            const rgb = decoded.rgb!;

            made.put(px, row, Number(whiteOf([rgb[at], rgb[at + 1], rgb[at + 2]])));
          }
        }

        return made;
      })()
    : monoOf(system, dib.width, lines, decoded.colours);
  const own = await memoryDC(system, hdc);

  if ('memory' in target) {
    await blitIntoBitmap(system, target.memory, target.bitmap, [x, y, width, height], mono, [
      xSrc,
      ySrc,
    ]);
  } else {
    await blitDevice(
      system,
      target.surface,
      [x, y, x + width, y + height],
      mono,
      [xSrc, ySrc],
      SRCCOPY,
      target.limit ?? null
    );
  }

  await release(system, own);

  return dib.compression ? 1 : scans;
}

/** Whether GDI draws DIBs itself for a context: one of a printer of one plane of one bit. */
function drawsDIBs(surface: any) {
  const pdevice: PDevice | undefined = surface.driverDevice ?? surface.compatibleDevice;

  return Boolean(pdevice && printerMono(pdevice) && !(caps(pdevice, DP_RASTER) & RC_DI_BITMAP));
}

/**
 * `SetDIBitsToDevice` on a printer's context whose driver has no
 * `RC_DIBTODEV` or answers below nought (`GDI.EXE` seg11 `0ce9`): the
 * corner in device terms; the context saved, set to `MM_TEXT` and clipped
 * to the destination's rectangle; `dibToTarget` of the scans given, placed
 * so that they land where they belong -- the DIB's height less the first
 * scan and the count, and the corner's y less the source's --, from the
 * source's x; the context restored. Null for `DIB_PAL_COLORS`.
 */
export async function dibToDeviceFallback(
  system: any,
  hdc: number,
  surface: any,
  args: {
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
): Promise<number | null> {
  if (args.usage || !drawsDIBs(surface)) {
    return null;
  }

  const [x, y] = devicePoint(surface, args.x, args.y);
  const dib = dibOf(system, args.info, args.bits, args.count);

  return dibToTarget(
    system,
    hdc,
    { surface, limit: [x, y, x + args.width, y + args.height] },
    [x, dib.height - args.start - args.count + y - args.srcY, args.width, args.count],
    [args.srcX, 0],
    args.start,
    args.count,
    args.bits,
    args.info
  );
}

/**
 * `SetDIBits` into a bitmap with a printer's context whose driver has no
 * `RC_DI_BITMAP` (`GDI.EXE` seg11 `094c`): a memory context made compatible
 * with the bitmap in it, and `dibToTarget` of the scans given into the
 * bitmap, its width the DIB's, placed at the DIB's height less the first
 * scan and the count. Null where GDI does not draw for the context.
 */
export async function setDIBitsFallback(
  system: any,
  hdc: number,
  surface: any,
  bitmap: DeviceBitmap,
  start: number,
  count: number,
  bits: number,
  info: number,
  usage: number
): Promise<number | null> {
  if (usage || !drawsDIBs(surface) || bitmap.depth !== 1) {
    return null;
  }

  const holder = await memoryDC(system, hdc);
  const dib = dibOf(system, info, bits, count);
  const answer = await dibToTarget(
    system,
    holder.handle,
    { memory: holder, bitmap },
    [0, dib.height - start - count, dib.width, count],
    [0, 0],
    start,
    count,
    bits,
    info
  );

  await release(system, holder);

  return answer;
}

/**
 * `GetDIBits` of a bitmap with a printer's context whose driver has no
 * `RC_DI_BITMAP` (`GDI.EXE` seg12 `0d92`): nought where the header's
 * height less the first scan leaves none; the count no more than that;
 * the rows copied by the driver into a monochrome bitmap of GDI's own
 * (`getRows`); the colour table black, white and the rest nought; each
 * scan from the bottom, a pixel 0 or 1 at the header's bits a pixel, one
 * bit's rows copied a word at a time and padded with noughts, the others'
 * padding left as it was (`0f21`). The count. Null where GDI does not
 * draw for the context, or for no bits.
 */
export async function getDIBitsFallback(
  system: any,
  hdc: number,
  surface: any,
  bitmap: DeviceBitmap,
  start: number,
  count: number,
  bits: number,
  info: number,
  usage: number
): Promise<number | null> {
  if (usage || !bits || !drawsDIBs(surface) || bitmap.depth !== 1) {
    return null;
  }

  const cpu = core(system);
  const segment = info >>> 16;
  const word = (at: number) => cpu.read16(segment, ((info & 0xffff) + at) & 0xffff);
  const size = word(0);
  const width = word(4);
  const height = (word(8) << 16) >> 16;
  const bitCount = word(14);

  if (size !== 40 || word(16) || word(18) || ![1, 4, 8, 24].includes(bitCount)) {
    return null;
  }

  if (height - start <= 0) {
    return 0;
  }

  const scans = Math.min(count, height - start);
  const lines = await getRows(system, hdc, bitmap, width, height, start, scans);
  const write8 = (far: number, at: number, value: number) =>
    cpu.write8(far >>> 16, ((far & 0xffff) + at) & 0xffff, value);

  if (bitCount <= 8) {
    for (let at = 0; at < 4 << bitCount; at++) {
      write8(info, size + at, at >= 4 && at < 7 ? 0xff : 0);
    }
  }

  const rowBytes = ((width * bitCount + 31) >> 5) << 2;
  const words = (width + 15) >> 4;
  const data = Math.ceil((width * bitCount) / 8);
  let at = 0;

  for (let scan = 0; scan < scans; scan++) {
    const line = lines[scans - 1 - scan];
    const bytes: number[] = [];

    if (bitCount === 1) {
      for (let byte = 0; byte < words * 2; byte++) {
        let value = 0;

        for (let bit = 0; bit < 8; bit++) {
          value |= (line[byte * 8 + bit] ?? 0) << (7 - bit);
        }

        bytes.push(value);
      }

      if (rowBytes - data >= 2) {
        bytes.push(0, 0);
      }
    } else if (bitCount === 24) {
      for (const pixel of line) {
        bytes.push(...(pixel ? [0xff, 0xff, 0xff] : [0, 0, 0]));
      }
    } else {
      const perByte = 8 / bitCount;

      for (let byte = 0; byte < data; byte++) {
        let value = 0;

        for (let slot = 0; slot < perByte; slot++) {
          value |= (line[byte * perByte + slot] ?? 0) << (8 - bitCount * (slot + 1));
        }

        bytes.push(value);
      }
    }

    bytes.forEach((value, offset) => write8(bits, at + offset, value));
    at = bitCount === 1 ? at + bytes.length : at + rowBytes;
  }

  return scans;
}

/**
 * `StretchDIBits` on a printer's context whose driver has no
 * `RC_STRETCHDIB` or answers -1 (`GDI.EXE` seg11 `1253`): where the driver
 * takes `SetDIBitsToDevice` and the sizes are alike and `SRCCOPY`, that;
 * else a memory context made compatible, a bitmap compatible with the
 * printer's made of the DIB (`CreateDIBitmap`, `0a8a`: `SetDIBits` of all
 * its scans), and GDI's `StretchBlt` of it from its bottom row's counting,
 * the answer the source's height where it drew. Null where GDI does not
 * draw for the context.
 */
export async function stretchDIBitsFallback(
  system: any,
  hdc: number,
  surface: any,
  args: {
    x: number;
    y: number;
    width: number;
    height: number;
    srcX: number;
    srcY: number;
    srcWidth: number;
    srcHeight: number;
    bits: number;
    info: number;
    usage: number;
    rop: number;
  }
): Promise<number | null> {
  if (args.usage || !drawsDIBs(surface)) {
    return null;
  }

  const [x0, y0] = devicePoint(surface, args.x, args.y);
  const [x1, y1] = devicePoint(surface, args.x + args.width, args.y + args.height);
  const dib = dibOf(system, args.info, args.bits, 0);

  if (
    caps(surface.driverDevice, DP_RASTER) & RC_DIBTODEV &&
    x1 - x0 === args.srcWidth &&
    x1 !== x0 &&
    y1 - y0 === args.srcHeight &&
    y1 !== y0 &&
    args.rop >>> 0 === SRCCOPY
  ) {
    const { driverDIBToDevice } = await import('./printer-blits.js');
    const direct = {
      x: args.x,
      y: args.y,
      width: args.srcWidth,
      height: args.srcHeight,
      srcX: args.srcX,
      srcY: args.srcY,
      start: 0,
      count: dib.height,
      bits: args.bits,
      info: args.info,
      usage: args.usage,
    };

    return (
      (await driverDIBToDevice(system, surface, direct)) ??
      (await dibToDeviceFallback(system, hdc, surface, direct))
    );
  }

  const memory = await memoryDC(system, hdc);
  const bitmap = compatibleBitmap(system, surface, dib.width, dib.height);

  await setDIBitsFallback(
    system,
    hdc,
    surface,
    bitmap,
    0,
    dib.height,
    args.bits,
    args.info,
    args.usage
  );

  const kept = memory.surface.bitmap;

  memory.surface.bitmap = bitmap;

  const { driverStretchBlt } = await import('./printer-blits.js');
  const drawn = await driverStretchBlt(
    system,
    surface,
    { x: args.x, y: args.y, width: args.width, height: args.height },
    memory.surface,
    {
      x: args.srcX,
      y: dib.height - args.srcY - args.srcHeight,
      width: args.srcWidth,
      height: args.srcHeight,
    },
    args.rop >>> 0,
    hdc,
    memory.handle
  );

  memory.surface.bitmap = kept;
  await release(system, memory);

  return drawn === null ? null : drawn ? args.srcHeight : 0;
}
