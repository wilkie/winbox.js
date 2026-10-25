'use strict';

import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';

/**
 * What a program dropped files on is given: `WM_DROPFILES`'s handle, a
 * block of global memory File Manager fills (`DROPFILESTRUCT`), which these
 * read as SHELL reads it -- **read out of `SHELL.DLL`** (seg6) and
 * **recorded** by `dragq`:
 *
 *     +0  the offset of the names, from the block's start
 *     +2  the point it was dropped at, x and y
 *     +6  whether it was dropped outside the client area
 *         ...then the names, each ended by a nought, a nought after them
 *
 * As the Rust engine's `shell/drag.rs`.
 */

function core(system: any) {
  return system.machine.cpu.core;
}

/**
 * Where the files were dropped, written to a `POINT`; whether that was in
 * the client area: 1 where the block's flag is nought (`SHELL.DLL` seg6
 * `0000`-`004f`).
 */
export function DragQueryPoint(this: any, hDrop: number, lppt: number) {
  const far = GlobalLock.call(this, hDrop) >>> 0;
  const memory = core(this);
  const read = (at: number) => memory.read16(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  const x = read(2);
  const y = read(4);
  const outside = read(6);

  memory.write16(lppt >>> 16, lppt & 0xffff, x);
  memory.write16(lppt >>> 16, ((lppt & 0xffff) + 2) & 0xffff, y);
  GlobalUnlock.call(this, hDrop);

  return outside ? 0 : 1;
}

/**
 * A file's name, or how many there are (seg6 `0094`-`013e`): for -1 the
 * count; else the name's length, and where a buffer is given with room, as
 * much of it as fits copied with its nought -- the answer the name's whole
 * length all the same (`0129`). Past the last name, nought.
 */
export function DragQueryFile(this: any, hDrop: number, iFile: number, lpszFile: number, cb: number) {
  const far = GlobalLock.call(this, hDrop) >>> 0;
  const memory = core(this);
  const selector = far >>> 16;
  const base = far & 0xffff;
  const byte = (at: number) => memory.read8(selector, at & 0xffff);
  const index = iFile & 0xffff;
  let at = (base + memory.read16(selector, base)) & 0xffff;
  let count = 0;

  while ((index === 0xffff || count !== index) && byte(at)) {
    while (byte(at++)) {
      // the name
    }

    count++;
  }

  let answer = count;

  if (index !== 0xffff) {
    let length = 0;

    while (byte(at + length)) {
      length++;
    }

    answer = length;

    let size = cb & 0xffff;

    if (length && size && lpszFile) {
      size--;

      const copied = Math.min(length, size);

      for (let i = 0; i < copied; i++) {
        memory.write8(lpszFile >>> 16, ((lpszFile & 0xffff) + i) & 0xffff, byte(at + i));
      }

      memory.write8(lpszFile >>> 16, ((lpszFile & 0xffff) + copied) & 0xffff, 0);
    }
  }

  GlobalUnlock.call(this, hDrop);

  return answer;
}

/** The block let go (seg6 `0142`), `GlobalFree`'s answer left in AX: nought. */
export function DragFinish(this: any, hDrop: number) {
  return GlobalFree.call(this, hDrop);
}
