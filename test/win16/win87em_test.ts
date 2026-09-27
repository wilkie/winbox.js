'use strict';

import { Machine } from '../../src/emulator/machine.js';
import { Linker } from '../../src/win16/linker.js';
import { Loader } from '../../src/win16/loader.js';
import { FPMATH } from '../../src/win16/win87em.js';
import { floatingInterrupt, floatingStateOf } from '../../src/win16/win87em/emulator.js';

/**
 * WIN87EM and the OS fixups: a program's floating-point instructions made
 * the emulator's or left the coprocessor's as they are linked, and the
 * emulator carrying them out. See `win87em/emulator.ts`.
 */

const CODE = 0x1000;
const DATA = 0x100;

/** A 386 with WIN87EM's handlers, and what a system gives them. */
function machine(coprocessor = false) {
  const m = new Machine({ coprocessor });
  const core: any = m.cpu.core;
  const system: any = { machine: m };

  for (let vector = 0x34; vector <= 0x3d; vector++) {
    m.interrupts.on(vector, () => floatingInterrupt(system, vector));
  }

  core.cs = CODE;
  core.ip = 0;
  core.ss = 0x2000;
  core.sp = 0x1000;
  core.ds = CODE;

  return { m, core, system };
}

/** Steps the processor, dispatching an interrupt it latches as the scheduler does. */
function run(m: Machine, steps: number) {
  const cpu: any = m.cpu;

  for (let step = 0; step < steps; step++) {
    cpu.step();

    if (cpu.interrupt !== null && cpu.interrupt !== undefined) {
      const vector = cpu.interrupt;

      cpu.interrupt = null;
      m.interrupts.dispatch(vector);
    }
  }
}

function load(core: any, bytes: number[]) {
  bytes.forEach((byte, at) => core.write8(CODE, at, byte));
}

function f64(core: any, offset: number) {
  const bytes = Array.from({ length: 8 }, (_, i) => core.read8(CODE, offset + i));

  return new DataView(new Uint8Array(bytes).buffer).getFloat64(0, true);
}

describe('WIN87EM', () => {
  describe('the OS fixups', () => {
    const site = (coprocessor: boolean, fixup: number, bytes: number[]) => {
      const m = new Machine();
      const linker: any = new Linker(m.memory, { fromName: () => null }, { coprocessor });

      bytes.forEach((byte, at) => m.memory.write8((5 << 16) + at, byte));
      linker.link({
        loader: {
          segments: [{ relocations: [{ type: Loader.RELOCATION_OSFIXUP, offset: 0, fixup }] }],
          translate: () => 5,
        },
        executable: {},
      });

      return Array.from({ length: bytes.length }, (_, at) => m.memory.read8((5 << 16) + at));
    };

    it('makes an instruction an interrupt without a coprocessor', function () {
      expect(site(false, 5, [0x9b, 0xde, 0xc1])).toEqual([0xcd, 0x3a, 0xc1]);
      expect(site(false, 4, [0x9b, 0x26, 0xd9, 0x1f])).toEqual([0xcd, 0x3c, 0xd9, 0x1f]);
      expect(site(false, 2, [0x9b, 0x36, 0xd8, 0x00])).toEqual([0xcd, 0x3c, 0x58, 0x00]);
      expect(site(false, 6, [0x90, 0x9b])).toEqual([0xcd, 0x3d]);
    });

    it('makes the FWAIT a NOP with one, and a lone FWAIT an interrupt still', function () {
      expect(site(true, 5, [0x9b, 0xde, 0xc1])).toEqual([0x90, 0xde, 0xc1]);
      expect(site(true, 4, [0x9b, 0x26, 0xd9, 0x1f])).toEqual([0x90, 0x26, 0xd9, 0x1f]);
      expect(site(true, 6, [0x90, 0x9b])).toEqual([0xcd, 0x3d]);
    });
  });

  describe('the emulator', () => {
    it('carries out an instruction after its interrupt, and returns past it', function () {
      const { m, core } = machine();

      load(core, [
        0xcd,
        0x35,
        0xe8, // FLD1
        0xcd,
        0x35,
        0xe8, // FLD1
        0xcd,
        0x3a,
        0xc1, // FADDP ST(1),ST
        0xcd,
        0x3d, // FWAIT
        0xcd,
        0x3c,
        0x1d,
        0x1e,
        DATA & 0xff,
        DATA >> 8, // FSTP qword DS:[DATA]
      ]);

      run(m, 5);

      expect(core.ip).toEqual(17);
      expect(f64(core, DATA)).toEqual(2);
    });

    it('takes the segment from the byte after INT 3Ch', function () {
      const { m, core } = machine();

      core.es = 0x3000;
      load(core, [
        0xcd,
        0x35,
        0xe8, // FLD1
        0xcd,
        0x3c,
        0xdd,
        0x1e,
        DATA & 0xff,
        DATA >> 8, // FSTP qword ES:[DATA]
      ]);
      run(m, 2);

      const bytes = Array.from({ length: 8 }, (_, i) => core.read8(0x3000, DATA + i));

      expect(new DataView(new Uint8Array(bytes).buffer).getFloat64(0, true)).toEqual(1);
      expect(f64(core, DATA)).toEqual(0);
    });

    it('leaves what it does not emulate, and marks it', function () {
      const { m, core, system } = machine();

      load(core, [0xcd, 0x35, 0xd0]); // FNOP
      run(m, 1);

      expect(core.ip).toEqual(3);
      expect(floatingStateOf(system).status & 0x40).toEqual(0x40);
    });
  });

  describe('__FPMATH', () => {
    const call = (system: any, bx: number, ax = 0) => {
      const core = system.machine.cpu.core;

      core.bx = bx;
      core.ax = ax;
      FPMATH.call(system);

      return { ax: core.ax, dx: core.dx };
    };

    it('starts with the control word 1332h, the unit 1330h', function () {
      const { system } = machine();

      call(system, 0);
      expect(call(system, 5).ax).toEqual(0x1332);
      expect(system.machine.cpu.core._fpu.control).toEqual(0x1330);
    });

    it('says whether there is a coprocessor', function () {
      expect(call(machine(true).system, 11).ax).toEqual(1);
      expect(call(machine(false).system, 11).ax).toEqual(0);
    });

    it('answers FFFFh past its last function', function () {
      expect(call(machine().system, 13)).toEqual({ ax: 0xffff, dx: 0xffff });
    });
  });
});
