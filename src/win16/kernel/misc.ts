'use strict';

import { handleFor, indexFor } from '../selectors.js';
import { globalPointer } from './GlobalLock.js';
import { isMoveable, lockDown, lockUp, lockUpToCeiling } from './locks.js';

/**
 * Small calls a program makes on its way up. **Recorded** by `misc`.
 */

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
 * -- and counted in its lock count whether it is discardable or not
 * (`misc`; seg1 `104e`). See `locks.ts`.
 */
export function GlobalWire(this: any, hglb: number) {
  const far = globalPointer.call(this, hglb);
  const index = indexFor(hglb);

  if (far && isMoveable(this, index)) {
    lockUp(this, index);
  }

  return far;
}

/**
 * A wired block let go, its count counted down: -1 once the count is
 * nought, nought while it is not (seg1 `10f9`). See `locks.ts`.
 */
export function GlobalUnWire(this: any, hglb: number) {
  const index = indexFor(hglb);

  if (isMoveable(this, index) && lockDown(this, index)) {
    return 0;
  }

  return 0xffff;
}

/**
 * A block fixed where it is, counted up in its lock count no further than
 * FFh: its handle, nought for one that names no block there (seg1 `0f2d`).
 * See `locks.ts`.
 */
export function GlobalFix(this: any, hglb: number) {
  const index = indexFor(hglb);

  if (!this.allocator?.sizeOf(index)) {
    return 0;
  }

  if (isMoveable(this, index)) {
    lockUpToCeiling(this, index);
  }

  return handleFor(index);
}

/**
 * A fixed block let go, counted down as `GlobalUnlock` counts: its handle,
 * nought for one that names no block there (seg1 `0f46`). See `locks.ts`.
 */
export function GlobalUnfix(this: any, hglb: number) {
  const index = indexFor(hglb);

  if (!this.allocator?.sizeOf(index)) {
    return 0;
  }

  if (isMoveable(this, index)) {
    lockDown(this, index);
  }

  return handleFor(index);
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

/**
 * Names the procedure KERNEL calls before it discards one of the task's
 * blocks made with `GMEM_NOTIFY`, to make room.
 *
 * **Read out** of `KRNL386.EXE` (seg1 `1171`): the far pointer is kept in the
 * current task's database, at `2Eh`, and nothing is answered. Paintbrush
 * names one as it starts. winbox.js never discards a block to make room, so
 * the procedure is kept and never called.
 */
export function GlobalNotify(this: any, lpNotifyProc: number) {
  const task = this.scheduler?.task;

  if (task) {
    task.globalNotify = lpNotifyProc >>> 0;
  }
}
