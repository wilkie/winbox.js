'use strict';

import { GetPrivateProfileInt } from '../kernel/GetPrivateProfileInt.js';
import { GetWinFlags } from '../kernel/GetWinFlags.js';
import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { Kind, count } from './devices.js';

/**
 * MMSYSTEM's interrupt stacks, which a driver moves to for the time it runs
 * at interrupt time: `StackEnter` and `StackLeave`. The twin of
 * `mmsystem/stacks.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg2 `152`-`282`, seg1 `2bd`, `312`-`3aa`);
 * **recorded** by `mmmisc`:
 *
 * * In standard mode, as the first load ends, if there is any waveform or
 *   MIDI device -- and else at the first `timeSetEvent` -- MMSYSTEM
 *   allocates its stacks in one block, `GMEM_SHARE` and fixed: as many as
 *   `SYSTEM.INI`'s `[mmsystem]` `StackFrames` says, or one for the timer's
 *   driver, one if there is a MIDI device and one if a waveform one; each as
 *   big as `StackSize` says, 600h, no fewer than 40h bytes, made even. A
 *   block of 64 K or more, or one not had, is three of 600h. In 386 enhanced
 *   mode there are none. The block's top is where the next stack begins.
 * * `StackEnter`, in standard mode, takes the next stack down: the program
 *   goes on there, the stack it came from -- its pointer past the return
 *   address, and its segment -- the two words on top, and the carry flag
 *   clear. With no stack left, or none made, it puts a word of nought under
 *   its return address and sets the carry flag. In 386 enhanced mode it only
 *   sets the carry flag.
 * * `StackLeave` moves back to the stack the two words on top name, giving
 *   the stack back; under a word of nought it takes that word away. AX, BX
 *   and DS are kept by both.
 */

const WF_STANDARD = 0x10;
const WF_ENHANCED = 0x20;

interface Stacks {
  /** Each stack's size: 0 until they are first made. */
  size: number;
  /** How many there are, as asked for. */
  frames: number;
  /** The block's selector, or nought. */
  selector: number;
  /** Where the next stack begins: nought with none left. */
  top: number;
}

function stacksOf(system: any): Stacks {
  return (system._mmStacks ??= { size: 0, frames: 0, selector: 0, top: 0 });
}

/** The stacks made, as MMSYSTEM makes them (seg2 `152`): whether there are any. */
export async function makeStacks(system: any) {
  if (GetWinFlags.call(system) & WF_ENHANCED) {
    return true;
  }

  const stacks = stacksOf(system);
  let size =
    (await GetPrivateProfileInt.call(system, 'mmsystem', 'StackSize', 0x600, 'system.ini')) &
    0xffff;

  stacks.size = size < 0x40 ? 0x40 : size;

  let frames =
    (await GetPrivateProfileInt.call(system, 'mmsystem', 'StackFrames', -1, 'system.ini')) & 0xffff;

  if (frames === 0xffff) {
    frames = system._mmsystemDriver?.timer ? 1 : 0;

    if (count(system, Kind.MidiOut) + count(system, Kind.MidiIn)) {
      frames++;
    }

    if (count(system, Kind.WaveOut) + count(system, Kind.WaveIn)) {
      frames++;
    }
  }

  if (stacks.frames === frames) {
    return true;
  }

  freeStacks(system);
  stacks.frames = frames;

  if (frames < 1) {
    stacks.frames = frames = 1;
  }

  size = (stacks.size + 1) & 0xfffe;
  stacks.size = size;

  let total = size * frames;

  if (total < 0x10000) {
    stacks.selector = GlobalAlloc.call(system, 0x2000, total) & 0xffff;
  }

  if (total >= 0x10000 || !stacks.selector) {
    stacks.frames = 3;
    stacks.size = 0x600;
    total = 0x1200;
    stacks.selector = GlobalAlloc.call(system, 0x2000, total) & 0xffff;
  }

  stacks.top = total;

  if (!stacks.selector) {
    stacks.top = 0;
    return false;
  }

  return true;
}

/** The block let go, if there is one (seg2 `283`). */
function freeStacks(system: any) {
  const stacks = stacksOf(system);

  if (stacks.selector) {
    GlobalFree.call(system, stacks.selector);
  }

  stacks.selector = 0;
  stacks.top = 0;
}

/** The stacks made when a timer event is first set, if they were not as MMSYSTEM loaded (seg1 `2bd`). */
export async function makeStacksForTimer(system: any) {
  if (GetWinFlags.call(system) & WF_ENHANCED || stacksOf(system).size) {
    return;
  }

  await makeStacks(system);
}

/** `StackEnter`: the program moved to MMSYSTEM's next stack, or a word of nought put under its return. */
export function StackEnter(this: any) {
  const core = this.machine.cpu.core;

  if (!(GetWinFlags.call(this) & WF_STANDARD)) {
    core.flags.carry = true;
    return;
  }

  const stacks = stacksOf(this);
  const ss = core.ss & 0xffff;
  const sp = core.sp & 0xffff;
  const ip = core.read16(ss, sp);
  const cs = core.read16(ss, (sp + 2) & 0xffff);

  if (!stacks.top) {
    core.write16(ss, (sp - 2) & 0xffff, ip);
    core.write16(ss, sp, cs);
    core.write16(ss, (sp + 2) & 0xffff, 0);
    core.sp = (sp - 2) & 0xffff;
    core.flags.carry = true;
    return;
  }

  const top = stacks.top;

  stacks.top = (top - stacks.size) & 0xffff;

  const selector = stacks.selector;
  const at = (top - 8) & 0xffff;

  /* The return address, under it the stack come from: its pointer past the
   * return address and its segment. */
  core.ss = selector;
  core.write16(selector, at, ip);
  core.write16(selector, (at + 2) & 0xffff, cs);
  core.write16(selector, (at + 4) & 0xffff, (sp + 4) & 0xffff);
  core.write16(selector, (at + 6) & 0xffff, ss);
  core.sp = at;
  core.flags.carry = false;
}

/** `StackLeave`: the program moved back to the stack it came from, or the word of nought taken away. */
export function StackLeave(this: any) {
  const core = this.machine.cpu.core;

  if (!(GetWinFlags.call(this) & WF_STANDARD)) {
    core.flags.carry = false;
    return;
  }

  const ss = core.ss & 0xffff;
  const sp = core.sp & 0xffff;
  const ip = core.read16(ss, sp);
  const cs = core.read16(ss, (sp + 2) & 0xffff);
  const below = core.read16(ss, (sp + 4) & 0xffff);

  /* The word compared with nought: the carry clear. */
  core.flags.carry = false;

  if (!below) {
    /* `retf 2`: the word of nought goes with the return. */
    core.write16(ss, (sp + 2) & 0xffff, ip);
    core.write16(ss, (sp + 4) & 0xffff, cs);
    core.sp = (sp + 2) & 0xffff;
    return;
  }

  const back = core.read16(ss, (sp + 6) & 0xffff);
  const stacks = stacksOf(this);

  core.ss = back;
  core.write16(back, (below - 4) & 0xffff, ip);
  core.write16(back, (below - 2) & 0xffff, cs);
  core.sp = (below - 4) & 0xffff;
  /* The stack given back: the carry the addition's. */
  core.flags.carry = stacks.top + stacks.size > 0xffff;
  stacks.top = (stacks.top + stacks.size) & 0xffff;
}
