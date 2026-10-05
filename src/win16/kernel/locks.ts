'use strict';

/**
 * A global block's lock count, as KERNEL keeps it: one byte in the block's
 * arena, which `GlobalFlags` answers in its low byte. **Recorded** by
 * `glocks` and `misc`, and **read out** of `KRNL386.EXE` seg1:
 *
 * * `GlobalLock` (`0f9d`) counts a block up only where its descriptor marks
 *   it discardable, and without a ceiling: 255 locks more is nought.
 *   `glocks`: a discardable block shows 101h, then 102h; a moveable or a
 *   fixed one 0 however often it is locked.
 * * `GlobalUnlock` (`0fe6`) counts a discardable block down and answers the
 *   count left, nought for any other block; a count of nought, or of FFh,
 *   is left as it is and answers nought. `glocks`: 1 after two locks and
 *   one unlock, 0 for a moveable or a fixed block.
 * * `GlobalWire` (`1046`) counts any block it finds up, discardable or not
 *   (`misc`: a moveable block wired shows a count of one), and
 *   `GlobalUnWire` (`10da`) counts it down as `GlobalUnlock` does,
 *   answering -1 once it is nought and nought while it is not.
 * * `LockSegment` (`0f1e`) and `GlobalFix` (`0f2d`) count up to FFh and no
 *   further (`45f7`); `UnlockSegment` (`0f37`) and `GlobalUnfix` (`0f46`)
 *   count down as `GlobalUnlock` does (`4602`), leaving the count in CX.
 *   `LockSegment` and `UnlockSegment` count only a discardable block,
 *   `GlobalFix` and `GlobalUnfix` any block.
 * * A fixed block has no count: the routine each of these finds a block
 *   with (`2519`) gives a count only for a block whose handle is not its
 *   selector, so none of them counts one and `GlobalFlags` shows nought.
 * * `GlobalReAlloc` will not discard a block whose count is not nought
 *   (`40f9`, at `4129`): it answers NULL. `GlobalFree` frees a locked block
 *   all the same (`glocks`).
 *
 * KERNEL's own `LockResource` locks with `GlobalLock` (seg1 `8768`). The
 * pointers winbox.js's own modules take to blocks are not counted: what a
 * program sees of a count is only what it, or KERNEL for it, has counted.
 */

/** A block's index, and whether it is there to be counted: not discarded. */
function present(system: any, index: number) {
  return index !== 0 && system.allocator?.flagsOf && !system.allocator.isDiscarded?.(index);
}

/** Whether a block is discardable: `GMEM_DISCARDABLE`. */
export function isDiscardable(system: any, index: number) {
  return Boolean(present(system, index) && system.allocator.flagsOf(index) & 0x0100);
}

/** Whether a block is not fixed: moveable, or discardable. */
export function isMoveable(system: any, index: number) {
  return Boolean(present(system, index) && system.allocator.flagsOf(index) & 0x0102);
}

/** A block's count. */
export function locksOf(system: any, index: number) {
  return system.allocator?.locksOf?.(index) ?? 0;
}

/** Counted up, as `GlobalLock` and `GlobalWire` count: 255 and one is nought. */
export function lockUp(system: any, index: number) {
  system.allocator.setLocks(index, (locksOf(system, index) + 1) & 0xff);
}

/** Counted up, as `LockSegment` and `GlobalFix` count: no further than FFh. */
export function lockUpToCeiling(system: any, index: number) {
  const count = locksOf(system, index);

  if (count < 0xff) {
    system.allocator.setLocks(index, count + 1);
  }
}

/**
 * Counted down: the count left. A count of nought or FFh is left as it is,
 * and answers nought.
 */
export function lockDown(system: any, index: number) {
  const count = locksOf(system, index);

  if (count === 0 || count === 0xff) {
    return 0;
  }

  system.allocator.setLocks(index, count - 1);

  return count - 1;
}
