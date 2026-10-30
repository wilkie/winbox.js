'use strict';

import { GF_PDB_OWNER, GT_TASK, globalBlocks } from '../toolhelp/global.js';
import { indexFor, segmentSelector } from '../selectors.js';
import { liveTask } from './task-order.js';

/**
 * A global block's owner, as KERNEL keeps it in the block's arena: KERNEL's
 * ordinals 404 and 403, which only KERNEL's own code calls. **Read out** of
 * `KRNL386.EXE` and **recorded** by `kowner`. As the Rust engine's
 * `kernel_calls/owners.rs`.
 *
 * Windows' owner is a module for its segments, its database and a
 * `GMEM_SHARE` block; a task's prefix for a block the task allocated; the
 * task itself for its own database. WinBox keeps a block's task, as
 * TOOLHELP's `GlobalEntry` gives it, and makes the
 * prefix of it. An owner set with ordinal 403 is kept here, by block.
 */

/** The owners ordinal 403 set, by the block's index. */
function setOwners(system: any): Map<number, number> {
  return (system._setOwners ??= new Map());
}

/** A task's prefix's selector, nought for no task. */
function prefixOf(system: any, handle: number) {
  const task = liveTask(system, handle);

  return task ? segmentSelector(task.programSegment) : 0;
}

/**
 * Ordinal 404: a block's owner (`KRNL386.EXE` seg1 `29ae`, its body `29bf`):
 * the block's arena found through the selector table (`297c`), its word at
 * 12h answered; nought where the selector is past the table. **Recorded**
 * by `kowner`: the module for the probe's data and code segments, its
 * module's database and a `GMEM_SHARE` block; the prefix for a block it
 * allocated; the task for the task's database; USER for USER's data;
 * nought for the prefix itself, which WinBox keeps in no block, for nought
 * and for a selector that is no block's.
 *
 * @param {Types.UINT} wSelector - The block's selector or handle.
 *
 * @returns {Types.UINT} Its owner.
 */
export function K404(this: any, wSelector: number) {
  const selector = wSelector & 0xffff;

  if (!selector) {
    return 0;
  }

  const index = indexFor(selector);
  const set = setOwners(this).get(index);

  /* An owner set for a block since freed goes with it. */
  if (set !== undefined && this.allocator.sizeOf(index)) {
    return set;
  }

  setOwners(this).delete(index);

  const block = globalBlocks(this).find((each) =>
    each.type === GT_TASK ? indexFor(each.handle) === index : each.index === index
  );

  if (!block) {
    return 0;
  }

  return block.flags & GF_PDB_OWNER ? prefixOf(this, block.owner) : block.owner & 0xffff;
}

/**
 * Ordinal 403: a block's owner set (`KRNL386.EXE` seg1 `29f1`, its body
 * `2a03`): the arena found as ordinal 404 finds it, and the owner written to
 * its word at 12h. Nothing is answered: AX is as the caller had it, with
 * EAX pushed and popped about the write (`2a11`, `2a20`). **Recorded** by
 * `kowner`: ordinal 404 answers the owner set.
 *
 * A block of `GlobalAlloc`'s made a task's prefix's is that task's, as its
 * own are, and freed with them; made anything else's it is no task's, and
 * a task's end leaves it, as Windows' frees only the blocks its prefix
 * owns.
 *
 * @param {Types.UINT} wSelector - The block's selector or handle.
 * @param {Types.UINT} wOwner - Its new owner.
 */
export function K403(this: any, wSelector: number, wOwner: number) {
  const selector = wSelector & 0xffff;
  const owner = wOwner & 0xffff;

  if (!selector) {
    return;
  }

  const index = indexFor(selector);
  const object = this.allocator._objects?.[index];

  setOwners(this).set(index, owner);

  if (object) {
    const tasks = this.scheduler?._tasks ?? {};
    const task = Number(
      Object.keys(tasks).find((handle) => owner && prefixOf(this, Number(handle)) === owner) ?? 0
    );

    object.owner = task;

    if (task) {
      setOwners(this).delete(index);
    }
  }
}
