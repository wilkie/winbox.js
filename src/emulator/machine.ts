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
  declare _cpu: any;
  declare _disks: any;
  declare _interrupts: any;
  declare _memory: any;
  constructor(options = {}) {
    this._memory = new Memory();
    this._cpu = new CPU(this._memory);
    this._interrupts = new InterruptManager();

    // 40MiB disk, 32KiB block size
    this._disks = [new Disk(40 * 1024 * 1024, 512, 32 * 1024)];
  }

  /**
   * Retrieve the interrupt dispatch manager.
   */
  get interrupts() {
    return this._interrupts;
  }

  get memory() {
    return this._memory;
  }

  get cpu() {
    return this._cpu;
  }

  get disks() {
    return this._disks.slice();
  }

  get idtSegment() {
    return this._cpu.idt;
  }

  set idtSegment(value) {
    this._cpu.idt = value;
  }

  addDisk(disk) {
    if (!(disk instanceof Disk)) {
      throw new TypeError('disk must be an instance of object');
    }

    this._disks.append(disk);
  }

  run() {}
}

export default Machine;
