'use strict';

import { handleFor, indexFor, segmentSelector } from '../selectors.js';
import { liveTask, taskList } from '../kernel/task-order.js';
import { heapInformation, selectorOf } from './local.js';
import { moduleChain } from './modules.js';
import { moduleOfTask } from './tasks.js';
import { structure } from './structures.js';

/** `GLOBALINFO`'s and `GLOBALENTRY`'s sizes. */
const GLOBALINFO = 0x0a;
const GLOBALENTRY = 0x24;

/** `GLOBALENTRY.wType`s (`toolhelp.h`). */
const GT_UNKNOWN = 0;
const GT_DGROUP = 1;
const GT_CODE = 3;
export const GT_TASK = 4;
export const GT_MODULE = 6;
const GT_SENTINEL = 9;

/** `GLOBALENTRY.wFlags`: the block is a task's, its owner given as the task. */
export const GF_PDB_OWNER = 0x0100;

/** A data segment's flag in its arena, which TOOLHELP hands on (`thheap`). */
const DGROUP = 0x0004;

/** `GMEM_SHARE`: a block that is its task's module's, not the task's. */
const GMEM_SHARE = 0x2000;

/** `GlobalFirst`'s and `GlobalNext`'s walks. */
const GLOBAL_ALL = 0;

export interface GlobalBlock {
  index: number;
  handle: number;
  size: number;
  lock: number;
  pageLock: number;
  flags: number;
  owner: number;
  type: number;
  data: number;
}

/**
 * The blocks of global memory winbox.js has, as TOOLHELP sees Windows'
 * arenas (`TOOLHELP.DLL` seg1 `060f`-`06cc`, types `14f7`-`168d`), in the
 * order of their descriptors:
 *
 * * Each segment of a module loaded from its file, its owner the module:
 *   the data segment `GT_DGROUP` with the data flag, any other `GT_CODE`,
 *   each with its segment's number (seg1 `1617`-`1637`; a data segment
 *   that is not the module's own is found in its segment table too, and
 *   is called code).
 * * Each block from `GlobalAlloc`: a task's, given as the task with
 *   `GF_PDB_OWNER` -- Windows' owner is the task's prefix, which TOOLHELP
 *   turns into the task (seg1 `068e`-`06a6`, `17bd`) -- or, with
 *   `GMEM_SHARE`, its task's module's; `GT_UNKNOWN`. **Recorded** by
 *   `thheap`.
 *
 * * The data segment of each module winbox.js keeps, its owner the module,
 *   `GT_DGROUP` with no segment's number: winbox.js has no file's segment
 *   table for it.
 *
 * then each task (`GT_TASK`) and each module (`GT_MODULE`), which Windows
 * has in blocks of KERNEL's and winbox.js keeps itself; and the walk's two
 * ends, `GT_SENTINEL`, as Windows' arenas begin and end (`thheap`).
 */
export function globalBlocks(system: any): GlobalBlock[] {
  const blocks: GlobalBlock[] = [];
  const allocator = system.allocator;
  const locks: Map<number, number> = system._pageLocks ?? new Map();
  const block = (index: number, owner: number, type: number, data: number, flags: number) => ({
    index,
    handle: handleFor(index),
    size: allocator.sizeOf(index),
    lock: allocator.locksOf(index),
    pageLock: locks.get(index) ?? 0,
    flags,
    owner,
    type,
    data,
  });

  for (const module of Object.values(system.modules._modules ?? {}) as any[]) {
    const loader = module?.loader ?? (module?.segments ? module : null);
    const owner = loader ? (system.modules.handleFromPath(String(loader.path ?? '')) ?? 0) : 0;

    if (!loader || !owner) {
      continue;
    }

    loader.segments.forEach((_segment: any, at: number) => {
      const index = loader.translate(at + 1);
      const own = at + 1 === loader.ds;

      if (index) {
        blocks.push(block(index, owner, own ? GT_DGROUP : GT_CODE, at + 1, own ? DGROUP : 0));
      }
    });
  }

  /* A module winbox.js keeps: its data segment, which is its own. */
  for (const module of moduleChain(system)) {
    const data = system._moduleData?.[module.name];

    if (data && !system.modules.fromName(module.name)?.segments) {
      blocks.push(block(indexFor(data), module.handle, GT_DGROUP, 0, DGROUP));
    }
  }

  for (const [key, object] of Object.entries(allocator._objects ?? {}) as [string, any][]) {
    const index = Number(key);
    const task = object.owner ?? 0;
    const shared = (object.flags ?? 0) & GMEM_SHARE;
    const owner = shared
      ? liveTask(system, task)
        ? moduleOfTask(system, liveTask(system, task))
        : 0
      : task;

    blocks.push(block(index, owner, GT_UNKNOWN, 0, shared ? 0 : GF_PDB_OWNER));
  }

  blocks.sort((a, b) => a.index - b.index);

  for (const handle of taskList(system)) {
    blocks.push({ ...block(0, handle, GT_TASK, 0, 0), handle });
  }

  /* A module's database: its handle is its selector, the block's handle
   * one below (**recorded** by `thheap`). */
  for (const module of moduleChain(system)) {
    blocks.push({ ...block(indexFor(module.handle), module.handle, GT_MODULE, 0, 0), size: 0 });
  }

  return blocks;
}

/** One of the walk's ends: KERNEL's own arenas, owned by FFFFh (`14f7`). */
function sentinel(): GlobalBlock {
  return {
    index: 0,
    handle: 0,
    size: 0,
    lock: 0,
    pageLock: 0,
    flags: 0,
    owner: 0xffff,
    type: GT_SENTINEL,
    data: 0,
  };
}

/** The walk: its two ends and the blocks between. */
function walk(system: any) {
  return [sentinel(), ...globalBlocks(system), sentinel()];
}

/**
 * A `GLOBALENTRY` filled for a block, as `TOOLHELP.DLL` seg1 `060f` fills
 * it from its arena: its address -- its selector's base -- and size, its
 * handle, its lock counts, its flags, whether a local heap is in it (seg1
 * `07ec`), its owner, its type and datum, and the next in the walk, here
 * its place in the walk from 1 (`dwNext` and `dwNextAlt` both), nought
 * after the last.
 */
function fill(system: any, entry: any, found: GlobalBlock, next: number) {
  const core = system.machine.cpu.core;
  const selector = found.index ? segmentSelector(found.index) : 0;

  entry.write32(0x04, selector ? (core.peekDescriptor(selector)?.base ?? 0) : 0);
  entry.write32(0x08, found.size);
  entry.write16(0x0c, found.handle);
  entry.write16(0x0e, found.lock);
  entry.write16(0x10, found.pageLock);
  entry.write16(0x12, found.flags);
  entry.write16(0x14, selector && heapInformation(system, selector) ? 1 : 0);
  entry.write16(0x16, found.owner);
  entry.write16(0x18, found.type);
  entry.write16(0x1a, found.data);
  entry.write32(0x1c, next);
  entry.write32(0x20, next);
}

/**
 * How many blocks the walk has, how many are free and how many are in the
 * list of the least recently used (`TOOLHELP.DLL` seg1 `02a2`, from the
 * global heap's head, `0590`): winbox.js's blocks are given out whole and
 * kept in no such list, so nought of each of those.
 */
export function GlobalInfo(this: any, lpGlobalInfo: number) {
  const entry = structure(this, lpGlobalInfo, GLOBALINFO);

  if (!entry) {
    return 0;
  }

  entry.write16(4, walk(this).length);
  entry.write16(6, 0);
  entry.write16(8, 0);

  return 1;
}

/**
 * The walk's first block, filled in (`TOOLHELP.DLL` seg1 `0318`): for
 * `GLOBAL_ALL`, its first end. There are no free blocks nor blocks in the
 * list of the least recently used to walk: FALSE for `GLOBAL_FREE` and
 * `GLOBAL_LRU`.
 */
export function GlobalFirst(this: any, lpGlobal: number, wFlags: number) {
  const entry = structure(this, lpGlobal, GLOBALENTRY);

  if (!entry || (wFlags & 0xffff) !== GLOBAL_ALL) {
    return 0;
  }

  const list = walk(this);

  fill(this, entry, list[0], list.length > 1 ? 2 : 0);

  return 1;
}

/** The block after the one filled in, from its `dwNext` (seg1 `0399`); FALSE after the last. */
export function GlobalNext(this: any, lpGlobal: number, wFlags: number) {
  const entry = structure(this, lpGlobal, GLOBALENTRY);

  if (!entry || (wFlags & 0xffff) !== GLOBAL_ALL) {
    return 0;
  }

  const place = entry.read32(0x1c);
  const list = walk(this);

  if (!place || place > list.length) {
    return 0;
  }

  fill(this, entry, list[place - 1], place < list.length ? place + 1 : 0);

  return 1;
}

/** A block by its handle or selector, its place in the walk from 1; nought for none. */
function placeOf(list: GlobalBlock[], handle: number) {
  const index = indexFor(selectorOf(handle));
  const exact = list.findIndex(
    (each) =>
      (each.type === GT_TASK && each.handle === (handle & 0xffff)) ||
      (each.type === GT_MODULE && each.owner === (handle & 0xffff))
  );

  if (exact >= 0) {
    return exact + 1;
  }

  const found = list.findIndex((each) => each.index && each.index === index);

  return found >= 0 ? found + 1 : 0;
}

/**
 * A block's entry, by its handle or a selector of it (`TOOLHELP.DLL` seg1
 * `0417`, its arena found from the selector, `0848`): FALSE for one that
 * is no block. **Recorded** by `thheap`.
 */
export function GlobalEntryHandle(this: any, lpGlobal: number, hItem: number) {
  const entry = structure(this, lpGlobal, GLOBALENTRY);
  const list = walk(this);
  const place = entry ? placeOf(list, hItem) : 0;

  if (!place) {
    return 0;
  }

  fill(this, entry, list[place - 1], place < list.length ? place + 1 : 0);

  return 1;
}

/**
 * The block of a module's segment, by its number from 1, filled in
 * (`TOOLHELP.DLL` seg1 `04a9`-`0578`): the module's segment table's entry
 * for it. FALSE for a handle that is no module's, or a number it has no
 * segment of. **Recorded** by `thheap`.
 */
export function GlobalEntryModule(this: any, lpGlobal: number, hModule: number, wSeg: number) {
  const entry = structure(this, lpGlobal, GLOBALENTRY);
  const list = walk(this);
  const place =
    entry && wSeg
      ? list.findIndex(
          (each) =>
            each.owner === (hModule & 0xffff) &&
            (each.type === GT_CODE || each.type === GT_DGROUP) &&
            each.data === (wSeg & 0xffff)
        ) + 1
      : 0;

  if (!place) {
    return 0;
  }

  fill(this, entry, list[place - 1], place < list.length ? place + 1 : 0);

  return 1;
}
