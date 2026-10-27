'use strict';

import { FIRST_MEGABYTE } from '../global-allocator.js';
import { indexFor, segmentSelector } from '../selectors.js';
import { dosCall } from './FileCdr.js';
import { GlobalAlloc } from './GlobalAlloc.js';
import { GlobalHandle } from './GlobalHandle.js';
import { withinLimit } from './memory-model.js';
import { pathDirectories } from './search.js';
import { taskRecord } from './task-order.js';

/**
 * KERNEL's documented small calls that wave one left: the error mode's
 * byte, a far pointer moved on, NetBIOS, a task's handle table, memory in
 * the first megabyte, a procedure called through an instance, a stack of
 * the program's own, and files opened and deleted along PATH. Each is
 * **read out** of `KRNL386.EXE` and **recorded** by `kmore`. As the Rust
 * engine's `kernel_calls/more.rs`.
 */

/**
 * The byte at 32Ah of KERNEL's data, as a far pointer (`KRNL386.EXE` seg1
 * `0bc5`-`0bcd`): KERNEL's data segment's selector in DX, 32Ah in AX. The
 * byte is one while KERNEL makes a DOS call for a program (seg1 `1d00`,
 * `1d39`), so that a critical error in it is the program's, and nought
 * otherwise. **Recorded** by `kmore`: KERNEL's selector, 32Ah, nought.
 */
export function GetLPErrMode(this: any) {
  const data = this._moduleData?.KERNEL ?? 0;

  return ((data << 16) | 0x32a) >>> 0;
}

/** A descriptor's eight bytes, through the local table. */
function descriptorBytes(system: any, selector: number) {
  const core = system.machine.cpu.core;
  const memory = system.machine.memory;
  const entry = core.ldtBase + (selector >> 3) * 8;

  return Array.from({ length: 8 }, (_, at) => memory.read8(entry + at));
}

/** A descriptor's eight bytes written, as KERNEL writes them straight into the table (seg1 `2b66`). */
function writeDescriptor(system: any, selector: number, bytes: number[]) {
  const core = system.machine.cpu.core;
  const memory = system.machine.memory;
  const entry = core.ldtBase + (selector >> 3) * 8;

  bytes.forEach((byte, at) => memory.write8(entry + at, byte & 0xff));

  if (core._translationCache) {
    for (let rpl = 0; rpl < 8; rpl++) {
      core._translationCache[(selector & ~7) | rpl] = undefined;
    }
  }
}

/**
 * A far pointer moved on by a number of bytes: its selector's base moved
 * instead, by the offset's paragraphs and the number, and the offset left
 * its last four bits (`KRNL386.EXE` seg1 `26b9`-`2722`). A number of 16 MiB
 * or more is refused, nought. A selector that reaches past 64 KiB is the
 * first of a block's: each of its selectors is moved, the next a 64 KiB on
 * from the one before and reaching 64 KiB less, written from the first's
 * descriptor (`2223`-`2251`). **Recorded** by `kmore`: 1234h and 10h move
 * the base 1240h and answer 4; a block of 20000h moves both selectors.
 */
export function LongPtrAdd(this: any, dwLongPtr: number, dwAdd: number) {
  const selector = (dwLongPtr >>> 16) & 0xffff;
  const offset = dwLongPtr & 0xffff;
  const bytes = descriptorBytes(this, selector);
  let base =
    (bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[7] << 24)) + (offset & 0xfff0);

  if ((dwAdd >>> 16) & 0xff00) {
    return 0;
  }

  base = (base + (dwAdd >>> 0)) >>> 0;

  /* LSL: the selectors the limit reaches, one a 64 KiB; one where it
   * answers nothing. */
  const descriptor = this.machine.cpu.core.peekDescriptor(selector);
  const count = descriptor ? (((descriptor.limit >>> 0) >>> 16) & 0xffff) + 1 : 1;

  bytes[2] = base & 0xff;
  bytes[3] = (base >>> 8) & 0xff;
  bytes[4] = (base >>> 16) & 0xff;
  bytes[7] = (base >>> 24) & 0xff;

  for (let tile = 0; tile < count; tile++) {
    writeDescriptor(this, (selector & ~7) + tile * 8, bytes);

    /* The next 64 KiB on, carried into the top byte. */
    const carried = bytes[4] + 1;

    bytes[4] = carried & 0xff;
    bytes[7] = (bytes[7] + (carried >> 8)) & 0xff;

    /* 64 KiB less: sixteen pages of a page-granular limit, else a step of
     * its top four bits, borrowing from the flags as DEC does. */
    if (bytes[6] & 0x80) {
      const low = (bytes[0] | (bytes[1] << 8)) - 0x10;

      bytes[0] = low & 0xff;
      bytes[1] = (low >> 8) & 0xff;
      bytes[6] = (bytes[6] - (low < 0 ? 1 : 0)) & 0xff;
    } else {
      bytes[6] = (bytes[6] - 1) & 0xff;
    }
  }

  return (((selector & 0xffff) << 16) | (offset & 0xf)) >>> 0;
}

/**
 * `PUSH DS; INT 5Ch; POP DS; RETF` (`KRNL386.EXE` seg1 `9e19`-`9e1d`): the
 * registers go to NetBIOS's interrupt as they are, and come back as it
 * leaves them. There is no network, and the interrupt's vector is DOSBox's
 * bare `IRET`. **Recorded** by `kmore`: AX, BX, CX, DX and ES as they were
 * given, the carry clear, the control block untouched.
 */
export function NetBIOSCall(this: any) {
  this.machine.cpu.core.flags.carry = false;
}

/**
 * A table of handles in the task's data segment, which KERNEL kept up to
 * date as segments moved in real mode (`KRNL386.EXE` seg3 `03ce`-`0417`):
 * nought where DS is no block of the global heap. Its offset and DS are
 * kept in the task's database (TDB 5Ch, 5Eh), and the word at 23Eh of
 * KERNEL's data counts the tables made; the table's count of entries is its
 * first word, and that many words and one more after it are cleared. AX is
 * one, or, for nought, DS's selector as `GlobalHandle`'s own call left it.
 * **Recorded** by `kmore`: a table of three, four words cleared, one; then
 * nought, DS.
 */
export function DefineHandleTable(this: any, wOffset: number) {
  const core = this.machine.cpu.core;
  const ds = core.ds & 0xffff;

  if (!GlobalHandle.call(this, ds)) {
    return 0;
  }

  const record = taskRecord(this, this.scheduler?.active ?? 0);
  const offset = wOffset & 0xffff;

  if (record) {
    record.handleTable = offset ? [offset, ds] : [0, 0];
  }

  this._handleTables = ((this._handleTables ?? 0) + (offset ? 1 : -1)) & 0xffff;

  if (!offset) {
    return ds;
  }

  const count = core.read16(ds, offset);

  for (let at = 0; at <= count; at++) {
    core.write16(ds, (offset + 2 + at * 2) & 0xffff, 0);
  }

  return 1;
}

/**
 * Where `GlobalDosAlloc` gives memory in the first megabyte, by paragraph:
 * from 16D2h, the first block's on Windows as the `kmore` probe found it,
 * to the top of conventional memory, A000h. Blocks are given lowest first,
 * one after another (**recorded**: 20h bytes after 100h are 10h paragraphs
 * on, and the first freed is given again). Windows' own blocks in its low
 * memory between are not kept here: there, a block of 64 KiB went past
 * them, to 3BFEh, and no more than 1400h bytes fitted below that, at 1896h.
 */
export const DOS_FIRST = 0x16d2;
export const DOS_END = 0xa000;

/** The blocks given, by their descriptor index: [paragraph, paragraphs]. */
function dosBlocks(system: any): Map<number, [number, number]> {
  return (system._dosBlocks ??= new Map<number, [number, number]>());
}

/** The lowest paragraph `paragraphs` fit at, or -1. */
function dosPlace(system: any, paragraphs: number) {
  const taken = [...dosBlocks(system).values()].sort((a, b) => a[0] - b[0]);
  let at = DOS_FIRST;

  for (const [start, length] of taken) {
    if (start - at >= paragraphs) {
      return at;
    }

    at = Math.max(at, start + length);
  }

  return DOS_END - at >= paragraphs ? at : -1;
}

/**
 * Memory in the first megabyte, which DOS and real-mode code can reach:
 * `GlobalAlloc` with KERNEL's own flag 8000h (`KRNL386.EXE` seg1
 * `139a`-`13d1`), a fixed block whose handle is its selector, the selector
 * in AX and its base's paragraph in DX (`2261`, shifted four). Nought where
 * it does not fit. **Recorded** by `kmore`: the base the segment's, below
 * the megabyte, `GlobalSize` the size asked, `GlobalFlags` nought,
 * `GlobalHandle` the selector, the limit the size less one; 100000h refused.
 */
export function GlobalDosAlloc(this: any, dwBytes: number) {
  const size = dwBytes >>> 0;

  /* `GlobalAlloc`'s own limit (`0c7c`; see `memory-model.ts`), and nought
   * refused: `4025` gives a block of nought only where it is moveable
   * (`40ab`), and this one is fixed. **Recorded** by `galimit`: nought,
   * 100000h and more answered nought. */
  if (size === 0 || !withinLimit(size)) {
    return 0;
  }

  const rounded = size === 0 ? 0 : (size + 0x1f) & ~0x1f;
  const paragraphs = rounded >>> 4;
  const paragraph = dosPlace(this, paragraphs);

  if (paragraph < 0) {
    return 0;
  }

  const handle = GlobalAlloc.call(this, 0, size);

  if (!handle) {
    return 0;
  }

  const index = indexFor(handle);
  const object = this.allocator._objects[index];

  for (let tile = 0; tile < (object?.selectors ?? 1); tile++) {
    this.allocator.globalAllocator.setBase(
      index + tile,
      (FIRST_MEGABYTE + paragraph * 16 + tile * 0x10000) >>> 0
    );
  }

  object.dos = paragraph;
  dosBlocks(this).set(index, [paragraph, paragraphs]);

  return ((paragraph << 16) | segmentSelector(index)) >>> 0;
}

/**
 * A block `GlobalDosAlloc` gave, freed: `GlobalFree`'s own call (seg1
 * `13d4`-`13e6`, `0de5`), nought. **Recorded** by `kmore`: nought, and
 * nought again for the selector freed.
 */
export function GlobalDosFree(this: any, uSelector: number) {
  const index = indexFor(uSelector);

  dosBlocks(this).delete(index);
  this.allocator.free(index);

  return 0;
}

/**
 * A procedure called through an instance, as a `MakeProcInstance` thunk
 * calls it: ES:BX the instance's word and the procedure's address after it
 * (`KRNL386.EXE` seg1 `4927`-`4938`). AX is the instance's selector -- the
 * word itself where it is odd, one more where it is a handle -- or DS for
 * nought; DS is left; and the procedure is jumped to, so that it returns to
 * the caller. **Recorded** by `kmore`: nought, DS; 1234h and 1235h, 1235h;
 * DS as it was.
 */
export function CallProcInstance(this: any) {
  const core = this.machine.cpu.core;
  const es = core.es & 0xffff;
  const bx = core.bx & 0xffff;
  const instance = core.read16(es, bx);
  const offset = core.read16(es, (bx + 2) & 0xffff);
  const segment = core.read16(es, (bx + 4) & 0xffff);
  const sp = (core.sp - 4) & 0xffff;

  core.ax = instance === 0 ? core.ds & 0xffff : instance & 1 ? instance : (instance + 1) & 0xffff;

  /* The procedure's address on top of the caller's: the `RETF` jumps to
   * it, and its own `RETF` comes back to the caller. */
  core.write16(core.ss, sp, offset);
  core.write16(core.ss, (sp + 2) & 0xffff, segment);
  core.sp = sp;
}

/**
 * The stack moved into a segment of the program's own (`KRNL386.EXE` seg1
 * `11c6`-`123b`): its arguments and return address taken off; the old BP
 * pushed on the old stack; in the new segment's header the old SP (2) and
 * SS (4), the top given (0Ah) and the pointer given as both its least and
 * its bottom (0Ch, 0Eh); SS:SP and BP the pointer; a nought pushed, then
 * the words of the caller's frame from BP-4 down to SP copied, so that the
 * caller's locals are where BP finds them, all but BP-2. The task's
 * database's SS:SP (TDB 4, 2) the new. AX nought, BX the pointer, CX
 * nought, DX the segment. **Recorded** by `kmore`.
 */
export function SwitchStackTo(this: any) {
  const core = this.machine.cpu.core;
  const ss = core.ss & 0xffff;
  const sp = core.sp & 0xffff;
  const read = (at: number) => core.read16(ss, at & 0xffff);
  const ip = read(sp);
  const cs = read(sp + 2);
  const top = read(sp + 4);
  const pointer = read(sp + 6);
  const segment = read(sp + 8);
  const bp = core.bp & 0xffff;
  let oldSp = (sp + 10) & 0xffff;
  let from = (bp - 2) & 0xffff;
  let count = ((from - oldSp) & 0xffff) >> 1;

  oldSp = (oldSp - 2) & 0xffff;
  core.write16(ss, oldSp, bp);

  core.write16(segment, 2, oldSp);
  core.write16(segment, 4, ss);
  core.write16(segment, 0xa, top);
  core.write16(segment, 0xc, pointer);
  core.write16(segment, 0xe, pointer);

  let newSp = (pointer - 2) & 0xffff;

  core.write16(segment, newSp, 0);

  for (; count > 0; count--) {
    from = (from - 2) & 0xffff;
    newSp = (newSp - 2) & 0xffff;
    core.write16(segment, newSp, read(from));
  }

  newSp = (newSp - 4) & 0xffff;
  core.write16(segment, newSp, ip);
  core.write16(segment, (newSp + 2) & 0xffff, cs);

  core.ss = segment;
  core.sp = newSp;
  core.bp = pointer;
  core.ax = 0;
  core.bx = pointer;
  core.cx = 0;
  core.dx = segment;
}

/**
 * Back to the stack `SwitchStackTo` left (`KRNL386.EXE` seg1
 * `123c`-`127d`): SS:SP from the words at 4 and 2 of the stack's segment,
 * which are cleared; the task's database's SS:SP the old; BP popped from
 * it; AX left. BX the old SS and CX the old SP. **Recorded** by `kmore`.
 */
export function SwitchStackBack(this: any) {
  const core = this.machine.cpu.core;
  const ss = core.ss & 0xffff;
  const sp = core.sp & 0xffff;
  const ip = core.read16(ss, sp);
  const cs = core.read16(ss, (sp + 2) & 0xffff);
  const oldSs = core.read16(ss, 4);
  const oldSp = core.read16(ss, 2);

  core.write16(ss, 4, 0);
  core.write16(ss, 2, 0);

  core.ss = oldSs;

  const bp = core.read16(oldSs, oldSp);
  const newSp = (oldSp + 2 - 4) & 0xffff;

  core.write16(oldSs, newSp, ip);
  core.write16(oldSs, (newSp + 2) & 0xffff, cs);
  core.sp = newSp;
  core.bp = bp;
  core.bx = oldSs;
  core.cx = oldSp;
}

/**
 * Where a path's name begins: past its last `\`, `/` or `:` (`KRNL386.EXE`
 * seg1 `5a0e`).
 */
function nameOf(path: string) {
  let at = 0;

  for (let k = 0; k < path.length; k++) {
    if (path[k] === '\\' || path[k] === '/' || path[k] === ':') {
      at = k + 1;
    }
  }

  return path.slice(at);
}

/** A DOS call of `ax` on the string at DS:DX: the carry, AX after. */
async function dosOn(system: any, ax: number, selector: number, offset: number) {
  const core = system.machine.cpu.core;

  core.ax = ax;
  core.cx = 0;
  core.ds = selector;
  core.dx = offset;
  await dosCall(system);

  return { carry: !!core.flags.carry, ax: core.ax & 0xffff };
}

/**
 * A file opened, or deleted, as named, or else through PATH
 * (`KRNL386.EXE` seg3 `04be`-`0505`): the DOS call `wMode` names -- a mode
 * with no function is an open, 3Dh -- on the path; failing, the same on its
 * name in each of PATH's directories, KERNEL's search (seg1 `588e`) with
 * the name past its directory (`5a0e`), a backslash between. What DOS
 * answered, or FFFFh where none had it. KERNEL first asks the file's
 * attributes where the byte at 282h of its data is set, which NetWare's
 * DCh call sets and DOSBox's leaves nought. The path is built in KERNEL's
 * frame, 80h bytes under the return address. DS is left as it was.
 * **Recorded** by `kmore`: the probe's file and WIN.INI, in Windows'
 * directory, opened; a name that is nowhere FFFFh; a delete DOS's 4100h,
 * then FFFFh.
 */
export async function OpenPathName(this: any, lpPathName: number, wMode: number) {
  const core = this.machine.cpu.core;
  const ds = core.ds;
  let ax = wMode & 0xffff;

  if (!(ax & 0xff00)) {
    ax |= 0x3d00;
  }

  const selector = (lpPathName >>> 16) & 0xffff;
  const offset = lpPathName & 0xffff;
  let answer = await dosOn(this, ax, selector, offset);

  if (answer.carry) {
    const name = this.machine.memory.readCString(core.translateAddress(selector, offset));
    const buffer = (core.sp - 2 - 0x80) & 0xffff;
    let found = false;

    for (const directory of pathDirectories(this)) {
      const place = directory.endsWith('\\') ? directory : `${directory}\\`;
      const path = `${place}${nameOf(name)}`.slice(0, 0x7f);

      for (let k = 0; k < path.length; k++) {
        core.write8(core.ss, (buffer + k) & 0xffff, path.charCodeAt(k));
      }

      core.write8(core.ss, (buffer + path.length) & 0xffff, 0);
      answer = await dosOn(this, ax, core.ss, buffer);

      if (!answer.carry) {
        found = true;
        break;
      }
    }

    if (!found) {
      answer = { carry: true, ax: 0xffff };
    }
  }

  core.ds = ds;

  return answer.ax;
}

/** `OpenPathName` with DOS's delete, 4100h (seg3 `04b6`-`04bd`). */
export async function DeletePathName(this: any, lpPathName: number) {
  return OpenPathName.call(this, lpPathName, 0x4100);
}

/**
 * Every block an owner has freed (`KRNL386.EXE` seg1 `0e39`-`0e87`): the
 * owner a task's prefix, nought for the running task's (`0c62`); each block
 * of the global heap it owns told to a debugger and freed (`458d`). Blocks
 * made with `GMEM_SHARE` are the module's, and stay. **Recorded** by
 * `gfreeal`: a program's moveable and fixed blocks freed, its shared one
 * left, FFFFh answered.
 */
export function GlobalFreeAll(this: any, wOwner: number) {
  const owner = wOwner & 0xffff;
  const tasks = this.scheduler?._tasks ?? {};
  const task = owner
    ? Number(
        Object.keys(tasks).find(
          (handle) =>
            tasks[handle]?.programSegment !== undefined &&
            segmentSelector(tasks[handle].programSegment) === owner
        ) ?? 0
      )
    : (this.scheduler?.active ?? 0);

  for (const [key, object] of Object.entries(this.allocator._objects ?? {}) as [string, any][]) {
    if (task && object.owner === task && !((object.flags ?? 0) & 0x2000)) {
      dosBlocks(this).delete(Number(key));
      this.allocator.free(Number(key));
    }
  }

  return 0xffff;
}
