'use strict';

import { Machine } from '../../src/emulator/machine.js';

/**
 * Divide errors.
 *
 * The conformance oracle cannot cover any of this: it skips every vector whose
 * instruction faults on hardware, which is more than half of the vectors for
 * the divide forms. So the behaviour is pinned here instead.
 *
 * A divide error is interrupt 0, raised when the quotient will not fit the
 * destination -- which includes every divide by zero. The one exception is a
 * signed byte divide whose quotient works out to exactly -128, which the part
 * allows through rather than faulting.
 *
 * Nothing claims vector 0, so it dispatches in the guest: FLAGS, CS and IP are
 * pushed and control vectors through the interrupt table. Being a fault rather
 * than a trap, the pushed address is that of the offending instruction, so the
 * handler could restart it.
 */

/** Where the tests point the divide-error handler. */
const HANDLER_SEGMENT = 0x4000;
const HANDLER_OFFSET = 0x0100;

function machineWith(code: number[], setup: (core: any) => void) {
  const machine = new Machine();
  const cpu = machine.cpu;
  const core = cpu.core;

  core.cs = 0x1000;
  core.ip = 0x0000;
  core.ss = 0x2000;
  core.sp = 0x1000;
  core.ds = 0x1000;

  // Point vector 0 at a handler so the dispatch has somewhere to go.
  machine.memory.write16(core.idtBase + 0, HANDLER_OFFSET);
  machine.memory.write16(core.idtBase + 2, HANDLER_SEGMENT);

  code.forEach((byte, index) => core.write8(core.cs, index, byte));
  setup(core);

  return { machine, cpu, core };
}

/** Asserts that a divide error was taken, and reports the pushed frame. */
function expectDivideError(machine: any, core: any) {
  expect(core.cs).toEqual(HANDLER_SEGMENT);
  expect(core.ip).toEqual(HANDLER_OFFSET);

  return {
    ip: core.read16(core.ss, core.sp),
    cs: core.read16(core.ss, core.sp + 2),
    flags: core.read16(core.ss, core.sp + 4),
  };
}

// F6 /6 and F6 /7 with mod=11, rm=011: the byte divides by BL.
const DIV_BL = [0xf6, 0xf3];
const IDIV_BL = [0xf6, 0xfb];

describe('divide errors', () => {
  describe('DIV', () => {
    it('raises interrupt 0 when dividing by zero', function () {
      const { machine, cpu, core } = machineWith(DIV_BL, (c) => {
        c.ax = 0x1234;
        c.bx = 0x0000;
      });

      cpu.step();

      expectDivideError(machine, core);
    });

    it('raises interrupt 0 when the quotient will not fit', function () {
      // 0xff00 / 2 is 0x7f80, far wider than the byte destination.
      const { machine, cpu, core } = machineWith(DIV_BL, (c) => {
        c.ax = 0xff00;
        c.bx = 0x0002;
      });

      const before = { cs: core.cs, ip: core.ip };
      cpu.step();

      // A fault pushes the address of the instruction that faulted.
      const frame = expectDivideError(machine, core);
      expect(frame.cs).toEqual(before.cs);
      expect(frame.ip).toEqual(before.ip);
    });

    it('does not fault when the quotient fits', function () {
      const { cpu, core } = machineWith(DIV_BL, (c) => {
        c.ax = 0x0064; // 100
        c.bx = 0x0007; // / 7
      });

      cpu.step();

      expect(core.cs).not.toEqual(HANDLER_SEGMENT);
      expect(core.al).toEqual(14);
      expect(core.ah).toEqual(2);
    });
  });

  describe('IDIV', () => {
    it('raises interrupt 0 when dividing by zero', function () {
      const { machine, cpu, core } = machineWith(IDIV_BL, (c) => {
        c.ax = 0x1234;
        c.bx = 0x0000;
      });

      cpu.step();

      expectDivideError(machine, core);
    });

    it('does not fault when the quotient fits', function () {
      const { cpu, core } = machineWith(IDIV_BL, (c) => {
        c.ax = 0xffec; // -20
        c.bx = 0x0003; // / 3
      });

      cpu.step();

      expect(core.cs).not.toEqual(HANDLER_SEGMENT);
      expect(core.al).toEqual(0xfa); // -6, truncated toward zero
      expect(core.ah).toEqual(0xfe); // remainder -2
    });

    it('lets a quotient of exactly -128 through instead of faulting', function () {
      /* Taken from the hardware vectors: this overflows a signed byte, so it
       * ought to fault, and the part returns a result anyway. See the quirk
       * note in ALU#idiv8.
       */
      const { cpu, core } = machineWith(IDIV_BL, (c) => {
        c.ax = 0x81c1;
        c.bx = 0x007c;
      });

      cpu.step();

      expect(core.cs).not.toEqual(HANDLER_SEGMENT);
      expect(core.ax).toEqual(0xc180);
    });
  });
});
