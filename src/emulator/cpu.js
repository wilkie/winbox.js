"use strict";

import { I286 } from './core/i286.js';
import { I386 } from './core/i386.js';

/**
 * This class represents the CPU emulation.
 */
export class CPU {
    constructor(memory, options = {}) {
        this._memory = memory;
        this._core = new I386(this, (index) => {
            this.raiseInterrupt(index);
        });

        this._interruptHandlers = new Array(128);

        this._instruction = {};

        this.reset();
    }

    /**
     * Retrieves the register state.
     */
    get state() {
        return this._core.state;
    }

    set state(value) {
        this._core.state = value;
    }

    /**
     * Retrieves the execution core of the CPU.
     */
    get core() {
        return this._core;
    }

    /**
     * Sets the execution core of the CPU.
     */
    set core(value) {
        this._core = value;
    }

    /**
     * Retrieves the ALU for this CPU.
     */
    get alu() {
        return this._alu;
    }

    /**
     * Retrieves the Memory instance being used by this CPU.
     */
    get memory() {
        return this._memory;
    }

    /**
     * Retrieves the CPU flags.
     */
    get flags() {
        return this._core.flags;
    }

    /**
     * Resets the CPU.
     */
    reset() {
        this._core.reset();

        // Reset cycle count
        this._cycleCount = 0;
    }

    /**
     * Performs a CPU step.
     */
    step() {
        //console.log(this.cs, this.ip, this.bp);
        //if (this.ip == 0x542A) {
            // The drawobject call
            //__console.log("Executing:", this.cs.toString(16), ":", this.ip.toString(16), 'sp:', this.sp.toString(16), 'bp:', this.bp.toString(16), 'ax:', this.ax.toString(16), 'bx:', this.bx.toString(16), 'cx:', this.cx.toString(16), 'dx:', this.dx.toString(16), 'si:', this.si.toString(16));//, this.memory.read16(this.ds >> 3, this.bp + 6).toString(16));
        /*
            let a = this.pop16();
            let b = this.pop16();
            this.push16(b);
            this.push16(a);
            //__console.log("from", a.toString(16), b.toString(16));
        }*/

        // Fetch / Decode
        let instruction = this.decode(this._instruction);

        // Execute
        try {
            this.execute(instruction);
        }
        catch (e) {
            if (e instanceof InvalidInstruction) {
                if (e.callback) {
                    e.callback();
                }
                else {
                    throw(e);
                }
            }
            else {
                throw(e);
            }
        }

        // Just increment the cycle count
        this._cycleCount++;
    }

    /**
     * Decodes the next instruction.
     */
    decode(instruction) {
        return this.core.decode(instruction)
    }

    /**
     * Raises the given interrupt.
     */
    raiseInterrupt(index) {
        if (this._interruptHandlers[index]) {
            this._interruptHandlers[index]();
        }
    }

    /**
     * Allow callbacks to be assigned to particular interrupts.
     */
    onInterrupt(index, callback) {
        this._interruptHandlers[index] = callback;
    }

    /**
     * Executes the instruction.
     */
    execute(instruction) {
        return this.core.execute(instruction);
    }
}

export class InvalidInstruction {
    constructor(instruction, callback) {
        this._instruction = instruction;
        this._callback = callback;
    }

    get callback() {
        return this._callback;
    }
}

export default CPU;
