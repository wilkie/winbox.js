// OS Subsystems
import { FileManager } from './dos/file-manager.js';
import { SyscallManager } from './dos/syscall-manager.js';
import { DPMI } from './dos/dpmi.js';

/**
 * This represents the DOS 16-bit Operating System emulation.
 */
export class DOS {
  declare _dpmi: any;
  declare _files: any;
  declare _machine: any;

  /** Told when a program ends by INT 21h function 4Ch, with its return code. */
  onExit?: (code: number) => void;
  declare _memory: any;
  declare _syscalls: any;
  /**
   * Initializes a new OS instance for DOS.
   *
   * @param {Machine} machine - The virtual machine instance.
   */
  constructor(machine, _options = {}) {
    // Retain the machine instance
    this._machine = machine;

    // Retain a reference to the system memory
    this._memory = machine.memory;

    // Create a file manager
    this._files = new FileManager();

    // Manage system call handlers
    this._syscalls = new SyscallManager(this);
    this._dpmi = new DPMI(this);

    // Attach the system call handler
    machine.interrupts.on(0x1a, this.clockInvoke.bind(this));
    machine.interrupts.on(0x21, this.syscallInvoke.bind(this));
    machine.interrupts.on(0x31, this.dpmiInvoke.bind(this));

    /* The multiplex interrupt, where resident programs answer whether they
     * are installed. None is here: DOS's own handler returns with the
     * registers as they were, which to an installation check -- MSCDEX's,
     * which File Manager makes for every drive -- is "not installed". Without
     * one, the interrupt went through an empty vector into whatever was
     * there. */
    machine.interrupts.on(0x2f, () => true);

    /* Absolute disk reads and writes, which File Manager makes of a drive's
     * boot sector. */
    machine.interrupts.on(0x25, () => this.absoluteDisk(false));
    machine.interrupts.on(0x26, () => this.absoluteDisk(true));
  }

  /**
   * INT 25h and 26h, a volume's sectors read or written by number: AL the
   * drive, 0 for A:; CX the count and DX the first, DS:BX the buffer -- or
   * with CX FFFFh, DS:BX a packet of the first as a long, the count and the
   * buffer's far address. The carry flag says whether it failed, AX why: a
   * drive that is not there answers 8002h, as DOSBox's does. Unlike every
   * other interrupt, these return with the flags still on the stack, which
   * the caller pops. DOS as documented.
   */
  async absoluteDisk(write: boolean) {
    const core = this._machine.cpu.core;
    const letter = String.fromCharCode(0x41 + core.al);
    const fileSystem = this._files.query(letter);
    const disk = fileSystem?.disk;
    let first = core.dx;
    let count = core.cx;
    let segment = core.ds;
    let offset = core.bx;

    if (count === 0xffff) {
      const packet = core.translateAddress(core.ds, core.bx);
      const memory = this._machine.memory;

      first = (memory.read16(packet) | (memory.read16(packet + 2) << 16)) >>> 0;
      count = memory.read16(packet + 4);
      offset = memory.read16(packet + 6);
      segment = memory.read16(packet + 8);
    }

    if (!disk) {
      core.ax = 0x8002;
      core.flags.carry = true;
    } else {
      const size = disk.sectorSize;
      const address = core.translateAddress(segment, offset);
      const memory = this._machine.memory;

      if (write) {
        const bytes = new Uint8Array(count * size);

        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = memory.read8(address + i);
        }

        await disk.write(first, 0, bytes);
      } else {
        const bytes = await disk.read(first, 0, count * size);

        bytes.forEach((byte: number, i: number) => memory.write8(address + i, byte));
      }

      core.flags.carry = false;
    }

    /* The flags stay on the stack. */
    core.sp = (core.sp - 2) & 0xffff;
    core.write16(core.ss, core.sp, core.f);

    return true;
  }

  /**
   * Returns the file manager.
   *
   * @return {FileManager} The file manager.
   */
  get files() {
    return this._files;
  }

  /**
   * Returns an instance of the underlying virtual machine.
   *
   * @return {Machine} The virtual machine.
   */
  get machine() {
    return this._machine;
  }

  /**
   * Returns the syscall manager.
   *
   * @return {SyscallManager} The syscall manager.
   */
  get syscalls() {
    return this._syscalls;
  }

  /**
   * Retrieves the current drive letter.
   */
  get drive() {
    return this.files.drive;
  }

  /**
   * Sets, if possible, the current drive letter to the given drive.
   */
  set drive(letter) {
    this.files.drive = letter;
  }

  /**
   * Retrieves the current path.
   */
  get path() {
    return this.files.path;
  }

  /**
   * Initializes the system.
   */
  boot() {}

  /**
   * Invokes a DOS clock device call based on the current CPU context.
   */
  clockInvoke() {
    return true;
  }

  /**
   * Invokes a DOS system call based on the current CPU context.
   */
  syscallInvoke() {
    // Pass off responsibility to the SyscallManager
    return this.syscalls.invoke();
  }

  /**
   * Invokes a DOS Protected Mode Interface system call.
   */
  dpmiInvoke() {
    console.log('DPMI call', '0x' + this._machine.cpu.core.ax.toString(16));
    this._dpmi.invoke();
    return false;
  }
}
