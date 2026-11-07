'use strict';

import { DOS } from '../../src/dos.js';
import { Machine, type WindowsMode } from '../../src/emulator/machine.js';
import { GetWinFlags } from '../../src/win16/kernel/GetWinFlags.js';
import {
  compactAnswer,
  freeSpace,
  largestBlock,
  MOST,
} from '../../src/win16/kernel/memory-model.js';
import { exportedConstant } from '../../src/win16/linker.js';

/**
 * A machine's mode, standard or 386 enhanced (`kb/guides/enhanced-mode.md`,
 * phases 1 and 2): what Windows answers by it, as `winflags`, `dpmiver`,
 * `enhmode` and `galimit` recorded it in each mode. As the Rust engine's
 * `crates/winbox-win16/tests/mode.rs`.
 */

/** A machine in a mode, with DOS on it, and its processor. */
function machine(mode?: WindowsMode) {
  const m = new Machine(mode ? { mode } : {});

  new DOS(m);

  return { m, core: m.cpu.core as any };
}

/** An interrupt asked of the machine's handlers, its registers set first. */
function interrupt(m: Machine, vector: number, registers: Record<string, number>) {
  const core: any = m.cpu.core;

  Object.assign(core, registers);
  (m.interrupts as any).dispatch(vector);
  return core;
}

describe("a machine's mode", () => {
  it('is standard unless it is made enhanced', () => {
    expect(new Machine().mode).toBe('standard');
    expect(new Machine({ mode: 'enhanced' }).mode).toBe('enhanced');
  });

  it('is what GetWinFlags and __WINFLAGS say', () => {
    for (const [mode, coprocessor, flags] of [
      ['standard', true, 0x0419],
      ['enhanced', true, 0x0c29],
      ['standard', false, 0x0019],
      ['enhanced', false, 0x0829],
    ] as const) {
      const m = new Machine({ mode, coprocessor });

      expect(GetWinFlags.call({ machine: m })).toBe(flags);
      expect(exportedConstant('KERNEL', 178, m)).toBe(flags);
    }
  });

  it("is told by INT 2Fh 1600h and 1683h in enhanced mode, and 1686h's protected mode in both", () => {
    const standard = machine();
    const enhanced = machine('enhanced');

    expect(interrupt(standard.m, 0x2f, { ax: 0x1600 }).ax).toBe(0x1600);
    expect(interrupt(enhanced.m, 0x2f, { ax: 0x1600 }).ax).toBe(0x0a03);

    expect(interrupt(standard.m, 0x2f, { ax: 0x1683, bx: 0x5a5a }).bx).toBe(0x5a5a);
    expect(standard.core.ax).toBe(0x1683);

    expect(interrupt(enhanced.m, 0x2f, { ax: 0x1683, bx: 0x5a5a }).bx).toBe(1);
    expect(enhanced.core.ax).toBe(0x1600);

    for (const { m } of [standard, enhanced]) {
      expect(interrupt(m, 0x2f, { ax: 0x1686 }).ax).toBe(0);
      expect(interrupt(m, 0x2f, { ax: 0x160a, bx: 0x5a5a }).ax).toBe(0x160a);
    }
  });

  it("is in DPMI's version: a 32-bit host with virtual memory in enhanced mode", () => {
    const standard = interrupt(machine().m, 0x31, { ax: 0x0400, cx: 0x5a5a });
    const enhanced = interrupt(machine('enhanced').m, 0x31, { ax: 0x0400, cx: 0x5a5a });

    expect([standard.ax, standard.bx, standard.cx, standard.dx]).toEqual([
      0x005a, 0x000a, 0x5a04, 0x0870,
    ]);
    expect([enhanced.ax, enhanced.bx, enhanced.cx, enhanced.dx]).toEqual([
      0x005a, 0x0005, 0x5a04, 0x0870,
    ]);
  });

  it('has more memory in enhanced mode, every answer within the limit', () => {
    const asked = (mode: WindowsMode, taken: number) => ({
      machine: new Machine({ mode }),
      allocator: { baseline: 0, held: taken },
    });

    expect(freeSpace(asked('standard', 0))).toBe(0xebb4e0);
    expect(largestBlock(asked('standard', 0))).toBe(0xe34000);
    expect(compactAnswer(asked('standard', 0))).toBe(0xe24000);

    expect(freeSpace(asked('enhanced', 0))).toBe(0x38f5c60);
    expect(largestBlock(asked('enhanced', 0)) >= MOST).toBe(true);
    expect(compactAnswer(asked('enhanced', 0))).toBe(MOST);
    expect(freeSpace(asked('enhanced', 0x100000))).toBe(0x38f5c60 - 0x100000);
  });
});
