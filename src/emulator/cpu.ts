'use strict';

import { I286 } from './core/i286.js';
import { I386 } from './core/i386.js';
import { CpuCore, CpuCoreHost, TrapVector } from './cpu-core.js';

/**
 * This class represents the CPU emulation.
 */
export class CPU implements CpuCoreHost {
  declare _alu: any;
  declare _core: any;
  declare _cycleCount: any;
  declare _instruction: any;
  declare _interrupt: any;
  declare _interruptHandlers: any;
  declare _memory: any;
  declare _interrupts: any;
  declare ax: any;
  declare bp: any;
  declare bx: any;
  declare cs: any;
  declare cx: any;
  declare di: any;
  declare ds: any;
  declare dx: any;
  declare es: any;
  declare f: any;
  declare ip: any;
  declare si: any;
  declare sp: any;
  declare ss: any;
  constructor(memory?, options: any = {}) {
    this._memory = memory;
    this._core = new I386(this);

    this._interruptHandlers = new Array(128);

    this._instruction = {};

    this._interrupt = null;

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
   * Retrieves whether or not an interrupt has been raised and which.
   */
  get interrupt() {
    return this._interrupt;
  }

  /**
   * Raises the given interrupt.
   */
  set interrupt(index) {
    this._interrupt = index;
  }

  /**
   * Retrieves the execution core of the CPU.
   */
  get core(): CpuCore {
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
  /* Register index constants, forwarded from the execution core. Callers need
   * them to use readRegister8 and friends, and cpu.ts and i286.ts import one
   * another, so these are getters rather than assignments evaluated in that
   * cycle.
   */
  static get REGISTER_AL() {
    return I386.REGISTER_AL;
  }

  static get REGISTER_AX() {
    return I386.REGISTER_AX;
  }

  /**
   * Registers the interrupt dispatcher whose vectors this CPU should treat as
   * belonging to the host rather than to guest code.
   */
  set interrupts(manager) {
    this._interrupts = manager;
  }

  /**
   * Whether the host handles this vector itself. Unclaimed vectors dispatch in
   * the guest, through the interrupt table, the way the part would.
   */
  claimsInterrupt(vector) {
    return this._interrupts !== undefined && this._interrupts.has(vector);
  }

  get alu() {
    // The ALU belongs to the execution core; this used to return an unset field.
    return this._core.alu;
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
   * Runs the CPU for the given amount of wall time.
   *
   * Stops when there is an interrupt or when the CPU is told to halt.
   */
  run(period) {
    let time = 0;
    function step(elapsed) {
      time += elapsed;
      for (let i = 0; i < 150; i++) {
        // Step
        this.step();

        // Do it again
        if (time < period) {
          window.requestAnimationFrame(step.bind(this));
        }
      }
    }

    window.requestAnimationFrame(step.bind(this));
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

    try {
      // Fetch / Decode
      const instruction = this.decode(this._instruction);

      // Execute
      this.execute(instruction);
    } catch (e) {
      if (e instanceof MemoryFault) {
        // Already dispatched; the instruction simply does not complete.
      } else if (e instanceof InvalidInstruction) {
        if (e.callback) {
          e.callback();
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    // Just increment the cycle count
    this._cycleCount++;
  }

  /**
   * Decodes the next instruction.
   */
  decode(instruction) {
    return this.core.decode(instruction);
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

/**
 * Raised when a memory operand runs past the end of its segment.
 *
 * The interrupt has already been dispatched by the time this is thrown; it
 * exists to abandon the rest of the instruction, which must not complete.
 */
export class MemoryFault {}

export class InvalidInstruction {
  declare _callback: any;
  declare _instruction: any;
  constructor(instruction, callback?) {
    this._instruction = instruction;
    this._callback = callback;
  }

  get callback() {
    return this._callback;
  }
}

export default CPU;
