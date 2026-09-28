'use strict';

/**
 * KERNEL's pointer checks. They look at no tables: each loads the pointer
 * and touches the memory -- reads or writes the last byte of the range, the
 * last of each 64 KiB tile too for the huge forms, or scans a string for its
 * nought -- and answers 1 when that faults, KERNEL's fault handler going on
 * from where each expects one (`KRNL386.EXE` seg1 `4b62` to `4c70`). Here
 * the same accesses are asked of the descriptors, as the processor would
 * check them, and nothing is touched.
 *
 * **Recorded** by `badptr`, under DOSBox, whose processor does not fault
 * on the null selector, past a segment's limit, or on a write to code:
 * there it answers 0 where a real processor faults and KERNEL answers 1.
 * winbox.js follows the processor, and those records are known gaps.
 */

/** Whether loading the selector into ES would fault: not for the null selector. */
function loads(core: any, selector: number) {
  if ((selector & 0xfffc) === 0) {
    return true;
  }

  const descriptor = core.peekDescriptor(selector);

  return (
    !!descriptor &&
    descriptor.type &&
    (!descriptor.executable || descriptor.readWrite) &&
    descriptor.present
  );
}

/** Whether a byte can be read -- or written -- through the selector at the offset. */
function reaches(core: any, selector: number, offset: number, write = false) {
  if ((selector & 0xfffc) === 0 || !loads(core, selector)) {
    return false;
  }

  const descriptor = core.peekDescriptor(selector);

  if (write && (descriptor.executable || !descriptor.readWrite)) {
    return false;
  }

  offset &= 0xffff;

  return offset >= descriptor.lowLimit && offset + 1 <= descriptor.pastLimit;
}

/** `IsBadReadPtr` and `IsBadWritePtr`: the range's last byte. */
function badRange(core: any, pointer: number, count: number, write: boolean) {
  const selector = (pointer >>> 16) & 0xffff;
  const offset = pointer & 0xffff;

  if (!loads(core, selector)) {
    return 1;
  }

  if (!count) {
    return 0;
  }

  const last = offset + count - 1;

  return last > 0xffff || !reaches(core, selector, last, write) ? 1 : 0;
}

/** The huge forms: the last byte of each 64 KiB tile the range crosses, the selector stepping by 8, and the range's last. */
function badHuge(core: any, pointer: number, count: number, write: boolean) {
  let selector = (pointer >>> 16) & 0xffff;
  const offset = pointer & 0xffff;

  if (!loads(core, selector)) {
    return 1;
  }

  if (!count) {
    return 0;
  }

  const last = offset + (count >>> 0) - 1;

  if (last > 0xffffffff) {
    return 1;
  }

  for (let tile = Math.floor(last / 0x10000); tile > 0; tile--) {
    if (!reaches(core, selector, 0xffff, write)) {
      return 1;
    }

    selector = (selector + 8) & 0xffff;

    if (!loads(core, selector)) {
      return 1;
    }
  }

  return reaches(core, selector, last & 0xffff, write) ? 0 : 1;
}

export function IsBadReadPtr(this: any, lp: number, cb: number) {
  return badRange(this.machine.cpu.core, lp, cb, false);
}

export function IsBadWritePtr(this: any, lp: number, cb: number) {
  return badRange(this.machine.cpu.core, lp, cb, true);
}

export function IsBadHugeReadPtr(this: any, lp: number, cb: number) {
  return badHuge(this.machine.cpu.core, lp, cb, false);
}

export function IsBadHugeWritePtr(this: any, lp: number, cb: number) {
  return badHuge(this.machine.cpu.core, lp, cb, true);
}

/** A code segment's (`LAR`, then its type), loaded and read at the offset. */
export function IsBadCodePtr(this: any, lpfn: number) {
  const core = this.machine.cpu.core;
  const selector = (lpfn >>> 16) & 0xffff;
  const descriptor = core.peekDescriptor(selector);

  if (!descriptor || !descriptor.type || !descriptor.executable) {
    return 1;
  }

  return reaches(core, selector, lpfn & 0xffff) ? 0 : 1;
}

/**
 * A string whose nought is in reach: scanned from its start, faulting where
 * a byte cannot be read, and answering 1 too when the string and its nought
 * are longer than `cchMax`.
 */
export function IsBadStringPtr(this: any, lpsz: number, cchMax: number) {
  const core = this.machine.cpu.core;
  const selector = (lpsz >>> 16) & 0xffff;
  const offset = lpsz & 0xffff;

  if (!loads(core, selector)) {
    return 1;
  }

  for (let length = 1; length <= 0xffff; length++) {
    const at = (offset + length - 1) & 0xffff;

    if (!reaches(core, selector, at)) {
      return 1;
    }

    if (core.read8(selector, at) === 0) {
      return length > (cchMax & 0xffff) ? 1 : 0;
    }
  }

  return 1;
}
