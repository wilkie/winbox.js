'use strict';

import { Machine } from '../../src/emulator/machine.js';
import { CPU } from '../../src/emulator/cpu.js';
import { Memory } from '../../src/emulator/memory.js';

/**
 * Conformance suite for the CpuCore contract in src/emulator/cpu-core.ts.
 *
 * These are the behaviours the Windows 3.1 HLE layer depends on, expressed
 * without reference to any particular core. Any replacement -- a WebAssembly
 * core, a recompiler -- has to pass this file unchanged. Where the current
 * interpreter is known to fall short, the test states the requirement and is
 * marked `.failing`, so the gap is recorded rather than hidden.
 *
 * The TypeScript `implements` clauses on I286 and I386 cover the *shape* of
 * the contract. This file covers the parts a type system cannot check: that
 * traps suspend at an instruction boundary, that execution can be re-entered,
 * and that code caches are invalidated when guest code is rewritten.
 */

/** Assembles at `selector:offset` and points CS:IP at it. */
function loadCode(core, selector: number, offset: number, bytes: number[]) {
  bytes.forEach((byte, index) => core.write8(selector, offset + index, byte));
}

function makeCore() {
  const memory = new Memory();
  const cpu = new CPU(memory);
  const core = cpu.core;

  // Real mode, with a flat-ish segment to scribble in.
  core.cs = 0x1000;
  core.ip = 0x0000;
  core.ss = 0x2000;
  core.sp = 0x1000;
  core.ds = 0x1000;

  return { memory, cpu, core };
}

describe('CpuCore contract', () => {
  describe('invariant 1: traps suspend at an instruction boundary', () => {
    it('latches the vector rather than vectoring through a table', function () {
      const { cpu, core } = makeCore();

      // INT 0x80
      loadCode(core, core.cs, 0x0000, [0xcd, 0x80]);

      expect(cpu.interrupt).toBeNull();
      cpu.step();

      expect(cpu.interrupt).toEqual(0x80);
    });

    it('leaves CS:IP on the instruction after the trap', function () {
      const { cpu, core } = makeCore();

      // INT 0x80 ; RETF 0x0004  -- the shape ModuleManager synthesizes
      loadCode(core, core.cs, 0x0000, [0xcd, 0x80, 0xca, 0x04, 0x00]);

      const codeSegment = core.cs;
      cpu.step();

      // The host has to be able to resume into the RETF that cleans up the
      // arguments, so the trap must not have moved CS or pushed a frame.
      expect(core.cs).toEqual(codeSegment);
      expect(core.ip).toEqual(0x0002);
    });

    it('does not disturb the stack when trapping', function () {
      const { cpu, core } = makeCore();

      loadCode(core, core.cs, 0x0000, [0xcd, 0x80]);

      const stackPointer = core.sp;
      cpu.step();

      // Arguments are marshalled from ss:sp after the trap, so anything the
      // core pushes on the way in would corrupt the read.
      expect(core.sp).toEqual(stackPointer);
    });
  });

  describe('invariant 2: a trap may suspend the guest indefinitely', () => {
    it('keeps state intact across an awaited gap', async function () {
      const { cpu, core } = makeCore();

      loadCode(core, core.cs, 0x0000, [0xcd, 0x80]);

      core.ax = 0x1234;
      core.bx = 0x5678;
      cpu.step();

      // Stand in for an async API implementation resolving several frames on.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(core.ax).toEqual(0x1234);
      expect(core.bx).toEqual(0x5678);
      expect(core.ip).toEqual(0x0002);
    });

    it('resumes execution where it stopped', function () {
      const { cpu, core } = makeCore();

      // INT 0x80 ; MOV AX, 0x4321
      loadCode(core, core.cs, 0x0000, [0xcd, 0x80, 0xb8, 0x21, 0x43]);

      cpu.step();
      cpu.interrupt = null;
      cpu.step();

      expect(core.ax).toEqual(0x4321);
    });
  });

  describe('invariant 3: execution re-enters from the host', () => {
    it('round-trips a state snapshot', function () {
      const { core } = makeCore();

      core.ax = 0x1111;
      core.cs = 0x1000;
      core.ip = 0x0020;
      const context = core.state;

      // The host points the core somewhere else, as Scheduler#call does.
      core.ax = 0x9999;
      core.cs = 0x3000;
      core.ip = 0x0000;

      core.state = context;

      expect(core.ax).toEqual(0x1111);
      expect(core.cs).toEqual(0x1000);
      expect(core.ip).toEqual(0x0020);
    });

    it.failing('carries FLAGS in the state snapshot', function () {
      const { core } = makeCore();

      core.f = 0x0001; // carry set
      const context = core.state;

      core.f = 0x0000;
      core.state = context;

      // Known gap: neither core includes FLAGS in `state`, so a callback's
      // flag results leak back into the code the host interrupted.
      expect(core.f & 0x0001).toEqual(0x0001);
    });
  });

  describe('invariant 4: guest code is modified while it runs', () => {
    it('observes a rewritten instruction on the next execution', function () {
      const { cpu, core } = makeCore();

      // The callback thunk: CALLF seg:off, with the immediate patched by the
      // host before every use.
      loadCode(core, core.cs, 0x0000, [0x9a, 0x00, 0x00, 0x00, 0x30, 0xcd, 0x81]);

      cpu.step();
      expect(core.cs).toEqual(0x3000);
      expect(core.ip).toEqual(0x0000);

      // Host patches the same four bytes to a different target and re-enters.
      core.cs = 0x1000;
      core.ip = 0x0000;
      core.write16(core.cs, 0x0001, 0x0040);
      core.write16(core.cs, 0x0003, 0x4000);

      cpu.step();

      // A core that cached the decoded instruction, or compiled the block,
      // would still dispatch to 0x3000:0x0000 here.
      expect(core.cs).toEqual(0x4000);
      expect(core.ip).toEqual(0x0040);
    });
  });

  describe('shape', () => {
    it('exposes everything the HLE layer marshals through', function () {
      const machine = new Machine();
      const core = machine.cpu.core;

      const required = [
        'ax',
        'bx',
        'cx',
        'dx',
        'si',
        'di',
        'bp',
        'sp',
        'ip',
        'al',
        'ah',
        'bl',
        'bh',
        'cl',
        'ch',
        'dl',
        'dh',
        'cs',
        'ds',
        'es',
        'ss',
        'f',
        'flags',
        'msw',
        'gdtBase',
        'gdtLimit',
        'ldtBase',
        'ldtLimit',
        'idtBase',
        'idtLimit',
        'cpl',
        'eax',
        'ebx',
        'ecx',
        'edx',
        'esi',
        'edi',
        'ebp',
        'esp',
        'eip',
        'fs',
        'gs',
        'cr0',
        'cr1',
        'cr2',
        'cr3',
        'state',
        'memory',
      ];

      const methods = [
        'readRegister8',
        'writeRegister8',
        'readRegister16',
        'writeRegister16',
        'readRegister32',
        'writeRegister32',
        'readSegmentRegister',
        'writeSegmentRegister',
        'translateAddress',
        'read8',
        'read16',
        'read32',
        'readSigned8',
        'readSigned16',
        'readSigned32',
        'write8',
        'write16',
        'write32',
        'push8',
        'pop8',
        'push16',
        'pop16',
        'push32',
        'pop32',
        'decode',
        'execute',
        'reset',
      ];

      required.forEach((member) => {
        expect(member in core).toBe(true);
      });

      methods.forEach((method) => {
        expect(typeof core[method]).toEqual('function');
      });
    });

    it('provides the host surface a core needs', function () {
      const machine = new Machine();

      expect('interrupt' in machine.cpu).toBe(true);
      expect(machine.cpu.memory).toBeDefined();
      expect(typeof machine.interrupts.on).toEqual('function');
      expect(typeof machine.interrupts.dispatch).toEqual('function');
    });
  });
});
