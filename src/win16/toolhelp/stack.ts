'use strict';

import { liveTask } from '../kernel/task-order.js';
import { globalBlocks } from './global.js';
import { selectorOf } from './local.js';
import { structure } from './structures.js';

/** `STACKTRACEENTRY`'s size. */
const STACKTRACEENTRY = 0x14;

/** `STACKTRACEENTRY.wFlags`: a far frame, a near one. */
const FRAME_FAR = 0;
const FRAME_NEAR = 1;

/** `GT_CODE` and `GT_DGROUP`: a block that is a module's segment. */
const GT_DGROUP = 1;
const GT_CODE = 3;

/**
 * The module and segment number of a frame's code, as `TOOLHELP.DLL` seg1
 * `1012`-`10ab` finds them: the owner of the code segment's block, and
 * where its handle is in that module's segment table, from 1; left as they
 * were where CS is no module's segment.
 */
function placeCode(system: any, entry: any) {
  const cs = entry.read16(0x0a);

  if (!cs) {
    return;
  }

  const index = selectorOf(cs) >> 3;
  const block = globalBlocks(system).find(
    (each) => each.index === index && (each.type === GT_CODE || each.type === GT_DGROUP)
  );

  if (block) {
    entry.write16(0x0e, block.owner);
    entry.write16(0x10, block.data);
  }
}

/** The three words of a stack's segment that bound it: its top at 0Ah, its bottom at 0Eh. */
function bounds(system: any, ss: number) {
  const core = system.machine.cpu.core;

  return { top: core.read16(ss, 0x0a) & 0xffff, bottom: core.read16(ss, 0x0e) & 0xffff };
}

/**
 * The first frame of a task's stack (`TOOLHELP.DLL` seg1 `0f1c`, `10ac`-
 * `1135`): from the frame Windows' switch left at the task's SS:SP, its BP
 * (less its lowest bit), IP and CS at 10h, 12h and 14h. Here, where the
 * task gave the processor up: its BP, CS and IP then. FALSE for no task,
 * or a BP that is nought or not between the stack's top and its bottom.
 */
export function StackTraceFirst(this: any, lpst: number, hTask: number) {
  const entry = structure(this, lpst, STACKTRACEENTRY);
  const handle = hTask & 0xffff;
  const task = liveTask(this, handle);

  if (!entry || !task) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const running = handle === this.scheduler.active;
  const registers = running ? core : (task.context?.registers ?? task.context ?? {});
  const ss = (registers.ss ?? 0) & 0xffff;
  const bp = (registers.bp ?? 0) & 0xfffe;

  entry.write16(0x08, bp);
  entry.write16(0x0c, registers.ip ?? 0);
  entry.write16(0x0a, registers.cs ?? 0);
  entry.write16(0x04, handle);
  entry.write16(0x06, ss);
  entry.write16(0x12, FRAME_FAR);

  const { top, bottom } = bounds(this, ss);

  if (!bp || bp < top || bp >= bottom) {
    return 0;
  }

  placeCode(this, entry);

  return 1;
}

/**
 * A frame begun from given registers (`TOOLHELP.DLL` seg1 `0f67`-`0fc7`):
 * SS, CS, IP and BP as they are given, the running task's, and the
 * module and segment of the code. TRUE. **Recorded** by `thtask`.
 */
export function StackTraceCSIPFirst(
  this: any,
  lpst: number,
  wSS: number,
  wCS: number,
  wIP: number,
  wBP: number
) {
  const entry = structure(this, lpst, STACKTRACEENTRY);

  if (!entry) {
    return 0;
  }

  entry.write16(0x06, wSS);
  entry.write16(0x0a, wCS);
  entry.write16(0x0c, wIP);
  entry.write16(0x08, wBP);
  placeCode(this, entry);
  entry.write16(0x04, this.scheduler.active ?? 0);

  return 1;
}

/**
 * The frame the one filled in returns to (`TOOLHELP.DLL` seg1 `0fca`,
 * `1138`-`11cb`), from the words at its BP: the BP before, then IP and CS.
 * FALSE where the BP before is nought, not above this one, or not between
 * the stack's top and bottom. A BP with its lowest bit set marks a far
 * frame, the bit cleared; otherwise the frame is far where the word after
 * IP is a code selector of the program's privilege whose limit reaches IP,
 * and near, its CS the one before, where not. **Recorded** by `thtask`.
 */
export function StackTraceNext(this: any, lpst: number) {
  const entry = structure(this, lpst, STACKTRACEENTRY);

  if (!entry) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const ss = entry.read16(0x06);
  const bp = entry.read16(0x08);

  if (bp + 6 > 0xffff || !core.peekDescriptor(ss) || core.peekDescriptor(ss).limit < bp + 6) {
    return 0;
  }

  const before = core.read16(ss, bp) & 0xffff;
  const ip = core.read16(ss, bp + 2) & 0xffff;
  const cs = core.read16(ss, bp + 4) & 0xffff;
  const { top, bottom } = bounds(this, ss);

  if (!before || before <= bp || before < top || before >= bottom) {
    return 0;
  }

  let far = Boolean(before & 1);

  if (!far && (cs & 3) === 3) {
    const descriptor = core.peekDescriptor(cs);

    far = Boolean(descriptor?.executable && descriptor.limit > ip);
  }

  entry.write16(0x0c, ip);

  if (far) {
    entry.write16(0x0a, cs);
  }

  entry.write16(0x12, far ? FRAME_FAR : FRAME_NEAR);
  entry.write16(0x08, before & 0xfffe);
  placeCode(this, entry);

  return 1;
}
