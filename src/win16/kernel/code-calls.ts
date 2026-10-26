'use strict';

import { indexFor } from '../selectors.js';
import { globalBlocks } from '../toolhelp/global.js';
import { moduleChain } from '../toolhelp/modules.js';
import { taskRecord } from './task-order.js';
import { GetModuleHandle } from './GetModuleHandle.js';
import { GetProcAddress } from './GetProcAddress.js';

/** `GT_CODE` and `GT_DGROUP`: a block that is a module's segment. */
const GT_DGROUP = 1;
const GT_CODE = 3;

/**
 * A procedure's address, through a thunk `MakeProcInstance` made to the
 * procedure it jumps to: `MOV AX, n` and `JMP FAR` (`KRNL386.EXE` seg1
 * `4865`-`4883`).
 */
function throughThunk(system: any, far: number) {
  const core = system.machine.cpu.core;
  const segment = (far >>> 16) & 0xffff;
  const offset = far & 0xffff;

  if (
    core.peekDescriptor(segment) &&
    (core.read8(segment, offset) & 0xff) === 0xb8 &&
    (core.read8(segment, (offset + 3) & 0xffff) & 0xff) === 0xea
  ) {
    return (
      ((core.read16(segment, (offset + 6) & 0xffff) << 16) |
        core.read16(segment, (offset + 4) & 0xffff)) >>>
      0
    );
  }

  return far >>> 0;
}

/**
 * The module segment a procedure's address is in, or the one a module's
 * handle and a segment number name (`KRNL386.EXE` seg1 `483e`-`48b2`): its
 * block, or none.
 */
function segmentOf(system: any, lpProc: number) {
  const far = throughThunk(system, lpProc);
  const selector = (far >>> 16) & 0xffff;
  const blocks = globalBlocks(system).filter(
    (each) => each.type === GT_CODE || each.type === GT_DGROUP
  );

  if (moduleChain(system).some((module) => module.handle === selector)) {
    return blocks.find((each) => each.owner === selector && each.data === (far & 0xffff)) ?? null;
  }

  return blocks.find((each) => each.index && each.index === indexFor(selector)) ?? null;
}

/**
 * The handle of the code segment a procedure is in, in AX, and its
 * selector in DX, the segment loaded (`KRNL386.EXE` seg1 `48fa`-`4924`).
 * **Recorded** by `ktask2`: for a procedure of the probe's and for its
 * instance thunk alike. Nought for an address in no module's segment.
 */
export function GetCodeHandle(this: any, lpfnCode: number) {
  const block = segmentOf(this, lpfnCode);

  return block ? (((block.handle | 1) << 16) | block.handle) >>> 0 : 0;
}

/** A loaded module's loader, from its handle, as `globalBlocks` finds it. */
function loaderOf(system: any, handle: number) {
  for (const module of Object.values(system.modules._modules ?? {}) as any[]) {
    const loader = module?.loader ?? (module?.segments ? module : null);

    if (loader && system.modules.handleFromPath(String(loader.path ?? '')) === handle) {
      return loader;
    }
  }

  return null;
}

/**
 * A segment's entry in its module's table, copied (`KRNL386.EXE` seg1
 * `48bd`-`48f7`): where it is in the file, in sectors; its size there; its
 * flags; the memory it is given -- for the module's data segment, its
 * heap's and stack's more; its handle; and the file's sector shift. AX the
 * shift, or the heap and stack for the data segment. **Recorded** by
 * `ktask2`. The flags are the file's: KERNEL keeps bits of its own in its
 * copy, which the probe does not record.
 */
export function GetCodeInfo(this: any, lpProc: number, lpSegInfo: number) {
  const block = segmentOf(this, lpProc);
  const loader = block ? loaderOf(this, block.owner) : null;
  const segment = loader?.segments?.[block!.data - 1];

  if (!block || !segment) {
    return 0;
  }

  const header = loader.executable.neHeader;
  const shift = loader.header.pageSize || 9;
  const own = block.data === loader.ds;
  const extra = own ? (header.initialLocalHeapSize + header.initialStackSize) & 0xffff : 0;
  const core = this.machine.cpu.core;
  const target = (lpSegInfo >>> 16) & 0xffff;
  const at = (delta: number) => ((lpSegInfo & 0xffff) + delta) & 0xffff;

  core.write16(target, at(0), segment.offset >>> shift);
  core.write16(target, at(2), segment.length & 0xffff);
  core.write16(target, at(4), segment.flags ?? 0);
  core.write16(target, at(6), (segment.minAllocation + extra) & 0xffff);
  core.write16(target, at(8), block.handle);
  core.write16(target, at(10), shift);

  return own ? extra : shift;
}

/** A module's data segment's selector, where it has a local heap. */
function dataOf(system: any, hModule: number) {
  const block = globalBlocks(system).find(
    (each) => each.type === GT_DGROUP && each.owner === (hModule & 0xffff)
  );

  return block?.index ? (block.handle | 1) & 0xffff : 0;
}

/**
 * The room in a module's local heap (`KRNL386.EXE` seg2 `1e4d`-`1e98`): in
 * AX the free bytes `LocalCountFree` counts there, and what its segment
 * could grow by, 64 KiB less its size; in DX the bytes from its heap's
 * information to the end of 64 KiB. **Recorded** by `ktask2`.
 */
export function GetHeapSpaces(this: any, hModule: number) {
  const selector = dataOf(this, hModule);

  if (!selector) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const word = (at: number) => core.read16(selector, at & 0xffff) & 0xffff;
  const info = word(6);
  let free = 0;

  /* `LocalCountFree` (seg2 `29c9`-`2a00`): the free list from the first
   * arena's next to the last, each one's size less its ten bytes. */
  if (word(info + 0x28) === 0x484c) {
    const last = word(info + 0x0a);

    for (let arena = word(word(info + 6) + 8), count = 0; arena !== last && count < 0x8000; count++) {
      free = (free + word(arena + 4) - 0x0a) & 0xffff;
      arena = word(arena + 8);
    }
  }

  const size = this.allocator.sizeOf(indexFor(selector)) & 0xffff;
  const low = (free - size) & 0xffff;
  const high = (0xffff - info) & 0xffff;

  return ((high << 16) | low) >>> 0;
}

/**
 * The drive whose disk was last changed, which KERNEL keeps at 27Eh of
 * its data and gives back once, nought after (`KRNL386.EXE` seg1
 * `5c17`-`5c24`). **Recorded** by `ktask2`: nought.
 */
export function GetLastDiskChange(this: any) {
  return 0;
}

/**
 * Nought in DX and AX where KERNEL keeps no swap figures (bit 4 of the
 * byte at 327h of its data clear: `KRNL386.EXE` seg1 `2ea7`-`2edb`).
 * **Recorded** by `ktask2`: nought.
 */
export function MemoryFreed(this: any) {
  return 0;
}

/**
 * The task's procedure KERNEL signals as it ends, given; the one it had
 * (TDB 2Ah, `KRNL386.EXE` seg1 `7dc5`-`7de0`). **Recorded** by `ktask2`:
 * the probe has one already, and the procedure given comes back. USER
 * gives each task its own, `SignalProc` (ordinal 314) [[inferred]];
 * winbox.js answers that export's address for a task given none.
 */
export function SetTaskSignalProc(this: any, hTask: number, lpfn: number) {
  const handle = hTask & 0xffff || (this.scheduler.active ?? 0);
  const record = taskRecord(this, handle);

  if (!record) {
    return 0;
  }

  const user = GetModuleHandle.call(this, 'USER') & 0xffff;
  const before = record.signal ?? GetProcAddress.call(this, user, 'SignalProc');

  record.signal = lpfn >>> 0;

  return before >>> 0;
}

/**
 * A block moved in the list of the least recently used: its handle, or
 * nought for a handle that is no block (`KRNL386.EXE` seg1 `0324`-`0349`,
 * `11b0`, `11bb`). winbox.js keeps no such list. **Recorded** by `ktask2`.
 */
export function GlobalLRU(this: any, hglb: number) {
  const index = indexFor(hglb & 0xffff);
  const known = index && (this.allocator._objects?.[index] || this.allocator.sizeOf(index));

  return known ? hglb & 0xffff : 0;
}

/**
 * The room for code to be swapped through, given in paragraphs; in AX the
 * room it now has, in DX its most (`KRNL386.EXE` seg1 `2ede`-`2f25`): the
 * given clipped to the most, the word at 24Fh of KERNEL's data, and, unless
 * nought, made the room if the segment it is kept in grows to it.
 * **Recorded** by `ktask2`: nought given, nought in AX and FFFFh in DX.
 * winbox.js swaps no code, and keeps the room given as had.
 */
export function SetSwapAreaSize(this: any, rsSize: number) {
  const most = 0xffff;
  // Clipped to the most, which is all a word holds.
  const given = rsSize & 0xffff;

  if (given) {
    this._swapArea = given;
  }

  return ((most << 16) | (this._swapArea ?? 0)) >>> 0;
}
