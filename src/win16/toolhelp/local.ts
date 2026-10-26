'use strict';

import { structure } from './structures.js';

/** `LOCALINFO`'s and `LOCALENTRY`'s sizes. */
const LOCALINFO = 6;
const LOCALENTRY = 0x16;

/** `LOCALENTRY.wFlags`: fixed, free, moveable. */
const LF_FIXED = 1;
const LF_FREE = 2;
const LF_MOVEABLE = 4;

/** `LOCALENTRY.wType` of a free block. */
const LT_FREE = 0xff;

/**
 * A handle's selector, as TOOLHELP makes one of either (`TOOLHELP.DLL`
 * seg1 `14c4`-`14e5`): its lowest bit set.
 */
export function selectorOf(handle: number) {
  return (handle | 1) & 0xffff;
}

/**
 * Where a segment's local heap's information is, if it has one, as
 * TOOLHELP finds it (`TOOLHELP.DLL` seg1 `07ec`-`0847`): the selector
 * present with a limit past 2Ah and 8, the word at 6 not nought, the
 * segment reaching 2Ah past it, and `LH` at 28h of it. Nought for none.
 */
export function heapInformation(system: any, selector: number) {
  const core = system.machine.cpu.core;
  const descriptor = core.peekDescriptor(selector);

  if (!descriptor?.present || descriptor.limit <= 0x2a) {
    return 0;
  }

  const info = core.read16(selector, 6) & 0xffff;

  if (!info || descriptor.limit - info <= 0x2a) {
    return 0;
  }

  return (core.read16(selector, (info + 0x28) & 0xffff) & 0xffff) === 0x484c ? info : 0;
}

/**
 * How many arenas a heap has, its information's word 4 (`TOOLHELP.DLL`
 * seg1 `06f6`); FALSE for a segment with no heap.
 */
export function LocalInfo(this: any, lpli: number, hHeap: number) {
  const entry = structure(this, lpli, LOCALINFO);

  if (!entry) {
    return 0;
  }

  const selector = selectorOf(hHeap);
  const info = heapInformation(this, selector);

  entry.write16(4, info ? this.machine.cpu.core.read16(selector, info + 4) : 0);

  return 1;
}

/**
 * A `LOCALENTRY` filled for the arena at `arena`, as `TOOLHELP.DLL` seg1
 * `0744`-`07e9` and `0a4f`-`0a8d` fill it: the handle from the arena's
 * word 4; the bytes from 4 past the arena, 6 for a moveable block; the
 * size to the next arena; the flags, the arena's low two bits made
 * `LF_MOVEABLE`, `LF_FIXED` or `LF_FREE`; a moveable block's lock count
 * from its handle's entry (byte 3); a fixed block's handle its address and
 * its lock count nought; a free block's handle nought and its type
 * `LT_FREE`; the heap's type -- 1 for USER's data segment, 2 for GDI's;
 * and the next arena, nought where it is the arena itself, the last.
 * USER's and GDI's blocks' types come from them on Windows; any other
 * block's is nought, `LT_NORMAL`.
 */
function fill(system: any, entry: any, selector: number, arena: number) {
  const core = system.machine.cpu.core;
  const word = (at: number) => core.read16(selector, at & 0xffff) & 0xffff;
  const data = system._moduleData ?? {};
  const next = word(arena + 2);
  const bits = word(arena) & 3;
  let address = (arena + 4) & 0xffff;
  let size = (next - arena - 4) & 0xffff;
  let handle = word(arena + 4);
  let lock = 0;

  if (bits & 2) {
    size = (size - 2) & 0xffff;
    address = (address + 2) & 0xffff;
    lock = core.read8(selector, (handle + 3) & 0xffff) & 0xff;
  } else {
    handle = address;
  }

  const flags = bits & 2 ? LF_MOVEABLE : bits & 1 ? LF_FIXED : LF_FREE;

  entry.write16(0x04, flags === LF_FREE ? 0 : handle);
  entry.write16(0x06, address);
  entry.write16(0x08, size);
  entry.write16(0x0a, flags);
  entry.write16(0x0c, lock);
  entry.write16(0x0e, flags === LF_FREE ? LT_FREE : 0);
  entry.write16(0x10, selector);
  entry.write16(0x12, selector === data.USER ? 1 : selector === data.GDI ? 2 : 0);
  entry.write16(0x14, next === arena ? 0 : next);
}

/**
 * A heap's first arena, filled in (`TOOLHELP.DLL` seg1 `095e`): its
 * information's word 6. FALSE for a segment with no heap.
 */
export function LocalFirst(this: any, lple: number, hHeap: number) {
  const entry = structure(this, lple, LOCALENTRY);
  const selector = selectorOf(hHeap);
  const info = entry ? heapInformation(this, selector) : 0;

  if (!info) {
    return 0;
  }

  const first = this.machine.cpu.core.read16(selector, info + 6) & 0xffff;

  if (!first) {
    return 0;
  }

  fill(this, entry, selector, first);

  return 1;
}

/**
 * The arena after the one filled in, from its `wNext` and `hHeap` (seg1
 * `09e9`): FALSE at the last, KERNEL's own, whose next is itself.
 * **Recorded** by `thheap`.
 */
export function LocalNext(this: any, lple: number) {
  const entry = structure(this, lple, LOCALENTRY);

  if (!entry) {
    return 0;
  }

  fill(this, entry, entry.read16(0x10), entry.read16(0x14));

  return entry.read16(0x14) ? 1 : 0;
}
