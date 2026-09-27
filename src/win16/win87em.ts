'use strict';

/** @namespace Win87EM */

import { Module } from './module.js';
import { FARPTR, INT, UINT } from './types.js';
import { floatingStateOf, fpuOf } from './win87em/emulator.js';

/**
 * WIN87EM, the coprocessor and emulator library, kept by winbox.js rather
 * than loaded from its file.
 *
 * **Read out** of `WIN87EM.DLL` (seg1 `2a`-`220`). `__FPMATH` is called with
 * a function in BX, its arguments and answers in registers, and BX and CX
 * not kept; a function past 12 answers FFFFh in AX and DX. The emulator
 * itself, the interrupts KERNEL makes of a program's floating-point
 * instructions without a coprocessor, is `win87em/emulator.ts`.
 *
 * Not followed: WIN87EM's data segment, which `__WIN87EMINFO` names and
 * `__WIN87EMSAVE` copies -- winbox.js's state is its own, and the saved
 * copy is its own layout of it.
 *
 * @memberof Win16
 */
export class Win87EM extends Module {
  static get name(): string {
    return 'WIN87EM';
  }

  static get path() {
    return 'C:\\WINDOWS\\SYSTEM\\WIN87EM.DLL';
  }

  static get exports() {
    return [
      // 0 // "Microsoft Windows 3.1 Coprocessor/Emulator Library 7.00.00"
      null,
      [FPMATH, '__FPMATH', 0],
      [() => 1, 'WEP', 2, [INT], INT],
      [WIN87EMINFO, '__WIN87EMINFO', 6, [FARPTR, UINT], INT],
      [WIN87EMRESTORE, '__WIN87EMRESTORE', 6, [FARPTR, UINT], INT],
      [WIN87EMSAVE, '__WIN87EMSAVE', 6, [FARPTR, UINT], INT],
    ];
  }

  static stub() {
    console.log('Stub called!');
  }
}

/** The size of the area `__WIN87EMSAVE` fills: the coprocessor's 94 bytes and the rest. */
const SAVE_SIZE = 0x1cd;
const FSAVE_SIZE = 0x5e;

/** Resets the unit and WIN87EM's state, as `__FPMATH` 1 does (seg1 `b3`). */
function reset(system: any) {
  const fpu = fpuOf(system);
  const state = floatingStateOf(system);

  fpu.reset();
  setControl(system, 0x1332);
  fpu.status &= 0x3800;
  state.status = 0;
}

/** The control word set, as `__FPMATH` 4 does: the invalid and denormal exceptions left unmasked on the unit. */
function setControl(system: any, word: number) {
  const effective = word & 0xff3c;

  floatingStateOf(system).control = word & 0xffff;
  fpuOf(system).control = effective;

  return effective;
}

/**
 * `__FPMATH`, BX the function:
 *
 * * 0 starts it for a program, and resets; 1 resets -- the unit made empty,
 *   the control word 1332h, the exceptions cleared; 2 resets, and stops it
 *   for the program. Each answers nought, the carry clear.
 * * 3 makes DX:AX the procedure exceptions are reported to, `INT 3Eh`'s
 *   vector, and answers 253Eh.
 * * 4 sets the control word from AX, the invalid and denormal exceptions
 *   unmasked on the unit, and answers the unit's; 5 answers the program's.
 * * 6 rounds ST(0) to an integer, rounding as AX's bits 10 and 11 say; 7
 *   pops it as a long in DX:AX, rounding the same.
 * * 8 answers the exceptions gathered, 9 clears them.
 * * 10 answers how many values are on the stack: with a coprocessor, DX
 *   those on it and AX all; without, AX. 11 answers whether there is a
 *   coprocessor; 12 keeps AX.
 */
export function FPMATH(this: any) {
  const core = this.machine.cpu.core;
  const fpu = fpuOf(this);
  const state = floatingStateOf(this);
  const coprocessor = this.machine.coprocessor !== false;
  const inUse = () => fpu.empty.filter((empty: boolean) => !empty).length;

  switch (core.bx) {
    case 0:
      state.uses++;
      reset(this);
      core.ax = 0;
      core.flags.carry = false;
      break;

    case 1:
      reset(this);
      core.ax = 0;
      break;

    case 2:
      reset(this);
      state.uses = Math.max(0, state.uses - 1);
      core.ax = 0;
      break;

    case 3: {
      const idt = this.machine.idtSegment;

      core.write16(idt, 0x3e * 4, core.ax);
      core.write16(idt, 0x3e * 4 + 2, core.dx);
      core.ax = 0x253e;
      break;
    }

    case 4:
      core.ax = setControl(this, core.ax);
      break;

    case 5:
      core.ax = state.control;
      break;

    case 6: {
      const control = fpu.control;

      fpu.control = (control & ~0x0c00) | (core.ax & 0x0c00);
      fpu.setSt(0, fpu.roundInteger(fpu.st(0)));
      fpu.control = control;
      break;
    }

    case 7: {
      const control = fpu.control;

      fpu.control = (control & ~0x0c00) | (core.ax & 0x0c00);

      const value = fpu.roundInteger(fpu.st(0));
      const fits = Number.isFinite(value) && value >= -(2 ** 31) && value < 2 ** 31;
      const long = fits ? value >>> 0 : 0x80000000;

      if (!fits) {
        state.status |= 0x01;
      }

      fpu.control = control;
      fpu.pop();
      core.ax = long & 0xffff;
      core.dx = (long >>> 16) & 0xffff;
      break;
    }

    case 8:
      state.status = (state.status | (coprocessor ? fpu.status & 0x3f : 0)) & 0x1fff;
      core.ax = state.status;
      break;

    case 9:
      fpu.status &= 0x3800;
      state.status = 0;
      core.ax = 0;
      break;

    case 10:
      core.dx = coprocessor ? inUse() : 0;
      core.ax = inUse();
      break;

    case 11:
      core.ax = coprocessor ? 1 : 0;
      break;

    case 12:
      state.spill = core.ax;
      break;

    default:
      core.ax = 0xffff;
      core.dx = 0xffff;
      break;
  }
}

/**
 * What WIN87EM is: its version, 600h; the size `__WIN87EMSAVE` needs; its
 * data and code segments; and whether there is a coprocessor.
 *
 * @returns {Types.INT} Nought, or -1 for a size under 12.
 */
export function WIN87EMINFO(this: any, lpInfo: number, cbInfo: number) {
  if ((cbInfo & 0xffff) < 12) {
    return -1;
  }

  const core = this.machine.cpu.core;
  const segment = lpInfo >>> 16;
  const offset = lpInfo & 0xffff;
  const code = this.modules.load(Win87EM).segment;

  [0x0600, SAVE_SIZE, 0, code << 3, this.machine.coprocessor !== false ? 1 : 0, 0].forEach(
    (word, i) => core.write16(segment, (offset + i * 2) & 0xffff, word)
  );

  return 0;
}

/** Runs FNSAVE or FRSTOR on the unit, on the area at a far pointer. */
function saveOrRestore(system: any, far: number, save: boolean) {
  fpuOf(system).execute({
    opcode: 0xdd,
    modifier: save ? 6 : 4,
    segment: far >>> 16,
    offset: far & 0xffff,
  });
}

/**
 * Saves the floating-point state for a program: the unit as `FNSAVE`
 * writes it, then WIN87EM's own.
 *
 * @returns {Types.INT} Nought, or -1 for a size under 1CDh.
 */
export function WIN87EMSAVE(this: any, lpSave: number, cbSave: number) {
  if ((cbSave & 0xffff) < SAVE_SIZE) {
    return -1;
  }

  const core = this.machine.cpu.core;
  const state = floatingStateOf(this);

  saveOrRestore(this, lpSave, true);
  [state.control, state.status, state.uses, state.spill].forEach((word, i) =>
    core.write16(lpSave >>> 16, ((lpSave & 0xffff) + FSAVE_SIZE + i * 2) & 0xffff, word)
  );

  return 0;
}

/** Puts back what `__WIN87EMSAVE` saved. */
export function WIN87EMRESTORE(this: any, lpSave: number, cbSave: number) {
  if ((cbSave & 0xffff) < SAVE_SIZE) {
    return -1;
  }

  const core = this.machine.cpu.core;
  const state = floatingStateOf(this);
  const read = (i: number) =>
    core.read16(lpSave >>> 16, ((lpSave & 0xffff) + FSAVE_SIZE + i * 2) & 0xffff);

  state.control = read(0);
  state.status = read(1);
  state.uses = read(2);
  state.spill = read(3);
  saveOrRestore(this, lpSave, false);

  return 0;
}
