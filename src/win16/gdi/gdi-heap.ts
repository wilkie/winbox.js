'use strict';

import { type SegmentHandler } from '../../emulator/split-block.js';
import { DeviceBitmap } from '../../raster/device-bitmap.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { indexFor } from '../selectors.js';

/**
 * GDI's objects where a program that goes looking finds them: in GDI's data
 * segment, its local heap, as Windows 3.1 keeps them. winbox.js keeps its
 * objects in itself; this makes the bytes a program reads from them, and
 * takes the bytes it writes, when it reads and writes them, and costs
 * nothing otherwise.
 *
 * **Recorded** by `gdiobj`, walking as the engine Bubble Girl of the corpus
 * brings walks, to draw into a bitmap's bits itself:
 *
 * * A bitmap's handle is a moveable local handle: the word at it is the
 *   object's address, and the two bytes after it nought.
 * * The object's word at +2 is `KO`, 4F4Bh, and at +0Ah is a moveable
 *   global handle: its block, 20h bytes of the display driver's header.
 *   When the bits fit after the header in 64 KiB they follow it there, and
 *   the block has at least a byte more; otherwise the block is the header
 *   alone and the bits are a block of their own, over as many selectors as
 *   they need. Sizes are rounded to 32 bytes.
 * * The header: nought, the width, the height, the bytes of a plane's row
 *   (rounded to a word), the planes, 4, and the bits a pixel, 1, as bytes;
 *   the bits' far pointer, nought until the bitmap is first selected into a
 *   device context -- then 20h in the block, or nought in the bits' own; the
 *   bytes of a plane (a row's by the height); and, at 16h, 18h and 1Ah, the
 *   step from one of the bits' selectors to the next -- nought when there
 *   is one, 8 -- the rows that fit in 64 KiB, and the bytes left after them.
 * * The bits: each row the four planes' rows in turn, a pixel's colour the
 *   index its four bits make, in the display's palette. Rows do not cross
 *   from one 64 KiB segment to the next: each holds as many whole rows as
 *   fit, from its start, and the bits' own block is that many segments of
 *   64 KiB and the rows of the last. A byte written there is what
 *   `GetPixel` then answers.

 * Only a bitmap of the display's four planes is laid out: nothing else has
 * been recorded. Other objects, and the rest of their
 * fields, read as noughts, and what a program writes to the heap is lost.
 * Not recorded: where Windows puts objects, which here are given addresses
 * above the handles as they are first looked for.
 */

const KO = 0x4f4b;
const HEADER = 0x20;
const OBJECT = 0x10;
/* The objects above GDI's handles, which winbox.js gives out below 4000h
 * (`HandleManager.gdiHandle`). */
const FIRST_OBJECT = 0x4000;

/** A bitmap laid out: one whose bits are the display's four planes. */
function laidOut(item: any): item is DeviceBitmap {
  return item instanceof DeviceBitmap && item.depth === 4 && !item.isView;
}

/** The bytes of one plane's row: its bits, rounded to a word. */
function rowBytes(bitmap: DeviceBitmap) {
  return ((bitmap.width + 15) >> 4) << 1;
}

/** GDI's data segment. */
export class GdiHeap implements SegmentHandler {
  readonly system: any;
  readonly addresses = new Map<number, number>();
  readonly owners = new Map<number, number>();
  next = FIRST_OBJECT;

  constructor(system: any) {
    this.system = system;
  }

  /** The object's address for a handle, given it the first time. */
  addressOf(handle: number) {
    let address = this.addresses.get(handle);

    if (address === undefined && this.next + OBJECT <= 0x10000) {
      address = this.next;
      this.next += OBJECT;
      this.addresses.set(handle, address);
      this.owners.set(address, handle);
    }

    return address ?? 0;
  }

  read8(offset: number) {
    /* A handle's entry: the object's address, then two noughts. */
    if (offset < FIRST_OBJECT) {
      const handle = ((offset - 2) & ~3) + 2;

      if (!laidOut(this.system.handles.resolve(handle))) {
        return 0;
      }

      const address = this.addressOf(handle);

      return offset === handle ? address & 0xff : offset === handle + 1 ? address >> 8 : 0;
    }

    const base = offset & ~(OBJECT - 1);
    const handle = this.owners.get(base);
    const bitmap = handle === undefined ? null : this.system.handles.resolve(handle);

    if (!laidOut(bitmap)) {
      return 0;
    }

    const word = (value: number) => (offset & 1 ? value >> 8 : value) & 0xff;

    switch (offset - base) {
      case 2:
      case 3:
        return word(KO);

      case 0x0a:
      case 0x0b:
        return word(bitsOf(this.system, bitmap));

      default:
        return 0;
    }
  }

  write8(_offset: number, _value: number) {}
}

/** How a bitmap's bits are laid out in memory. */
function layoutOf(bitmap: DeviceBitmap) {
  const row = rowBytes(bitmap);
  const line = row * 4;
  const lines = Math.floor(0x10000 / line);
  const bits = line * bitmap.height;
  const inline = HEADER + bits + 1 <= 0x10000;
  const tiles = Math.ceil(bitmap.height / lines);
  const size = inline
    ? HEADER + bits + 1
    : (tiles - 1) * 0x10000 + (bitmap.height - (tiles - 1) * lines) * line;

  return { row, line, lines, fill: 0x10000 - lines * line, inline, tiles, size };
}

interface Blocks {
  header: number;
  bits: number | null;
}

/** A bitmap's blocks, made the first time they are asked for: its header's handle. */
function bitsOf(system: any, bitmap: DeviceBitmap) {
  const held = (system._bitmapBlocks ??= new Map<DeviceBitmap, Blocks>());
  let blocks = held.get(bitmap);

  if (!blocks) {
    const layout = layoutOf(bitmap);
    const memory = system.machine.memory;
    const header = GlobalAlloc.call(system, 0x0002, layout.inline ? layout.size : HEADER) as number;

    if (!header) {
      return 0;
    }

    let bits: number | null = null;

    if (!layout.inline) {
      bits = GlobalAlloc.call(system, 0x0002, layout.size) as number;

      if (!bits) {
        GlobalFree.call(system, header);
        return 0;
      }

      for (let tile = 0; tile < layout.tiles; tile++) {
        const rows = Math.min(layout.lines, bitmap.height - tile * layout.lines);

        memory.mapHandler(
          indexFor(bits) + tile,
          new Rows(bitmap, 0, tile * layout.lines, rows, layout.line)
        );
      }
    }

    blocks = { header, bits };
    memory.mapHandler(indexFor(header), new Header(bitmap, blocks, layout));
    held.set(bitmap, blocks);
  }

  return blocks.header;
}

/** A bitmap deleted: its blocks let go. */
export function forgetBitmap(system: any, bitmap: unknown) {
  const held: Map<unknown, Blocks> | undefined = system._bitmapBlocks;
  const blocks = held?.get(bitmap);

  if (!blocks) {
    return;
  }

  const memory = system.machine.memory;

  for (const handle of [blocks.header, blocks.bits]) {
    if (handle) {
      const tiles = Math.max(1, Math.ceil(system.allocator.sizeOf(indexFor(handle)) / 0x10000));

      for (let tile = 0; tile < tiles; tile++) {
        memory.unmapHandler(indexFor(handle) + tile);
      }

      GlobalFree.call(system, handle);
    }
  }

  held!.delete(bitmap);
}

/**
 * Some of a bitmap's rows, from `start` in a segment: each the four planes'
 * rows in turn. Past them, and before `start`, noughts.
 */
class Rows implements SegmentHandler {
  constructor(
    readonly bitmap: DeviceBitmap,
    readonly start: number,
    readonly first: number,
    readonly rows: number,
    readonly line: number
  ) {}

  /** Where a byte is: its row, its plane and its first pixel; null for none. */
  place(offset: number) {
    const at = offset - this.start;
    const row = Math.floor(at / this.line);

    if (at < 0 || row >= this.rows) {
      return null;
    }

    const plane = this.line / 4;
    const within = at % this.line;

    return {
      y: this.first + row,
      plane: Math.floor(within / plane),
      x: (within % plane) * 8,
    };
  }

  read8(offset: number) {
    const place = this.place(offset);

    if (!place) {
      return 0;
    }

    const { width, indices } = this.bitmap;
    const { y, plane, x } = place;
    let value = 0;

    for (let bit = 0; bit < 8 && x + bit < width; bit++) {
      if ((indices[y * width + x + bit] >> plane) & 1) {
        value |= 0x80 >> bit;
      }
    }

    return value;
  }

  write8(offset: number, value: number) {
    const place = this.place(offset);

    if (!place) {
      return;
    }

    const { width, indices } = this.bitmap;
    const { y, plane, x } = place;

    for (let bit = 0; bit < 8 && x + bit < width; bit++) {
      const at = y * width + x + bit;

      indices[at] =
        value & (0x80 >> bit) ? indices[at] | (1 << plane) : indices[at] & ~(1 << plane);
    }
  }
}

/** A bitmap's header block: the driver's header, and when they fit, its bits after it. */
class Header implements SegmentHandler {
  readonly rows: Rows | null;

  constructor(
    readonly bitmap: DeviceBitmap,
    readonly blocks: Blocks,
    readonly layout: ReturnType<typeof layoutOf>
  ) {
    this.rows = layout.inline ? new Rows(bitmap, HEADER, 0, bitmap.height, layout.line) : null;
  }

  header(offset: number) {
    const { bitmap, blocks, layout } = this;
    const selector = (blocks.bits ?? blocks.header) | 1;
    const pointer = bitmap.selected ? ((selector << 16) | (blocks.bits ? 0 : HEADER)) >>> 0 : 0;
    const fields: [number, number, number][] = [
      [0x02, 2, bitmap.width],
      [0x04, 2, bitmap.height],
      [0x06, 2, layout.row],
      [0x08, 1, 4],
      [0x09, 1, 1],
      [0x0a, 4, pointer],
      [0x0e, 4, layout.row * bitmap.height],
      [0x16, 2, layout.inline ? 0 : 8],
      [0x18, 2, layout.lines],
      [0x1a, 2, layout.fill],
    ];

    for (const [at, size, value] of fields) {
      if (offset >= at && offset < at + size) {
        return Math.floor(value / 256 ** (offset - at)) & 0xff;
      }
    }

    return 0;
  }

  read8(offset: number) {
    return offset < HEADER ? this.header(offset) : (this.rows?.read8(offset) ?? 0);
  }

  write8(offset: number, value: number) {
    if (offset >= HEADER) {
      this.rows?.write8(offset, value);
    }
  }
}
