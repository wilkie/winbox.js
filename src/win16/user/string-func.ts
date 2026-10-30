'use strict';

import { AnsiNext } from './AnsiNext.js';
import { AnsiPrev } from './AnsiPrev.js';
import { AnsiLowerDriven, AnsiUpperDriven } from './language-driver.js';

/**
 * USER's ordinal 470, `StringFunc` (`USER.EXE` seg11 `02e7`): four of
 * USER's string routines behind one entry, chosen by CX, not by an
 * argument -- `xchg bx,cx`, `dec bx`, `shl bx,1` and a jump through the
 * table at `02df`:
 *
 * | CX | Routine                                      | Pops |
 * | -- | -------------------------------------------- | ---- |
 * | 1  | `AnsiNext`'s body (`030e`)                   | 4    |
 * | 2  | `AnsiPrev`'s body (`02f1`)                   | 8    |
 * | 3  | `AnsiUpper`, through its entry's tail (`0130`) | 4  |
 * | 4  | `AnsiLower`, through its entry's tail (`0135`) | 4  |
 *
 * Each pops its own arguments, so the entry pops none itself; the two
 * bodies skip the checks their exports make of a pointer. **Recorded** by
 * `strfunc`. Another CX jumps through whatever words follow the table, and
 * is not followed: nothing is popped and the registers are left. As
 * `crates/winbox-win16/src/user_misc.rs`' `string_func`.
 */

/** What each CX pops: one far pointer, or two for `AnsiPrev`. */
const POPS = [0, 4, 8, 4, 4];

export async function StringFunc(this: any) {
  const core = this.machine.cpu.core;
  const routine = core.cx & 0xffff;

  if (routine < 1 || routine > 4) {
    return;
  }

  const ss = core.ss & 0xffff;
  const sp = core.sp & 0xffff;
  const dword = (at: number) =>
    ((core.read16(ss, (sp + at + 2) & 0xffff) << 16) | core.read16(ss, (sp + at) & 0xffff)) >>> 0;

  /* The far return at SP, the arguments above it, the last pushed first. */
  let answer: number;

  if (routine === 1) {
    answer = AnsiNext.call(this, dword(4));
  } else if (routine === 2) {
    answer = AnsiPrev.call(this, dword(8), dword(4));
  } else if (routine === 3) {
    answer = await AnsiUpperDriven.call(this, dword(4));
  } else {
    answer = await AnsiLowerDriven.call(this, dword(4));
  }

  /* The arguments popped: the far return moved up over them. */
  const pops = POPS[routine];
  const ip = core.read16(ss, sp);
  const cs = core.read16(ss, (sp + 2) & 0xffff);

  core.write16(ss, (sp + pops) & 0xffff, ip);
  core.write16(ss, (sp + pops + 2) & 0xffff, cs);
  core.sp = (sp + pops) & 0xffff;
  core.ax = answer & 0xffff;
  core.dx = (answer >>> 16) & 0xffff;
}
