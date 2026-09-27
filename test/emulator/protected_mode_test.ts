'use strict';

import { Machine } from '../../src/emulator/machine.js';

/**
 * Protected-mode segmentation.
 *
 * The conformance corpus is an 80286 in real mode, so none of this is covered
 * by it -- and protected mode is the only mode the Win16 layer ever runs in.
 * There is no published protected-mode corpus to check against either, so
 * these are hand-built scenarios asserting what a 386 is specified to do.
 *
 * A GDT descriptor is eight bytes:
 *
 *   0-1  limit[15:0]
 *   2-3  base[15:0]
 *   4    base[23:16]
 *   5    P | DPL[1:0] | S | type[3:0]
 *   6    G | D/B | L | AVL | limit[19:16]
 *   7    base[31:24]
 */

const GDT_BASE = 0x10000;
const CODE_SELECTOR = 0x08;
const DATA_SELECTOR = 0x10;

interface Descriptor {
  base: number;
  limit: number;
  present?: boolean;
  dpl?: number;
  granular?: boolean;
  big?: boolean;
  /** The access byte whole, in place of present, DPL and a read/write data segment. */
  access?: number;
}

function writeDescriptor(memory: any, index: number, d: Descriptor) {
  const at = GDT_BASE + index * 8;
  const present = d.present ?? true;
  const dpl = d.dpl ?? 0;

  memory.write16(at + 0, d.limit & 0xffff);
  memory.write16(at + 2, d.base & 0xffff);
  memory.write8(at + 4, (d.base >>> 16) & 0xff);

  // Present, descriptor privilege level, a code/data segment, read/write.
  memory.write8(at + 5, d.access ?? ((present ? 0x80 : 0) | (dpl << 5) | 0x12));

  memory.write8(at + 6, (d.granular ? 0x80 : 0) | (d.big ? 0x40 : 0) | ((d.limit >>> 16) & 0x0f));
  memory.write8(at + 7, (d.base >>> 24) & 0xff);
}

/** A machine in protected mode with a GDT in place. */
function protectedMachine(descriptors: Record<number, Descriptor> = {}) {
  const machine = new Machine();

  /* Descriptor decoding belongs to the 386 core rather than to the boundary
   * the host talks to, so it is reached around the CpuCore interface here.
   */
  const core = machine.cpu.core as any;

  core.gdtBase = GDT_BASE;
  core.gdtLimit = 0xff;

  writeDescriptor(machine.memory, 1, { base: 0x20000, limit: 0xffff });
  writeDescriptor(machine.memory, 2, { base: 0x30000, limit: 0xffff });

  for (const [index, descriptor] of Object.entries(descriptors)) {
    writeDescriptor(machine.memory, Number(index), descriptor);
  }

  core.msw = 1;

  return { machine, core };
}

describe('protected mode', () => {
  describe('descriptor decoding', () => {
    it('decodes a base spread across three fields', function () {
      const { core } = protectedMachine({ 3: { base: 0x12345678, limit: 0xffff } });

      expect(core.retrieveDescriptor(0x18).base).toEqual(0x12345678);
    });

    it('decodes a twenty-bit limit', function () {
      const { core } = protectedMachine({ 3: { base: 0, limit: 0xfabcd } });

      expect(core.retrieveDescriptor(0x18).limit).toEqual(0xfabcd);
    });

    it('reports the descriptor privilege level', function () {
      const { core } = protectedMachine({ 3: { base: 0, limit: 0xffff, dpl: 2 } });

      expect(core.retrieveDescriptor(0x18).dpl).toEqual(2);
    });

    it('reports a segment that is not present', function () {
      const { core } = protectedMachine({ 3: { base: 0, limit: 0xffff, present: false } });

      expect(core.retrieveDescriptor(0x18).present).toBe(false);
    });

    it('reports the default operand size', function () {
      const { core } = protectedMachine({ 3: { base: 0, limit: 0xffff, big: true } });

      expect(core.retrieveDescriptor(0x18).addressSize).toBe(true);
    });

    it('scales a granular limit to bytes', function () {
      /* With the granularity bit set the limit counts 4 KiB units, and the
       * last byte of the final unit is addressable, so a limit of 1 covers
       * offsets up to 0x1FFF.
       */
      const { core } = protectedMachine({ 3: { base: 0, limit: 1, granular: true } });

      expect(core.retrieveDescriptor(0x18).limit).toEqual(0x1fff);
    });
  });

  describe('real mode', () => {
    it('treats the selector as a paragraph number', function () {
      const machine = new Machine();
      const core = machine.cpu.core as any;

      const descriptor = core.retrieveDescriptor(0x1234);

      expect(descriptor.base).toEqual(0x12340);
      expect(descriptor.limit).toEqual(0xffff);
      expect(descriptor.present).toBe(true);
    });

    it('does not read the descriptor table', function () {
      /* Nothing in real mode consults the GDT, so a garbage table register is
       * harmless -- which is the state the machine boots in.
       */
      const machine = new Machine();
      const core = machine.cpu.core as any;

      core.gdtBase = 0xdead0;
      core.gdtLimit = 0;

      expect(() => core.retrieveDescriptor(0x8000)).not.toThrow();
      expect(core.retrieveDescriptor(0x8000).base).toEqual(0x80000);
    });
  });

  describe('translation', () => {
    it('addresses memory through the descriptor base', function () {
      const { machine, core } = protectedMachine();

      core.ds = DATA_SELECTOR;
      machine.memory.write8(0x30000 + 0x40, 0x5a);

      expect(core.read8(DATA_SELECTOR, 0x40)).toEqual(0x5a);
    });

    it('keeps the loaded descriptor when the table entry changes underneath', function () {
      /* The part caches a descriptor when the selector is loaded and does not
       * watch the table afterwards. Software that edits a descriptor has to
       * reload the selector for the change to take effect.
       */
      const { machine, core } = protectedMachine();

      core.ds = DATA_SELECTOR;
      writeDescriptor(machine.memory, 2, { base: 0x50000, limit: 0xffff });

      expect(core.translateAddress(DATA_SELECTOR, 0)).toEqual(0x30000);

      core.ds = DATA_SELECTOR;

      expect(core.translateAddress(DATA_SELECTOR, 0)).toEqual(0x50000);
    });
  });

  describe('faults', () => {
    /** Runs `MOV AL, [BX]` with BX at the given offset. */
    function readThroughBx(machine: any, core: any, offset: number) {
      core.cs = CODE_SELECTOR;
      core.ip = 0;
      core.bx = offset;

      core.write8(CODE_SELECTOR, 0, 0x8a);
      core.write8(CODE_SELECTOR, 1, 0x07);

      machine.cpu.step();
    }

    it('faults when an access runs past the segment limit', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0x00ff } });

      core.ds = 0x18;
      readThroughBx(machine, core, 0x0100); // One byte past a 0x00FF limit.

      expect(machine.cpu.interrupt).toEqual(13);
    });

    it('allows an access that ends exactly on the limit', function () {
      /* The limit is the offset of the segment's last addressable byte, so an
       * access that finishes on it is inside.
       */
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0x00ff } });

      core.ds = 0x18;
      readThroughBx(machine, core, 0x00ff);

      expect(machine.cpu.interrupt).toBeNull();
    });

    it('faults when a null selector is used to reach memory', function () {
      const { machine, core } = protectedMachine();

      core.ds = 0x00;
      readThroughBx(machine, core, 0x0000);

      expect(machine.cpu.interrupt).toEqual(13);
    });

    it('raises a segment-not-present fault when the segment is absent', function () {
      /* The part raises this when the selector is loaded rather than when it
       * is used, which is a check we do not make; what matters here is that a
       * segment marked absent cannot be read through.
       */
      const { machine, core } = protectedMachine({
        3: { base: 0x40000, limit: 0xffff, present: false },
      });

      core.ds = 0x18;
      readThroughBx(machine, core, 0x0000);

      expect(machine.cpu.interrupt).toEqual(11);
    });

    it('raises a stack fault rather than a general protection fault through SS', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0x00ff } });

      core.ss = 0x18;
      core.ds = 0x18;

      core.cs = CODE_SELECTOR;
      core.ip = 0;
      core.bp = 0x0100;

      // MOV AL, [BP] -- addressed through SS by default.
      core.write8(CODE_SELECTOR, 0, 0x8a);
      core.write8(CODE_SELECTOR, 1, 0x46);
      core.write8(CODE_SELECTOR, 2, 0x00);

      machine.cpu.step();

      expect(machine.cpu.interrupt).toEqual(12);
    });

    it('faults on a selector past the end of the table', function () {
      const { machine, core } = protectedMachine();

      /* The table holds 0x100 bytes, so index 0x20 is the first descriptor
       * that does not fit entirely inside it. Loading it aborts the access
       * rather than completing against a descriptor read out of thin air.
       */
      expect(() => core.retrieveDescriptor(0x20 << 3)).toThrow();
      expect(machine.cpu.interrupt).toEqual(13);
    });

    it('accepts the last descriptor the table has room for', function () {
      const { machine, core } = protectedMachine();

      writeDescriptor(machine.memory, 0x1f, { base: 0x70000, limit: 0xffff });

      expect(core.retrieveDescriptor(0x1f << 3).base).toEqual(0x70000);
    });
  });

  describe('expand-down segments', () => {
    /* A stack segment that grows toward zero inverts the check: the limit is
     * the last offset *outside* the segment, and it runs from there up to the
     * top of the address space the D/B bit selects.
     */
    function expandDown(big: boolean) {
      const { machine, core } = protectedMachine();

      const at = GDT_BASE + 3 * 8;
      writeDescriptor(machine.memory, 3, { base: 0x40000, limit: 0x0fff, big });
      // Turn the data segment into an expand-down one.
      machine.memory.write8(at + 5, 0x96);

      core.ds = 0x18;
      return { machine, core };
    }

    it('faults below the limit', function () {
      const { machine, core } = expandDown(false);

      core.cs = CODE_SELECTOR;
      core.ip = 0;
      core.bx = 0x0800;
      core.write8(CODE_SELECTOR, 0, 0x8a);
      core.write8(CODE_SELECTOR, 1, 0x07);

      machine.cpu.step();

      expect(machine.cpu.interrupt).toEqual(13);
    });

    it('allows an access above the limit', function () {
      const { machine, core } = expandDown(false);

      core.cs = CODE_SELECTOR;
      core.ip = 0;
      core.bx = 0x2000;
      core.write8(CODE_SELECTOR, 0, 0x8a);
      core.write8(CODE_SELECTOR, 1, 0x07);

      machine.cpu.step();

      expect(machine.cpu.interrupt).toBeNull();
    });
  });

  describe('accesses that do not go through a ModRM operand', () => {
    /* These are the routes the operand helpers never saw. The check lives in
     * translateAddress now, which every access goes through, so each of them
     * is covered by construction rather than by having been remembered.
     */

    /** A machine whose data segment stops at 0x00FF, code loaded physically. */
    function limited(code: number[]) {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0x00ff } });

      code.forEach((byte, index) => {
        machine.memory.write8((0x20000 + index) >>> 0, byte);
      });

      core.ds = 0x18;
      core.es = 0x18;
      core.cs = CODE_SELECTOR;
      core.ip = 0;

      return { machine, core };
    }

    it('faults on a direct-offset load past the limit', function () {
      // MOV AL, [0x0200] -- the moffs form, which carries its own address.
      const { machine } = limited([0xa0, 0x00, 0x02]);

      machine.cpu.step();

      expect(machine.cpu.interrupt).toEqual(13);
    });

    it('faults on a string operation past the limit', function () {
      // MOVSB, which addresses through ES:DI and DS:SI with no ModRM at all.
      const { machine, core } = limited([0xa4]);

      core.si = 0x0000;
      core.di = 0x0200;

      machine.cpu.step();

      expect(machine.cpu.interrupt).toEqual(13);
    });

    it('faults on a push past the limit', function () {
      const { machine, core } = limited([0x50]); // PUSH AX

      core.ss = 0x18;
      core.sp = 0x0001; // Decrements to 0xFFFF, far outside a 0x00FF limit.

      machine.cpu.step();

      expect(machine.cpu.interrupt).toEqual(12);
    });

    it('faults when instruction fetch runs past the code segment', function () {
      /* A three-byte instruction in a segment with room for two bytes. The
       * first two fetches are inside it and the third is not.
       */
      const { machine, core } = protectedMachine({ 4: { base: 0x60000, limit: 0x0001 } });

      // MOV AL, [BP] -- three bytes, written straight to memory.
      [0x8a, 0x46, 0x00].forEach((byte, index) => {
        machine.memory.write8(0x60000 + index, byte);
      });

      core.cs = 0x20;
      core.ip = 0;

      machine.cpu.step();

      expect(machine.cpu.interrupt).toEqual(13);
    });
  });

  describe('looking at a selector: VERR, VERW, LAR and LSL', () => {
    /* Each reports in the zero flag, and none faults for a selector it cannot
     * use: that is what they are for. The selector is in AX; LAR and LSL
     * answer in BX. */
    const VERR = [0x0f, 0x00, 0xe0];
    const VERW = [0x0f, 0x00, 0xe8];
    const LAR = [0x0f, 0x02, 0xd8];
    const LSL = [0x0f, 0x03, 0xd8];

    function run(machine: any, core: any, code: number[], selector: number, bx = 0x1234) {
      core.cs = CODE_SELECTOR;
      core.ip = 0;
      core.ax = selector;
      core.bx = bx;
      code.forEach((value, at) => core.write8(CODE_SELECTOR, at, value));
      machine.cpu.step();

      expect(machine.cpu.interrupt).toBeNull();

      return core.flags.zero;
    }

    it('finds a read/write data segment readable and writable', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0xff } });

      expect(run(machine, core, VERR, 0x18)).toBe(true);
      expect(run(machine, core, VERW, 0x18)).toBe(true);
    });

    it('finds a read-only data segment readable, not writable', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0xff, access: 0x90 } });

      expect(run(machine, core, VERR, 0x18)).toBe(true);
      expect(run(machine, core, VERW, 0x18)).toBe(false);
    });

    it('finds readable code readable, execute-only code not, and neither writable', function () {
      const { machine, core } = protectedMachine({
        3: { base: 0x40000, limit: 0xff, access: 0x9a },
        4: { base: 0x40000, limit: 0xff, access: 0x98 },
      });

      expect(run(machine, core, VERR, 0x18)).toBe(true);
      expect(run(machine, core, VERW, 0x18)).toBe(false);
      expect(run(machine, core, VERR, 0x20)).toBe(false);
    });

    it('does not check whether the segment is present', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0xff, present: false } });

      expect(run(machine, core, VERR, 0x18)).toBe(true);
    });

    it('clears the zero flag, without a fault, for the null selector and one past the table', function () {
      const { machine, core } = protectedMachine();

      expect(run(machine, core, VERR, 0x00)).toBe(false);
      expect(run(machine, core, VERW, 0x3)).toBe(false);
      expect(run(machine, core, VERR, 0x100)).toBe(false);
      expect(run(machine, core, LSL, 0x100)).toBe(false);
      expect(core.bx).toBe(0x1234);
    });

    it('refuses a segment more privileged than the selector asks from', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0xff, dpl: 0 } });

      expect(run(machine, core, VERR, 0x18 | 3)).toBe(false);
    });

    it('answers what the table holds now, not what a segment register loaded', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0xff } });

      core.es = 0x18;
      writeDescriptor(machine.memory, 3, { base: 0, limit: 0, access: 0x00 });

      expect(run(machine, core, VERR, 0x18)).toBe(false);
    });

    it('loads a limit in bytes with LSL, and a granular one scaled', function () {
      const { machine, core } = protectedMachine({
        3: { base: 0x40000, limit: 0x1234 },
        4: { base: 0x40000, limit: 0x0000f, granular: true },
      });

      expect(run(machine, core, LSL, 0x18)).toBe(true);
      expect(core.bx).toBe(0x1234);
      expect(run(machine, core, LSL, 0x20)).toBe(true);
      expect(core.bx).toBe(0xffff);
    });

    it('loads the access byte into the high byte with LAR', function () {
      const { machine, core } = protectedMachine({ 3: { base: 0x40000, limit: 0xff, access: 0xf2 } });

      expect(run(machine, core, LAR, 0x18 | 3)).toBe(true);
      expect(core.bx).toBe(0xf200);
    });

    it('takes an LDT descriptor with LAR and LSL, but not a call gate with LSL', function () {
      const { machine, core } = protectedMachine({
        3: { base: 0x40000, limit: 0x77, access: 0x82 },
        4: { base: 0, limit: 0, access: 0x84 },
      });

      expect(run(machine, core, LSL, 0x18)).toBe(true);
      expect(core.bx).toBe(0x77);
      expect(run(machine, core, LAR, 0x20)).toBe(true);
      expect(run(machine, core, LSL, 0x20)).toBe(false);
      expect(run(machine, core, VERR, 0x18)).toBe(false);
    });
  });
});
