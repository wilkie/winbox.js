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

function aliasOf(system: any, selector: number, code: boolean) {
  const index = (selector & 0xffff) >> 3;

  if (!index) {
    return 0;
  }

  const alias = system.allocator.globalAllocator.alias(index, code);

  return alias < 0 ? 0 : segmentSelector(alias);
}
