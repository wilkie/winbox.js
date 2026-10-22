'use strict';

import { reaches } from './bad-pointers.js';

/**
 * A local heap's notify procedure replaced, the caller's heap's: KERNEL
 * swaps the far pointer at offset 1Eh of the heap's information, which DS:6
 * points at, and answers the one that was there (`KRNL386.EXE` seg2 `0278`,
 * `28a0`-`28b4`). KERNEL's own is `8de2` in its first code segment, which
 * `LocalInit` puts there; WinBox has no such segment, and its offset is
 * there with the segment nought (`Heap.init`). **Recorded** by `locinfo`.
 *
 * WinBox's heap tells KERNEL's own procedure, as its routines do, whatever
 * is there: a program's own is not called.
 *
 * @param {Types.FARPTR} lpfn - The new procedure.
 *
 * @returns {Types.DWORD} The one before it.
 */
export function LocalNotify(this: any, lpfn: number) {
  const core = this.machine.cpu.core;
  const ds = core.ds;
  const info = core.read16(ds, 6);
  const before = (core.read16(ds, info + 0x1e) | (core.read16(ds, info + 0x20) << 16)) >>> 0;

  core.write16(ds, info + 0x1e, lpfn & 0xffff);
  core.write16(ds, info + 0x20, (lpfn >>> 16) & 0xffff);

  return before;
}

/**
 * The bytes free in the caller's local heap: each free block's size less
 * the ten of its arena, walking the free list from the first arena to the
 * last (`KRNL386.EXE` seg2 `29c9`-`2a00`). Nought where the heap's
 * information cannot be read through DS, by its limit (seg1 `2a55`), or
 * has no `LH` at 28h. **Recorded** by `locinfo`.
 *
 * @returns {Types.UINT} The bytes free.
 */
export function LocalCountFree(this: any) {
  const core = this.machine.cpu.core;
  const ds = core.ds;
  const info = core.read16(ds, 6);

  if (!reaches(core, ds, info + 0x28) || core.read16(ds, (info + 0x28) & 0xffff) !== 0x484c) {
    return 0;
  }

  const last = core.read16(ds, info + 0xa);
  let at = core.read16(ds, (core.read16(ds, info + 6) + 8) & 0xffff);
  let free = 0;

  for (let guard = 0; at !== last && guard < 0x8000; guard++) {
    free = (free + core.read16(ds, (at + 4) & 0xffff) - 0xa) & 0xffff;
    at = core.read16(ds, (at + 8) & 0xffff);
  }

  return free;
}

/**
 * The caller's local heap's size: its last arena's address less its first's
 * (`KRNL386.EXE` seg2 `2a01`-`2a0b`), read from the heap's information,
 * which DS:6 points at, with nothing checked. **Recorded** by `locinfo`.
 *
 * @returns {Types.UINT} The size.
 */
export function LocalHeapSize(this: any) {
  const core = this.machine.cpu.core;
  const ds = core.ds;
  const info = core.read16(ds, 6);

  return (core.read16(ds, info + 0xa) - core.read16(ds, info + 6)) & 0xffff;
}
