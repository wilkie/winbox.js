'use strict';

import { CPU } from './cpu.js';
import { Disk } from './disk.js';
import { Memory } from './memory.js';
import { InterruptManager } from './interrupt-manager.js';

/**
 * This class represents the virtual machine.
 *
 * It manages instances to both the memory and CPU and other devices.
 */
export class Machine {
  declare _cpu: CPU;
  declare _idtSegment: number;
  declare _disks: Disk[];
  declare _interrupts: InterruptManager;
  declare _memory: Memory;
  constructor(options = {}) {
    this._memory = new Memory();
    this._cpu = new CPU(this._memory);
    this._interrupts = new InterruptManager();

    // 40MiB disk, 32KiB block size
    this._disks = [new Disk(40 * 1024 * 1024, 512, 32 * 1024)];

    // Segment of the interrupt vector table the Win16 layer maps in. The DOS
    // get/set interrupt vector syscalls address it as a segment.
    this._idtSegment = 0;
  }

  /**
   * Retrieve the interrupt dispatch manager.
   */
  get interrupts(): InterruptManager {
    return this._interrupts;
  }

  get memory(): Memory {
    return this._memory;
  }

  get cpu(): CPU {
    return this._cpu;
  }

  get disks() {
    return this._disks.slice();
  }

  get idtSegment(): number {
    return this._idtSegment;
  }

  set idtSegment(value: number) {
    this._idtSegment = value;
  }

  addDisk(disk) {
    if (!(disk instanceof Disk)) {
      throw new TypeError('disk must be an instance of object');
    }

    this._disks.push(disk);
  }

  run() {}
}

export default Machine;
