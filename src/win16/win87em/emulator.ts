'use strict';

import { User } from '../user.js';

/**
 * WIN87EM's floating point: the coprocessor, or, without one, its emulator.
 *
 * **Read out** of `WIN87EM.DLL` (seg1 `2a`-`ec0`) and `KRNL386.EXE` (seg1
 * `7536`): a program built for either has its floating-point instructions
 * written as the coprocessor's, `FWAIT` first, each marked by an OS fixup.
 * KERNEL applies them as it loads the program (see `OS_FIXUPS` in
 * `linker.ts`): with a coprocessor the `FWAIT` becomes `NOP`, and the
 * instruction runs on it; without, it becomes `INT 34h` to `3Bh` -- or
 * `INT 3Ch` and a byte naming its segment -- and WIN87EM's handler carries
 * it out. A lone `FWAIT` becomes `INT 3Dh` either way.
 *
 * * The emulator takes the ESC opcode from the interrupt's number, `D8h` on,
 *   or for `INT 3Ch` from the byte after it, whose top two bits are the
 *   segment (DS, SS, CS, ES); reads the ModRM and displacement that follow;
 *   carries the instruction out; and returns past it, the instruction no
 *   longer than it was.
 * * It carries out only some instructions: the arithmetic, loads, stores,
 *   comparisons, constants and the functions of the 8087, and not `FNINIT`,
 *   `FNOP`, the environment, `FBLD`, `FBSTP`, `FXTRACT`, `FINCSTP`,
 *   `FDECSTP` or the 387's own. What it does not is reported as unemulated.
 * * The status word it stores has TOP as nought.
 * * After each instruction, the exceptions it raised that the program's
 *   control word does not mask -- a denormal always masked, the stack's and
 *   the unemulated never -- are reported: the procedure at `INT 3Eh`'s vector
 *   is called with the code in AX (81h invalid, 83h a division by nought,
 *   84h overflow, 85h underflow, 86h precision, 87h unemulated, 88h the
 *   square root of a negative, 8Ah the stack overflowing, 8Bh underflowing),
 *   and if it returns the program goes on after the instruction.
 *
 * winbox.js's emulator carries each instruction out on the processor's own
 * floating-point unit, as the coprocessor would. Not followed: WIN87EM's own
 * arithmetic, whose rounding and whose NaNs may differ; its stack of
 * fourteen, where the unit has eight; `FFREE` closing the stack up; and, with
 * a coprocessor, exceptions raised by the unit, which never raises them.
 */

const INT_FWAIT = 0x3d;
const INT_OVERRIDE = 0x3c;

/** WIN87EM's state beside the unit's: the program's control word, and its gathered exceptions. */
export interface FloatingState {
  /** The control word the program set: its masks decide what is reported. */
  control: number;
  /** The exceptions gathered since last cleared. */
  status: number;
  /** How many programs have started it. */
  uses: number;
  /** Whether the coprocessor's stack may spill: `__FPMATH` 12's. */
  spill: number;
}

export function floatingStateOf(system: any): FloatingState {
  return (system._win87em ??= { control: 0x1332, status: 0, uses: 0, spill: 1 });
}

export function fpuOf(system: any) {
  return system.machine.cpu.core._fpu;
}

/** Whether WIN87EM's emulator carries an instruction out (seg1 `970`-`990`, and the register tables). */
function emulated(opcode: number, modrm: number) {
  const mod = modrm >> 6;
  const reg = (modrm >> 3) & 7;

  if (mod !== 3) {
    switch (opcode) {
      case 0xd9:
      case 0xdb:
      case 0xdf:
        return [0, 2, 3, 5, 7].includes(reg);
      case 0xdd:
        return [0, 2, 3, 7].includes(reg);
      default:
        return true;
    }
  }

  switch (opcode) {
    case 0xd9:
      return (
        modrm < 0xd0 ||
        [0xe0, 0xe1, 0xe4, 0xe5, 0xf0, 0xf1, 0xf2, 0xf3, 0xf8, 0xf9, 0xfa, 0xfc, 0xfd].includes(
          modrm
        ) ||
        (modrm >= 0xe8 && modrm <= 0xee)
      );
    case 0xdb:
      return (
        (modrm & 0xf9) === 0xe0 ||
        modrm < 0xc8 ||
        (modrm >= 0xd0 && modrm < 0xd8) ||
        (modrm >= 0xe8 && modrm <= 0xef)
      );
    case 0xdd:
      return modrm < 0xc8 || (modrm >= 0xd0 && modrm < 0xe0) || (modrm >= 0xe8 && modrm <= 0xef);
    case 0xdf:
      return modrm === 0xe0 || modrm === 0xe2 || modrm === 0xe4 || modrm === 0xe6;
    default:
      return true;
  }
}

/** Some register forms WIN87EM carries out as others (seg1 `980`), and some that only clear the status. */
function asCarriedOut(opcode: number, modrm: number): [number, number] | 'clear' {
  if ((opcode === 0xdb || opcode === 0xdf) && (modrm & 0xf9) === 0xe0 && modrm !== 0xe0) {
    return 'clear';
  }

  if (opcode === 0xdb && (modrm & 0xf9) === 0xe0) {
    return 'clear';
  }

  if (opcode === 0xdb && modrm < 0xc8) {
    return [0xdd, modrm]; // as FFREE
  }

  if (opcode === 0xdb && modrm >= 0xd0 && modrm < 0xd8) {
    return [0xdd, modrm]; // as FST ST(i)
  }

  if ((opcode === 0xdb || opcode === 0xdd) && modrm >= 0xe8 && modrm <= 0xef) {
    return [0xd9, modrm]; // as the constants
  }

  return [opcode, modrm];
}

/** The code an instruction's unmasked exceptions are reported with, or nought for none (seg1 `67c`, `ec0`). */
function reportCode(
  state: FloatingState,
  raised: number,
  stackFault: boolean,
  overflowing: boolean,
  root: boolean
) {
  if (stackFault) {
    return overflowing ? 0x8a : 0x8b;
  }

  const unmasked = raised & ~((state.control | 0xc2) & 0x3f) & 0x3f;

  if (!unmasked) {
    return 0;
  }

  if (unmasked & 0x01) {
    return root ? 0x88 : 0x81;
  }

  if (unmasked & 0x04) {
    return 0x83;
  }

  if (unmasked & 0x08) {
    return 0x84;
  }

  if (unmasked & 0x10) {
    return 0x85;
  }

  return unmasked & 0x20 ? 0x86 : 0x87;
}

/**
 * Carries out the instruction after an `INT 34h`-`3Ch`, as WIN87EM's
 * emulator does: the code to report, or nought. IP is left past it.
 */
function emulate(system: any, vector: number): number {
  const core = system.machine.cpu.core;
  const fpu = fpuOf(system);
  const state = floatingStateOf(system);
  const instruction: any = {};
  let opcode: number;

  if (vector === INT_OVERRIDE) {
    const named = core.read8(core.cs, core.ip);

    core.ip = (core.ip + 1) & 0xffff;
    instruction.segment = [core.ds, core.ss, core.cs, core.es][named >> 6];
    opcode = 0xd8 + (named & 7);
  } else {
    opcode = 0xd8 + (vector - 0x34);
  }

  const modrm = core.read8(core.cs, core.ip);

  core.readModRM(instruction);

  if (!emulated(opcode, modrm)) {
    state.status |= 0x40;

    return 0x87;
  }

  const carried = asCarriedOut(opcode, modrm);

  /* The status word made nought: the unit's TOP kept, which WIN87EM has none of. */
  if (carried === 'clear') {
    fpu.status &= 0x3800;
    return 0;
  }

  [instruction.opcode] = carried;

  if (carried[1] !== modrm) {
    instruction.modifier = (carried[1] >> 3) & 7;
    instruction.operandRegister = carried[1] & 7;
  }

  /* This instruction's own exceptions, the ones gathered before put back. */
  const before = fpu.status & 0x7f;

  fpu.status &= ~0x7f;
  fpu.execute(instruction);

  const raised = fpu.status & 0x3f;
  const stackFault = (fpu.status & 0x40) !== 0;
  const overflowing = (fpu.status & 0x200) !== 0;

  fpu.status |= before;
  state.status |= raised | (stackFault ? (overflowing ? 0x200 : 0x400) : 0);

  /* The status word stored has TOP as nought. */
  if (opcode === 0xdf && modrm === 0xe0) {
    core.ax &= ~0x3800;
  } else if (opcode === 0xdd && ((modrm >> 3) & 7) === 7 && modrm >> 6 !== 3) {
    core.write16(
      instruction.segment,
      instruction.offset,
      core.read16(instruction.segment, instruction.offset) & ~0x3800
    );
  }

  return reportCode(state, raised, stackFault, overflowing, opcode === 0xd9 && modrm === 0xfa);
}

/** Calls the procedure at `INT 3Eh`'s vector with a code, as WIN87EM reports an exception (seg1 `6eb`). */
async function report(system: any, code: number) {
  const idt = system.machine.idtSegment;
  const core = system.machine.cpu.core;
  const offset = core.read16(idt, 0x3e * 4);
  const segment = core.read16(idt, 0x3e * 4 + 2);

  if (!segment && !offset) {
    return;
  }

  await system.scheduler.call(User, segment, offset, [], undefined, { ax: code });
}

/**
 * `INT 34h` to `3Dh`: an instruction to carry out, or, for `3Dh`, a lone
 * `FWAIT`, which returns. With a coprocessor, KERNEL makes none but the
 * `FWAIT`s, and WIN87EM puts the coprocessor's instruction back and runs it;
 * here it is carried out the same.
 */
export function floatingInterrupt(system: any, vector: number) {
  if (vector === INT_FWAIT) {
    return true;
  }

  const code = emulate(system, vector);

  if (!code) {
    return true;
  }

  /* Reported as an API call is made: the task halted, the procedure called,
   * the task resumed after the instruction. */
  const task = system.scheduler?.task;

  if (!task) {
    return true;
  }

  task.pushContext(1);
  task.halt();
  system.scheduler.interpretReturnValue(report(system, code), undefined);

  return false;
}
