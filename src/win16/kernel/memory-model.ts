'use strict';

/**
 * How big a global block may be, and how much memory there is to give.
 *
 * **Read out** of `KRNL386.EXE` seg1. `GlobalAlloc` (`022b`, `0d2f`),
 * `GlobalReAlloc` (`028c`, `0d68`) and `GlobalDosAlloc` (`139a`, which calls
 * `0d2f` with KERNEL's flag 8000h) all take the size through `0c7c`: rounded
 * up to 16 bytes, and anything that carries past 32 bits or comes to more
 * than FF0000h -- 16 MiB less 64 KiB, the most 255 selectors of a block
 * reach -- made 7FFFFFFFh, a size no block can have. `GlobalAlloc`'s `4025`
 * refuses more than FF0000h at once, logging `ERR_GALLOC` and answering
 * nought; `GlobalReAlloc`'s `40f9` refuses it when no selectors or room are
 * found for it (`20a8` takes no more than FEh selectors).
 *
 * Within the limit, a block is searched for (`379e`); not found, KERNEL asks
 * DPMI for more memory (`397e`, `int 31h` 0501h), compacts the heap and
 * discards what can be discarded (`34c4`, `2f28`), and searches again;
 * still not found, the request is refused with nought.
 *
 * How much there is depends on the machine. **Recorded** by `galimit`
 * under DOSBox, as the probe started: `GetFreeSpace(0)` EBB4E0h,
 * `GlobalCompact(0)` E24000h, and the largest block `GlobalAlloc` grants
 * E34000h, 10000h more than `GlobalCompact` answers. A block held makes
 * `GetFreeSpace` less by its size, and freed gives it back. This machine is
 * the one modelled: what winbox.js holds when a program first asks KERNEL
 * for memory or how much there is, through `GlobalAlloc`, `GlobalReAlloc`,
 * `GlobalDosAlloc`, `GetFreeSpace` or `GlobalCompact`, stands for what
 * Windows held then; every byte held beyond it is taken from all three
 * figures, every byte given back returns to them.
 *
 * In 386 enhanced mode the same machine has more: WIN386 gives KERNEL
 * virtual memory, its swap file's pages with the machine's. **Recorded** by
 * `galimit` in enhanced mode (`enhanced/galimit`): `GetFreeSpace(0)`
 * 38F5C60h; `GlobalCompact(0)` FF0000h and the largest block FF0000h, the
 * limit itself, where standard mode's machine runs out first. What lies
 * past the limit is not seen through these calls; the largest free block
 * DPMI 0500h names, 3868000h (`enhmode`), stands for it (inferred),
 * `GlobalCompact`'s 64 KiB less as in standard mode. The 1000h more the
 * first block of FE0000h moveable costs, and keeps, is KERNEL growing its
 * descriptor table, which it does in enhanced mode alone as its free
 * selectors fall under 100h (`KRNL386.EXE` seg1 `1ed4`-`1f0d`), and is not
 * followed: WinBox's selectors are not KERNEL's.
 */

/** The largest size `0c7c` and `4025` let through: 16 MiB less 64 KiB. */
export const MOST = 0xff0000;

/** The most selectors `20a8` gives a block `GlobalReAlloc` moves (`40f9`). */
export const MOST_MOVED_SELECTORS = 0xfe;

/** `GetFreeSpace(0)` on the oracle's machine as a program starts (`galimit`). */
export const FREE = 0xebb4e0;

/** The largest block `GlobalAlloc` grants there (`galimit`). */
export const LARGEST = 0xe34000;

/** `GlobalCompact(0)` there: the largest block less 64 KiB (`galimit`). */
export const COMPACT = 0xe24000;

/** `GetFreeSpace(0)` on the same machine in 386 enhanced mode (`enhanced/galimit`). */
export const FREE_ENHANCED = 0x38f5c60;

/** The largest free block there, as DPMI 0500h names it (`enhanced/enhmode`). */
export const LARGEST_ENHANCED = 0x3868000;

/** `GlobalCompact(0)`'s figure there, before `3fde`: the largest block less 64 KiB. */
export const COMPACT_ENHANCED = LARGEST_ENHANCED - 0x10000;

/** The three figures for the machine's mode. */
function figures(system: any) {
  return system?.machine?.mode === 'enhanced'
    ? { free: FREE_ENHANCED, largest: LARGEST_ENHANCED, compact: COMPACT_ENHANCED }
    : { free: FREE, largest: LARGEST, compact: COMPACT };
}

/**
 * Whether a size passes `0c7c`: rounded up to 16 bytes without carrying past
 * 32 bits, no more than FF0000h.
 */
export function withinLimit(size: number) {
  const rounded = (size >>> 0) + 0xf;

  return rounded <= 0xffffffff && rounded - (rounded % 0x10) <= MOST;
}

/** A program has asked: what is held now stands for what Windows held then. */
export function settle(system: any) {
  system.allocator.baseline ??= system.allocator.held;
}

/** The bytes held since a program first asked. */
function taken(system: any) {
  const allocator = system.allocator;

  return allocator.baseline === undefined ? 0 : allocator.held - allocator.baseline;
}

/** `GetFreeSpace`'s answer. */
export function freeSpace(system: any) {
  return Math.max(0, figures(system).free - taken(system));
}

/** The largest block that can be given. */
export function largestBlock(system: any) {
  return Math.max(0, figures(system).largest - taken(system));
}

/**
 * `GlobalCompact`'s answer, which goes through `3fde` and so is never more
 * than FF0000h (`KRNL386.EXE` seg1 `1105`-`111d`).
 */
export function compactAnswer(system: any) {
  return Math.min(MOST, Math.max(0, figures(system).compact - taken(system)));
}

/**
 * A KERNEL export as a program calls it: settling the model first. What
 * winbox.js's own code calls is the function itself, which does not.
 */
export function asking<F extends (...args: any[]) => any>(fn: F): F {
  const asked = function (this: any, ...args: any[]) {
    settle(this);
    return fn.apply(this, args);
  };

  Object.defineProperty(asked, 'name', { value: fn.name });

  return asked as unknown as F;
}
