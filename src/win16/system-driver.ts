'use strict';

/** @namespace SystemDriver */

import { clockOf } from '../emulator/clock.js';
import { driveInquiry } from './kernel/GetDriveType.js';
import { Module } from './module.js';
import { DWORD, FARPTR, UINT } from './types.js';
import { tickCount } from './user/GetTickCount.js';
import { fpuOf } from './win87em/emulator.js';

/**
 * The system driver, `SYSTEM.DRV`, as a module: found by its name, `SYSTEM`,
 * as Windows' own is (`modhand`), and by its file's.
 *
 * The ordinals and names are the installation's own export table, and how
 * many bytes of arguments each takes are what each function's `retf` pops,
 * read out of the file (`SYSTEM.DRV` seg1). KERNEL asks it what a drive is
 * and USER's `GetTickCount` is its millisecond count; here those are
 * KERNEL's and USER's own, and the driver answers as they do. Its timers
 * are kept in its data segment as the driver keeps them, so that what a
 * program sees of them -- their handles, which are where each is kept -- is
 * as it is on Windows. **Recorded** by `sysdrv`. As the Rust engine's
 * `system_driver.rs`.
 *
 * @memberof Win16
 */
export class SystemDriver extends Module {
  static get name(): string {
    return 'SYSTEM';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\SYSTEM.DRV';
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [InquireSystem, 'InquireSystem', 4, [UINT, UINT], DWORD];
    exports[2] = [CreateSystemTimer, 'CreateSystemTimer', 6, [UINT, FARPTR], UINT];
    exports[3] = [KillSystemTimer, 'KillSystemTimer', 2, [UINT], UINT];
    exports[4] = [EnableSystemTimers, 'EnableSystemTimers', 0, []];
    exports[5] = [DisableSystemTimers, 'DisableSystemTimers', 0, []];
    exports[6] = [GetSystemMSecCount, 'GetSystemMSecCount', 0, [], DWORD];
    exports[7] = [Get80x87SaveSize, 'Get80x87SaveSize', 0, [], UINT];
    exports[8] = [Save80x87State, 'Save80x87State', 4, [FARPTR]];
    exports[9] = [Restore80x87State, 'Restore80x87State', 4, [FARPTR]];
    exports[10] = [() => 1, 'WEP', 2, [UINT], UINT];
    exports[20] = [() => 2, 'A20_Proc', 2, [UINT], UINT];

    return exports;
  }

  static stub() {
    console.log('Stub called!');
  }
}

/** The timer's tick, in milliseconds: 65,536 of the 8253's 1,193,180 Hz. */
const TICK = (65536 * 1000) / 1193180;

/** Where the timers are kept in the driver's data, eight bytes each. */
const FIRST_TIMER = 0x18;

/** The eight timers' end: two words of FFFFh. */
const LAST_TIMER = 0x58;

/** Whether the timer's interrupt is hooked: `EnableSystemTimers` (`[5Ch]`). */
const HOOKED = 0x5c;

/**
 * The timers Windows' own modules hold as a program starts, which WinBox's
 * stand in for and does not call: COMM.DRV's every tick of 100 ms (its
 * `CreateSystemTimer` at seg1 `0126`), DISPLAY's cursor check every tick
 * (USER seg3 `02fa`-`0302`), KERNEL's every nine and USER's own, here with
 * the rate `sysdrv`'s diagnosis found, 182 ticks (USER seg1 `738f`). Each
 * is its rate and its count. **Recorded**: the first handle a program is
 * given is 38h, and four can be made.
 */
const HELD = [
  [1, 1],
  [0, 0],
  [9, 8],
  [0xb6, 0xb5],
];

/** The driver's data segment's selector. */
function data(system: any): number {
  return system._moduleData?.SYSTEM ?? 0;
}

function core(system: any) {
  return system.machine.cpu.core;
}

/** The driver's state as it is once started: its timers laid out, hooked. */
function started(system: any) {
  const segment = data(system);
  const memory = core(system);

  if (!segment || memory.read8(segment, 0)) {
    return segment;
  }

  memory.write8(segment, 0, 1);

  for (let at = FIRST_TIMER; at < LAST_TIMER; at += 8) {
    const held = HELD[(at - FIRST_TIMER) / 8];

    memory.write16(segment, at, held ? held[0] : 0xffff);
    memory.write16(segment, at + 2, held ? held[1] : 0);
    memory.write16(segment, at + 4, 0);
    memory.write16(segment, at + 6, 0);
  }

  memory.write16(segment, LAST_TIMER, 0xffff);
  memory.write16(segment, LAST_TIMER + 2, 0xffff);
  memory.write8(segment, HOOKED, 1);

  return segment;
}

/**
 * What the system is: code 0 the timer's resolution in microseconds,
 * 54,925 (seg1 `0020`); code 1 what a drive is (`driveInquiry`); any other
 * nought. Code 2, which saves DOS's byte at 0:504h before DOS 3.20, does
 * nothing after it (seg1 `0110`-`015e`).
 */
export function InquireSystem(this: any, wInfo: number, wDrive: number) {
  started(this);

  switch (wInfo & 0xffff) {
    case 0:
      return 0xd68d;

    case 1: {
      const { kind, alias } = driveInquiry(this, wDrive);

      return ((alias << 16) | kind) >>> 0;
    }

    default:
      return 0;
  }
}

/**
 * A timer that calls `lpProc` every `wRate` milliseconds, as ticks: the
 * rate times 1,000 divided by 54,925, nought every tick (seg1 `033c`-`034b`).
 * Kept in the first free place -- one whose rate is FFFFh -- and that
 * place's offset in the driver's data is the handle; nought where the
 * eight are taken (`034e`-`0371`).
 */
export function CreateSystemTimer(this: any, wRate: number, lpProc: number) {
  const segment = started(this);
  const memory = core(this);
  const ticks = wRate ? Math.floor(((wRate & 0xffff) * 1000) / 0xd68d) : 0;

  for (let at = FIRST_TIMER; ; at += 8) {
    if (memory.read16(segment, at) !== 0xffff) {
      continue;
    }

    if (memory.read16(segment, at + 2) === 0xffff) {
      return 0;
    }

    memory.write16(segment, at + 4, lpProc & 0xffff);
    memory.write16(segment, at + 6, lpProc >>> 16);
    memory.write16(segment, at + 2, ticks);
    memory.write16(segment, at, ticks);
    armSystemTimers(this);

    return at;
  }
}

/**
 * The timer kept at `hTimer` freed: nought, or the handle itself where no
 * timer is kept there (seg1 `0391`-`03bb`).
 */
export function KillSystemTimer(this: any, hTimer: number) {
  const segment = started(this);
  const memory = core(this);
  const handle = hTimer & 0xffff;

  for (let at = FIRST_TIMER; ; at += 8) {
    const rate = memory.read16(segment, at);

    if (rate === 0xffff && memory.read16(segment, at + 2) === 0xffff) {
      return handle;
    }

    if (rate !== 0xffff && at === handle) {
      memory.write16(segment, at, 0xffff);
      memory.write16(segment, at + 2, 0);
      memory.write16(segment, at + 4, 0);
      memory.write16(segment, at + 6, 0);
      this.scheduler?.cancelInterrupts?.(timerKey(this, at));

      return 0;
    }
  }
}

/** The timer's interrupt hooked: the timers run (seg1 `02e2`). */
export function EnableSystemTimers(this: any) {
  core(this).write8(started(this), HOOKED, 1);
  armSystemTimers(this);
}

/** The timer's interrupt let go: no timer runs until it is hooked again (`030d`). */
export function DisableSystemTimers(this: any) {
  core(this).write8(started(this), HOOKED, 0);
}

/**
 * The milliseconds since Windows started, as USER's `GetTickCount` answers
 * them: USER's is this, a jump to it (`USER.EXE` seg1 `729f`).
 */
export function GetSystemMSecCount(this: any) {
  return tickCount(clockOf(this).now());
}

/**
 * The bytes `Save80x87State` writes: `FSAVE`'s 94 where the BIOS's
 * equipment word says there is a coprocessor, nought where it does not
 * (seg1 `016c`, from `01fe`-`021e`).
 */
export function Get80x87SaveSize(this: any) {
  return this.machine.coprocessor !== false ? 0x5e : 0;
}

/** The unit's state, as `FSAVE` writes it, which leaves it as `FNINIT` does (`0177`). */
export function Save80x87State(this: any, lpSave: number) {
  fpuOf(this).execute({
    opcode: 0xdd,
    modifier: 6,
    segment: lpSave >>> 16,
    offset: lpSave & 0xffff,
  });
}

/** The unit's state put back from what `Save80x87State` wrote (`0183`). */
export function Restore80x87State(this: any, lpSave: number) {
  fpuOf(this).execute({
    opcode: 0xdd,
    modifier: 4,
    segment: lpSave >>> 16,
    offset: lpSave & 0xffff,
  });
}

/** What a timer's calls waiting are known by, to take them back as it is freed. */
function timerKey(system: any, handle: number) {
  const keys = (system._systemTimerKeys ??= new Map<number, object>());

  if (!keys.has(handle)) {
    keys.set(handle, { systemTimer: handle });
  }

  return keys.get(handle);
}

/**
 * The timer's interrupt, each tick that has passed since it was last
 * looked at, as the driver's handler runs it (seg1 `0298`-`02c5`): each
 * timer whose rate is not FFFFh, a program's, is counted down and called
 * as its count comes to nought, its count set to its rate again; a rate of
 * nought is called every tick. It is called with AX its handle and DS the
 * driver's data, as at interrupt time (`Scheduler.atInterrupt`). The
 * timers WinBox holds for Windows' own modules (`HELD`) have no procedure
 * and are only counted. Called as the task runs and as its clock passes
 * the next tick (`armSystemTimers`). A run that lagged a long way is
 * called for no more than 64 ticks at once.
 */
export function pollSystemTimers(system: any) {
  const segment = data(system);
  const memory = core(system);

  if (!segment || !memory.read8(segment, 0) || !memory.read8(segment, HOOKED)) {
    return;
  }

  const tick = Math.floor(clockOf(system).now() / TICK);
  const last = system._systemTimerTick ?? tick;

  system._systemTimerTick = tick;

  for (let passed = Math.max(last + 1, tick - 63); passed <= tick; passed++) {
    for (let at = FIRST_TIMER; at < LAST_TIMER; at += 8) {
      const rate = memory.read16(segment, at);

      if (rate === 0xffff) {
        continue;
      }

      if (rate !== 0) {
        const count = (memory.read16(segment, at + 2) - 1) & 0xffff;

        if (count !== 0) {
          memory.write16(segment, at + 2, count);
          continue;
        }

        memory.write16(segment, at + 2, rate);
      }

      const proc = ((memory.read16(segment, at + 6) << 16) | memory.read16(segment, at + 4)) >>> 0;

      if (proc) {
        system.scheduler?.atInterrupt(proc, [], timerKey(system, at), system.scheduler?.active, {
          ax: at,
          ds: segment,
        });
      }
    }
  }

  armSystemTimers(system);
}

/**
 * The clock's timer for the next tick, while a program's timer is kept and
 * the interrupt hooked, so that a task waiting for a message is woken to
 * it.
 */
function armSystemTimers(system: any) {
  const segment = data(system);
  const memory = core(system);
  const clock = clockOf(system);

  if (system._systemTimerWake) {
    clock.cancel(system._systemTimerWake);
    system._systemTimerWake = null;
  }

  if (!segment || !memory.read8(segment, HOOKED)) {
    return;
  }

  let any = false;

  for (let at = FIRST_TIMER; at < LAST_TIMER; at += 8) {
    any ||= memory.read16(segment, at) !== 0xffff && memory.read16(segment, at + 6) !== 0;
  }

  if (!any) {
    return;
  }

  system._systemTimerTick ??= Math.floor(clock.now() / TICK);

  const next = (Math.floor(clock.now() / TICK) + 1) * TICK;

  system._systemTimerWake = clock.after(Math.max(0, next - clock.now()), () => {
    system._systemTimerWake = null;
    pollSystemTimers(system);
  });
}
