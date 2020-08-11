"use strict";

import Helper from '../helper.js';

import { CPU } from '../../src/emulator/cpu.js';

/**
 * Creates a randomized and stubbed CPU instance.
 */
export function MockCPU(flags) {
    let cpu = new CPU();

    // Stub #decode and #execute
    spyOn(cpu, 'decode').and.returnValue({});
    spyOn(cpu, 'execute').and.returnValue({});

    // Assign random flags to the CPU
    cpu.f = flags || Helper.randomInteger(0, 0xffff);

    // Assign random values to registers
    cpu.ax = Helper.randomInteger(0, 0xffff);
    cpu.bx = Helper.randomInteger(0, 0xffff);
    cpu.cx = Helper.randomInteger(0, 0xffff);
    cpu.dx = Helper.randomInteger(0, 0xffff);
    cpu.sp = Helper.randomInteger(0, 0xffff);
    cpu.bp = Helper.randomInteger(0, 0xffff);
    cpu.si = Helper.randomInteger(0, 0xffff);
    cpu.di = Helper.randomInteger(0, 0xffff);
    cpu.es = Helper.randomInteger(0, 0xffff);
    cpu.cs = Helper.randomInteger(0, 0xffff);
    cpu.ss = Helper.randomInteger(0, 0xffff);
    cpu.ds = Helper.randomInteger(0, 0xffff);

    // Assign random instruction pointer
    cpu.ip = Helper.randomInteger(0, 0xffff);
    return cpu;
}
