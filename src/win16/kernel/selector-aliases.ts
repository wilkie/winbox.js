'use strict';

import { segmentSelector } from '../selectors.js';

/**
 * A second selector for a segment's memory, for code where the first is for
 * data, or the other way: a program writes code through a data selector and
 * runs it through the alias (documented). Its selector, or nought.
 */
export function AllocDSToCSAlias(this: any, wSelector: number) {
  return aliasOf(this, wSelector, true);
}

/** A data selector for a code segment's memory; see `AllocDSToCSAlias`. */
export function AllocCSToDSAlias(this: any, wSelector: number) {
  return aliasOf(this, wSelector, false);
}

/**
 * A new selector: a copy of the one given, sharing its memory, or with none
 * given one for nothing yet, data not yet accessed. **Recorded** by
 * `selalias`.
 */
export function AllocSelector(this: any, wSelector: number) {
  const index = (wSelector & 0xffff) >> 3;
  const made = index
    ? this.allocator.globalAllocator.alias(index, false)
    : this.allocator.globalAllocator.blank();

  return made < 0 ? 0 : segmentSelector(made);
}

/**
 * The second selector made a copy of the first, code for data and data for
 * code; it answers the second. **Recorded** by `selalias`: a block's data
 * selector made code, and code made data again.
 */
export function PrestoChangoSelector(this: any, sourceSel: number, destSel: number) {
  const from = (sourceSel & 0xffff) >> 3;
  const to = (destSel & 0xffff) >> 3;

  if (!from || !to) {
    return 0;
  }

  this.allocator.globalAllocator.copySwapped(from, to);

  return destSel & 0xffff;
}

/** A selector given up, as one made by an alias: nought when done (documented). */
export function FreeSelector(this: any, wSelector: number) {
  const index = (wSelector & 0xffff) >> 3;

  if (!index) {
    return wSelector;
  }

  this.allocator.globalAllocator.release(index);

  return 0;
}

/**
 * A selector's base moved, straight into its descriptor, and the selector
 * answered (`KRNL386.EXE` seg1 `2725`-`2752`). **Recorded** by `ktask`.
 */
export function SetSelectorBase(this: any, wSelector: number, dwBase: number) {
  const index = (wSelector & 0xffff) >> 3;

  if (index) {
    this.allocator.globalAllocator.setBase(index, dwBase >>> 0);
  }

  return wSelector & 0xffff;
}

/**
 * A selector's limit, its low word and the low four bits of its high word,
 * straight into its descriptor; nought (seg1 `276d`-`2798`). **Recorded**
 * by `ktask`.
 */
export function SetSelectorLimit(this: any, wSelector: number, dwLimit: number) {
  const index = (wSelector & 0xffff) >> 3;

  if (index) {
    this.allocator.globalAllocator.setLimit(index, dwLimit & 0xfffff);
  }

  return 0;
}

/** The bits of a selector's rights a program may change: its type and its flags. */
const CHANGEABLE = 0xd01e;

/**
 * A selector's rights, as `LAR` reads them shifted down a byte -- the
 * access byte and the flags' -- held to its type and flags, D01Eh, for
 * `wOp` nought; else those bits set from `wRights` through DPMI's 0009h,
 * the rest kept, and nought answered (`KRNL386.EXE` seg1 `279b`-`27cb`).
 * **Recorded** by `ktask`.
 */
export function SelectorAccessRights(this: any, wSelector: number, wOp: number, wRights: number) {
  const index = (wSelector & 0xffff) >> 3;
  const allocator = this.allocator.globalAllocator;
  const rights = index ? allocator.rightsOf(index) : 0;

  if (!(wOp & 0xffff)) {
    return rights & CHANGEABLE;
  }

  if (index) {
    allocator.setRights(index, (wRights & CHANGEABLE) | (rights & ~CHANGEABLE & 0xffff));
  }

  return 0;
}

/**
 * Selectors one after another, each a data segment at nought of no limit:
 * the first, or nought (seg1 `1df5`-`1e28`). **Recorded** by `ktask`.
 */
export function AllocSelectorArray(this: any, uSelectors: number) {
  const count = uSelectors & 0xffff;
  const index = count ? this.allocator.globalAllocator.blankRun(count) : -1;

  return index < 0 ? 0 : segmentSelector(index);
}

/**
 * A code selector for a segment's memory, the given one in DX (seg1
 * `21fb`-`2220`). **Recorded** by `ktask`: code, its base and limit the
 * data segment's.
 */
export function AllocAlias(this: any, wSelector: number) {
  return (((wSelector & 0xffff) << 16) | aliasOf(this, wSelector, true)) >>> 0;
}

function aliasOf(system: any, selector: number, code: boolean) {
  const index = (selector & 0xffff) >> 3;

  if (!index) {
    return 0;
  }

  const alias = system.allocator.globalAllocator.alias(index, code);

  return alias < 0 ? 0 : segmentSelector(alias);
}

/**
 * A selector's limit, its last offset, as `LSL` reads it: nought for a
 * selector that names no segment. **Recorded** by `grow`: a block grown to
 * 15000h has 14FFFh on its first selector and 4FFFh on the next; shrunk
 * back, the next one reads nought.
 *
 * @param {Types.UINT} uSelector - The selector.
 *
 * @returns {Types.DWORD} Its limit.
 */
export function GetSelectorLimit(this: any, uSelector: number) {
  return (this.machine.cpu.core.peekDescriptor(uSelector)?.limit ?? 0) >>> 0;
}

/**
 * A selector's base, the linear address its segment starts at, or nought
 * for one that names no segment. Not recorded: the addresses are the
 * machine's own, and are not Windows'.
 *
 * @param {Types.UINT} uSelector - The selector.
 *
 * @returns {Types.DWORD} Its base.
 */
export function GetSelectorBase(this: any, uSelector: number) {
  return (this.machine.cpu.core.peekDescriptor(uSelector)?.base ?? 0) >>> 0;
}
