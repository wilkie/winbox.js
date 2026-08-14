'use strict';

import { CPU } from './cpu.js';
import { Disk } from './disk.js';
import { Memory } from './memory.js';
import { InterruptManager } from './interrupt-manager.js';
import { FAT16 } from '../file-systems/fat16.js';

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

    /* The CPU needs to know which vectors belong to the host, so that
     * everything else dispatches through the guest's interrupt table.
     */
    this._cpu.interrupts = this._interrupts;

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

  /**
   * Puts a drive image into one of the machine's disks and mounts it.
   *
   * Attaching a filesystem is what makes a disk visible to the guest: `Win16`
   * walks the machine's disks when it starts and gives a drive letter to each
   * one that has a filesystem on it, so this has to happen before the system
   * comes up.
   *
   * @param {Uint8Array} bytes - A raw FAT16 image, starting at sector zero.
   * @param {number} index - Which of the machine's disks to attach it to.
   * @returns {Promise<FAT16>} The mounted filesystem.
   */
  async mountImage(bytes, index = 0) {
    const disk = this._disks[index];

    if (!disk) {
      throw new Error(`no disk ${index} to mount an image on`);
    }

    disk.load(bytes);

    // Constructing it attaches it to the disk; mounting reads its geometry.
    const fileSystem = new FAT16(disk);
    await fileSystem.mount();

    return fileSystem;
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
