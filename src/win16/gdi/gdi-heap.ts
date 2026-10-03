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
 *
 * The header and the bits are plain memory, which the program reads and
 * writes as it likes. winbox.js keeps the bitmap's pixels in itself as well,
 * so around a call that names the bitmap, or a device context it is
 * selected into, the two are made to agree (`syncBitmaps`): its pixels read
 * from the bits before, and the bits and the header written from them
 * after. Bubble Girl draws into its bits two million times a run and names
 * the bitmap to GDI some three hundred.

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
  layout: ReturnType<typeof layoutOf>;
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
    }

    blocks = { header, bits, layout };
    memory.zero(indexFor(header) * 0x10000, layout.inline ? layout.size : HEADER);

    if (bits) {
      memory.zero(indexFor(bits) * 0x10000, layout.size);
    }

    held.set(bitmap, blocks);
    store(system, bitmap, blocks);
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

  for (const handle of [blocks.header, blocks.bits]) {
    if (handle) {
      GlobalFree.call(system, handle);
    }
  }

  held!.delete(bitmap);
}

/** Where row `y` of a bitmap's bits is, as a linear address. */
function rowAt(blocks: Blocks, y: number) {
  const { layout } = blocks;

  if (layout.inline) {
    return indexFor(blocks.header) * 0x10000 + HEADER + y * layout.line;
  }

  const tile = Math.floor(y / layout.lines);

  return (indexFor(blocks.bits!) + tile) * 0x10000 + (y - tile * layout.lines) * layout.line;
}

/** A bitmap's pixels read from its bits, as the program left them. */
function load(system: any, bitmap: DeviceBitmap, blocks: Blocks) {
  const memory = system.machine.memory;
  const { row, line } = blocks.layout;

  for (let y = 0; y < bitmap.height; y++) {
    const bytes = new Uint8Array(memory.read(rowAt(blocks, y), line));

    for (let x = 0; x < bitmap.width; x++) {
      const byte = x >> 3;
      const shift = 7 - (x & 7);
      let index = 0;

      for (let plane = 0; plane < 4; plane++) {
        index |= ((bytes[plane * row + byte] >> shift) & 1) << plane;
      }

      bitmap.indices[bitmap.context.address(x, y)] = index;
    }
  }
}

/**
 * A bitmap's bits written from its pixels, the bits past its width as they
 * were, and its header's fields: the driver's header GDI keeps, its far
 * pointer to the bits nought until the bitmap is first selected.
 */
function store(system: any, bitmap: DeviceBitmap, blocks: Blocks) {
  const memory = system.machine.memory;
  const { layout } = blocks;
  const { row, line } = layout;

  for (let y = 0; y < bitmap.height; y++) {
    const at = rowAt(blocks, y);
    const bytes = new Uint8Array(memory.read(at, line));

    for (let x = 0; x < bitmap.width; x++) {
      const byte = x >> 3;
      const bit = 0x80 >> (x & 7);
      const index = bitmap.indexAt(x, y) ?? 0;

      for (let plane = 0; plane < 4; plane++) {
        const at = plane * row + byte;

        bytes[at] = (index >> plane) & 1 ? bytes[at] | bit : bytes[at] & ~bit;
      }
    }

    memory.write(at, new DataView(bytes.buffer));
  }

  const selector = (blocks.bits ?? blocks.header) | 1;
  const pointer = bitmap.selected ? ((selector << 16) | (blocks.bits ? 0 : HEADER)) >>> 0 : 0;
  const header = new DataView(new ArrayBuffer(HEADER));

  header.setUint16(0x02, bitmap.width, true);
  header.setUint16(0x04, bitmap.height, true);
  header.setUint16(0x06, row, true);
  header.setUint8(0x08, 4);
  header.setUint8(0x09, 1);
  header.setUint32(0x0a, pointer, true);
  header.setUint32(0x0e, row * bitmap.height, true);
  header.setUint16(0x16, layout.inline ? 0 : 8, true);
  header.setUint16(0x18, layout.lines, true);
  header.setUint16(0x1a, layout.fill, true);
  memory.write(indexFor(blocks.header) * 0x10000, header);
}

/**
 * The bitmaps whose bits a program may have written that a call names --
 * as itself, or as the bitmap in a device context -- their pixels read from
 * their bits before it: what `syncBitmaps` then writes back. `null` for
 * none, which is nearly every call.
 */
export function loadBitmaps(system: any, args: unknown[]): DeviceBitmap[] | null {
  const held: Map<DeviceBitmap, Blocks> | undefined = system._bitmapBlocks;

  if (!held?.size) {
    return null;
  }

  let named: DeviceBitmap[] | null = null;

  for (const arg of args) {
    if (typeof arg !== 'number' || arg <= 0 || arg > 0xffff) {
      continue;
    }

    const item = system.handles.resolve(arg);
    const bitmap = held.has(item) ? item : held.has(item?.bitmap) ? item.bitmap : null;

    if (bitmap && !named?.includes(bitmap)) {
      load(system, bitmap, held.get(bitmap)!);
      (named ??= []).push(bitmap);
    }
  }

  return named;
}

/** The bits of the bitmaps `loadBitmaps` named written from their pixels again. */
export function syncBitmaps(system: any, bitmaps: DeviceBitmap[]) {
  const held: Map<DeviceBitmap, Blocks> | undefined = system._bitmapBlocks;

  for (const bitmap of bitmaps) {
    const blocks = held?.get(bitmap);

    if (blocks) {
      store(system, bitmap, blocks);
    }
  }
}
