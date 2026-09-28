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
