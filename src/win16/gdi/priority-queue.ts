'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { GlobalReAlloc } from '../kernel/GlobalReAlloc.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';

/**
 * GDI's priority queue, which the spooler keeps its jobs in, as `GDI.EXE`
 * seg27 has it (**read out**; **recorded** by `gdipq`). A queue is a global
 * block (`GMEM_MOVEABLE | GMEM_DDESHARE`, seg1 `1f6d`) of four header words
 * and then entries of two words each, a key and a tag:
 *
 * * word 0: where the entries end, in bytes from the first;
 * * word 1: how many bytes of entries the block holds;
 * * word 2: the last key appended, or 4000h once the entries are a heap;
 * * word 3: where the first entry still in the queue starts, in bytes.
 *
 * Kept in order while keys come in order -- each appended, the first taken
 * by moving word 3 on -- and made a heap the first time one comes smaller
 * than the last: keys are compared unsigned throughout. Every answer is
 * the block's own words, so a program reading the block sees what Windows'
 * would hold. As the Rust engine's `gdi/priority_queue.rs`.
 */

const HEADER = 8;
const HEAP = 0x4000;

interface Block {
  read(at: number): number;
  write(at: number, value: number): void;
}

function lock(system: any, handle: number): Block | null {
  const far = globalPointer.call(system, handle);

  if (!far) {
    return null;
  }

  const core = system.machine.cpu.core;
  const selector = far >>> 16;
  const base = far & 0xffff;

  return {
    read: (at: number) => core.read16(selector, (base + at) & 0xffff) & 0xffff,
    write: (at: number, value: number) =>
      core.write16(selector, (base + at) & 0xffff, value & 0xffff),
  };
}

/** The entries from word 3 on moved down to the first, word 3 nought (seg27 `025a`). */
function compact(block: Block) {
  const start = block.read(6);
  const words = ((block.read(2) - start) & 0xffff) >>> 1;

  block.write(0, block.read(0) - start);

  for (let i = 0; i < words; i++) {
    block.write(HEADER + i * 2, block.read(HEADER + start + i * 2));
  }

  block.write(6, 0);
}

/** A child's entry and its parent's swapped where the child's key is the smaller (seg27 `00d9`): whether they were. */
function swapSmaller(block: Block, child: number, parent: number) {
  const childKey = block.read(HEADER + child);
  const parentKey = block.read(HEADER + parent);

  if (childKey >= parentKey) {
    return false;
  }

  const childTag = block.read(HEADER + child + 2);

  block.write(HEADER + child, parentKey);
  block.write(HEADER + child + 2, block.read(HEADER + parent + 2));
  block.write(HEADER + parent, childKey);
  block.write(HEADER + parent + 2, childTag);
  return true;
}

/**
 * A queue of room for `count` entries (seg27 `0000`): its block's handle,
 * the header `[0, count * 4, 0, 0]`; -1 where the block is not given.
 */
export function CreatePQ(this: any, count: number) {
  const bytes = (count << 2) & 0xffff;
  const handle = GlobalAlloc.call(this, 0x2002, bytes + HEADER) & 0xffff;

  if (!handle) {
    return 0xffff;
  }

  const block = lock(this, handle);

  if (block) {
    block.write(0, 0);
    block.write(2, bytes);
    block.write(4, 0);
    block.write(6, 0);
  }

  GlobalUnlock.call(this, handle);
  return handle;
}

/**
 * An entry added (seg27 `0045`): the queue's handle, -1 where it is full
 * -- its entries from word 3 on fill it -- or not a block. One that ends the
 * block moves the entries down first. Appended; a key not below the last,
 * unsigned, is the last; a smaller one moves the entries down, makes them a
 * heap (word 2 4000h) and is sifted up towards the first, its parent the
 * entry at `((offset >> 1) - 2) & ~3`.
 */
export function InsertPQ(this: any, handle: number, tag: number, key: number) {
  const block = lock(this, handle);

  if (!block || ((block.read(0) - block.read(6)) & 0xffff) >= block.read(2)) {
    GlobalUnlock.call(this, handle);
    return 0xffff;
  }

  if (block.read(0) >= block.read(2)) {
    compact(block);
  }

  const end = block.read(0);

  block.write(HEADER + end + 2, tag);
  block.write(HEADER + end, key);
  block.write(0, end + 4);

  if ((key & 0xffff) >= block.read(4)) {
    block.write(4, key);
  } else {
    compact(block);
    block.write(4, HEAP);

    let at = (block.read(0) - 4) & 0xffff;

    while (at !== block.read(6)) {
      const parent = ((at >>> 1) - 2) & 0xfffc;
      const swapped = swapSmaller(block, at, parent);

      at = parent;

      if (!swapped) {
        break;
      }
    }
  }

  GlobalUnlock.call(this, handle);
  return handle;
}

/**
 * The first entry's tag, or the first taken (seg27 `00fb`, `00fe`): -1 for
 * an empty queue, or not a block. The last taken empties the header but its
 * size; in order, word 3 moves on; a heap's last entry is put first and
 * sifted down by the smaller child -- the right where they tie -- swapped
 * where it is the smaller, all the way down.
 */
function first(system: any, handle: number, take: boolean) {
  const block = lock(system, handle);

  if (!block) {
    GlobalUnlock.call(system, handle);
    return 0xffff;
  }

  const start = block.read(6);

  if (start >= block.read(0)) {
    GlobalUnlock.call(system, handle);
    return 0xffff;
  }

  const tag = block.read(HEADER + start + 2);

  if (take) {
    const next = (start + 4) & 0xffff;

    if (next >= block.read(0)) {
      block.write(4, 0);
      block.write(6, 0);
      block.write(0, 0);
    } else if (block.read(4) < HEAP) {
      block.write(6, next);
    } else {
      const last = (start + block.read(0) - 4) & 0xffff;

      block.write(0, last);
      block.write(HEADER + start, block.read(HEADER + last));
      block.write(HEADER + start + 2, block.read(HEADER + last + 2));

      for (let parent = 0; ;) {
        let child = (parent * 2 + 4) & 0xffff;

        if (child >= block.read(0)) {
          break;
        }

        const right = (child + 4) & 0xffff;

        if (right < block.read(0) && block.read(HEADER + child) >= block.read(HEADER + right)) {
          child = right;
        }

        swapSmaller(block, child, parent);
        parent = child;
      }
    }
  }

  GlobalUnlock.call(system, handle);
  return tag;
}

export function MinPQ(this: any, handle: number) {
  return first(this, handle, false);
}

export function ExtractPQ(this: any, handle: number) {
  return first(this, handle, true);
}

/**
 * The queue's room asked, or grown or shrunk by `delta` entries (seg27
 * `01dc`). Every answer but two is `GlobalUnlock`'s, nought for its
 * moveable block -- asked, the room in entries is in AX until the unlock
 * answers over it -- and so is a size below what the entries reach. -1 for
 * no block, or one `GlobalReAlloc` will not give.
 */
export function SizePQ(this: any, handle: number, delta: number) {
  let block = lock(this, handle);

  if (!block) {
    return 0xffff;
  }

  if (delta & 0xffff) {
    const bytes = ((delta << 2) + block.read(2)) & 0xffff;

    if (bytes >= block.read(0)) {
      GlobalUnlock.call(this, handle);

      const moved = GlobalReAlloc.call(this, handle, bytes + HEADER, 0x0002) & 0xffff;

      if (!moved) {
        return 0xffff;
      }

      handle = moved;
      block = lock(this, moved);
      block?.write(2, bytes);
    }
  }

  return GlobalUnlock.call(this, handle) & 0xffff;
}

/** The queue's block freed (seg27 `01cb`): `GlobalFree`'s answer, nought. */
export function DeletePQ(this: any, handle: number) {
  return GlobalFree.call(this, handle) & 0xffff;
}
