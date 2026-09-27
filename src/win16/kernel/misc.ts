'use strict';

import { indexFor } from '../selectors.js';
import { GlobalLock } from './GlobalLock.js';

/**
 * Small calls a program makes on its way up. **Recorded** by `misc`.
 */

/** Wired blocks, by selector index: how many times each is wired. */
function wiredOf(system: any): Map<number, number> {
  return (system._wired ??= new Map());
}

/** How many times a block is wired, for `GlobalFlags`'s lock count. */
export function wiredCount(system: any, index: number) {
  return wiredOf(system).get(index) ?? 0;
}

/**
 * How the task wants errors handled; answers the mode before, nought to
 * begin with, and keeps whatever it is given.
 */
export function SetErrorMode(this: any, wMode: number) {
  const before = this._errorMode ?? 0;

  this._errorMode = wMode & 0xffff;

  return before;
}

/** The files a task may have open: more when asked, never fewer. Twenty to begin with. */
export function SetHandleCount(this: any, wNumber: number) {
  this._handleCount = Math.max(this._handleCount ?? 20, wNumber & 0xffff);

  return this._handleCount;
}

/**
 * A block locked where it is, as `GlobalLock` locks it -- the same pointer
 * -- and counted in its lock count, which `GlobalLock` does not.
 */
export function GlobalWire(this: any, hglb: number) {
  const far = GlobalLock.call(this, hglb);

  if (far) {
    const index = indexFor(hglb);

    wiredOf(this).set(index, wiredCount(this, index) + 1);
  }

  return far;
}

/** A wired block let go; answers -1. */
export function GlobalUnWire(this: any, hglb: number) {
  const index = indexFor(hglb);
  const count = wiredCount(this, index);

  if (count > 1) {
    wiredOf(this).set(index, count - 1);
  } else {
    wiredOf(this).delete(index);
  }

  return 0xffff;
}

/** Page-locks a block; answers its page-lock count after. */
export function GlobalPageLock(this: any, hglb: number) {
  const locks: Map<number, number> = (this._pageLocks ??= new Map());
  const index = indexFor(hglb);
  const count = (locks.get(index) ?? 0) + 1;

  locks.set(index, count);

  return count;
}

/** Page-unlocks a block; answers its page-lock count after, never under nought. */
export function GlobalPageUnlock(this: any, hglb: number) {
  const locks: Map<number, number> = (this._pageLocks ??= new Map());
  const index = indexFor(hglb);
  const count = Math.max(0, (locks.get(index) ?? 0) - 1);

  locks.set(index, count);

  return count;
}

/** A procedure instance freed: nothing to do, as `MakeProcInstance` made none of its own. */
export function FreeProcInstance(this: any, _lpProc: number) {}
