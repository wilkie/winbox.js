'use strict';

import { clockOf } from '../../emulator/clock.js';
import { tickCount } from '../user/GetTickCount.js';
import { liveTask } from '../kernel/task-order.js';
import { structure } from './structures.js';

/** `TIMERINFO`'s size. */
const TIMERINFO = 0x0c;

/** The timer chip's counts a millisecond, as TOOLHELP divides by them: 4A9h. */
const COUNTS_PER_MS = 0x4a9;

/** The timer chip's rate, counts a second. */
const PIT_HZ = 1193180;

/** `TerminateApp`'s flag that has it return to its caller. */
const RETURN = 0x8000;

/**
 * The library's exit procedure (`TOOLHELP.DLL` seg1 `018a`-`01d3`): what it
 * registered let go, and TRUE.
 */
export function WEP(this: any, _nParameter: number) {
  return 1;
}

/**
 * The milliseconds since Windows started, both counts the same, where
 * TOOLHELP found no MMSYSTEM as it started (`TOOLHELP.DLL` seg1 `2dae`-
 * `2eb8`): `GetTickCount`, and the milliseconds since its last tick, from
 * the timer chip's count read through ports 43h and 40h, FFFFh less it
 * over 4A9h; asked again if that is less than the count answered last.
 * **Recorded** by `thtask`: the two equal, the count from `GetTickCount`
 * before up to a tick past it after. Here the chip's count is the time
 * since the tick, by the machine's clock.
 */
export function TimerCount(this: any, lpTimer: number) {
  const entry = structure(this, lpTimer, TIMERINFO);

  if (!entry) {
    return 0;
  }

  const now = clockOf(this).now();
  const ticks = tickCount(now);
  const counts = Math.min(0xffff, Math.floor((now - ticks) * (PIT_HZ / 1000)));
  let count = (ticks + Math.floor(counts / COUNTS_PER_MS)) >>> 0;

  if (count < (this._timerCount ?? 0)) {
    count = Math.max(count, tickCount(clockOf(this).now()));
  }

  this._timerCount = count;
  entry.write32(4, count);
  entry.write32(8, count);

  return 1;
}

/**
 * The memory manager's figures, from DPMI's function 0500h into the
 * structure from 4 -- with no check of `dwSize` -- and a page of 1000h
 * (`TOOLHELP.DLL` seg1 `13f4`-`14a7`). **Recorded** by `thtask`: TRUE, a
 * page of 1000h, `dwSize` as it was. What DOS's extender counts of the
 * machine's memory is the machine's; winbox.js's extender has no such
 * figures, and answers each as DPMI says one that is not known is
 * answered, FFFFFFFFh, as TOOLHELP fills the buffer before it asks.
 */
export function MemManInfo(this: any, lpInfo: number) {
  if (!lpInfo) {
    return 0;
  }

  const core = this.machine.cpu.core;
  const segment = (lpInfo >>> 16) & 0xffff;
  const offset = lpInfo & 0xffff;

  for (let at = 4; at < 0x28; at++) {
    core.write8(segment, (offset + at) & 0xffff, 0xff);
  }

  core.write16(segment, (offset + 0x28) & 0xffff, 0x1000);

  return 1;
}

/**
 * A task ended (`TOOLHELP.DLL` seg1 `26ea`-`27a0`): nought for the running
 * task. Another is switched to, to end itself; `NO_UAE_BOX` marks it to be
 * ended with no Application Error box (TDB 18h's bit 2), `FatalAppExit` is
 * called, and unless `wFlags` has bit 15 the task's signal procedure is
 * told and it ends through DOS, `INT 21h` 4CFFh, its code FFh. **Recorded**
 * by `thtask`: a program of the probe's own ended with `NO_UAE_BOX` is no
 * task after, and its window is gone. winbox.js ends the task as DOS's
 * function 4Ch ends one, with code FFh, its windows taken away with it, and
 * shows no box.
 */
export function TerminateApp(this: any, hTask: number, wFlags: number) {
  const handle = hTask & 0xffff || (this.scheduler.active ?? 0);

  if (!liveTask(this, handle) || wFlags & RETURN) {
    return;
  }

  this.exitTask(0xff, handle);
}
