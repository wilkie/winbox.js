"use strict";

import { CPU } from './cpu.js';
import { Memory } from './memory.js';

/**
 * This class represents the virtual machine.
 *
 * It manages instances to both the memory and CPU and other devices.
 */
export class Machine {
    constructor(options = {}) {
        this._memory = new Memory();
        this._cpu = new CPU(this._memory);
    }

    get memory() {
        return this._memory;
    }

    get cpu() {
        return this._cpu;
    }

    get idtSegment() {
        return this._cpu.idt;
    }

    set idtSegment(value) {
        this._cpu.idt = value;
    }

    run() {
    }
}

export default Machine;
