'use strict';

import { firstMegabyteSelector } from '../global-allocator.js';
import { winFlags } from './GetWinFlags.js';
import type { WindowsMode } from '../../emulator/machine.js';

/** What of the machine a constant may depend on: `__WINFLAGS`, its coprocessor and mode. */
export interface ConstantMachine {
  coprocessor: boolean;
  mode: WindowsMode;
}

/** A machine as the recordings' is by default: a coprocessor, standard mode. */
export const DEFAULT_MACHINE: ConstantMachine = { coprocessor: true, mode: 'standard' };

/**
 * An export that is a number rather than a function: an entry of segment
 * FEh in the module's file, its offset the number. A program reads it where
 * its relocation puts it, and `GetProcAddress` answers it with FFFFh above
 * it (`KRNL386.EXE` seg1 `502c`-`502f`; `kconst`). An export table holds
 * one of these in place of the function that answers a call.
 */
export class ExportedConstant {
  constructor(readonly value: (machine: ConstantMachine) => number) {}
}

/** The segment KERNEL answers a constant in, with the number below it. */
export const CONSTANT_SEGMENT = 0xffff;

const selector = (paragraph: number) =>
  new ExportedConstant(() => firstMegabyteSelector(paragraph)!);

/**
 * KERNEL's constants, by ordinal: in protected mode a huge pointer's
 * selector steps by 8, a shift of 3 (`__AHSHIFT`, `__AHINCR`); `__WINFLAGS`
 * is what `GetWinFlags` answers; and the selectors KERNEL makes as it
 * starts for the first megabyte's fixed places, each from the paragraph
 * its entry in the file holds -- `__ROMBIOS` the same selector as
 * `__F000H` (`kconst`; `FIRST_MEGABYTE_SELECTORS`). As the Rust engine's
 * `kernel_constant`.
 */
export const KERNEL_CONSTANTS: Record<number, ExportedConstant> = {
  113: new ExportedConstant(() => 3),
  114: new ExportedConstant(() => 8),
  173: selector(0xf000),
  174: selector(0xa000),
  178: new ExportedConstant(({ coprocessor, mode }) => winFlags(coprocessor, mode) & 0xffff),
  179: selector(0xd000),
  181: selector(0xb000),
  182: selector(0xb800),
  183: selector(0x0000),
  190: selector(0xe000),
  193: selector(0x0040),
  194: selector(0xf000),
  195: selector(0xc000),
};
