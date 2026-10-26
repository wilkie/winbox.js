'use strict';

import { indexFor } from '../selectors.js';
import { GT_MODULE, globalBlocks } from './global.js';
import { selectorOf } from './local.js';

/**
 * How far a selector's memory may be read or written from, as `MemoryRead`
 * and `MemoryWrite` find it (`TOOLHELP.DLL` seg1 `29c4`-`2a4a`,
 * `2b6c`-`2bf6`): the selector must be present, or a code segment, which
 * is loaded; an offset at or past its block's size -- or, for a selector of
 * no block, past its limit -- reaches nothing; and the bytes reached run to
 * its limit (`2a5c`-`2a72`). Nought for a selector that reaches nothing.
 */
function reach(system: any, wSel: number, dwOffset: number, dwcb: number) {
  const selector = selectorOf(wSel);
  const descriptor = system.machine.cpu.core.peekDescriptor(selector);

  if (!descriptor || (!descriptor.present && !descriptor.executable)) {
    return { selector, count: 0 };
  }

  const block = globalBlocks(system).find(
    (each) => each.index && each.index === indexFor(selector) && each.type !== GT_MODULE
  );
  const size = block ? block.size : descriptor.limit;
  const offset = dwOffset >>> 0;

  if (offset >= size) {
    return { selector, count: 0 };
  }

  const room = descriptor.limit - offset + 1;

  return { selector, count: Math.max(0, Math.min(dwcb >>> 0, room)) };
}

/**
 * Bytes read through a selector, however it is described, into a buffer:
 * how many. **Recorded** by `thtask`: a block of 100 bytes reads to 128,
 * its limit; its handle reads as its selector; the code segment reads.
 */
export function MemoryRead(
  this: any,
  wSel: number,
  dwOffset: number,
  lpBuffer: number,
  dwcb: number
) {
  const { selector, count } = reach(this, wSel, dwOffset, dwcb);
  const core = this.machine.cpu.core;
  const base = core.peekDescriptor(selector)?.base ?? 0;
  const target = (lpBuffer >>> 16) & 0xffff;
  const start = lpBuffer & 0xffff;

  for (let at = 0; at < count; at++) {
    core.write8(
      target,
      (start + at) & 0xffff,
      this._memory.read8((base + (dwOffset >>> 0) + at) >>> 0)
    );
  }

  return count >>> 0;
}

/**
 * Bytes written through a selector, even a code segment's -- TOOLHELP
 * writes through a data alias of it (`TOOLHELP.DLL` seg1 `2c09`, `2d68`) --
 * from a buffer: how many. **Recorded** by `thtask`.
 */
export function MemoryWrite(
  this: any,
  wSel: number,
  dwOffset: number,
  lpBuffer: number,
  dwcb: number
) {
  const { selector, count } = reach(this, wSel, dwOffset, dwcb);
  const core = this.machine.cpu.core;
  const base = core.peekDescriptor(selector)?.base ?? 0;
  const source = (lpBuffer >>> 16) & 0xffff;
  const start = lpBuffer & 0xffff;

  for (let at = 0; at < count; at++) {
    this._memory.write8(
      (base + (dwOffset >>> 0) + at) >>> 0,
      core.read8(source, (start + at) & 0xffff)
    );
  }

  return count >>> 0;
}
