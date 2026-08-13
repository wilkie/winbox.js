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
    declare _memory: any;
    declare _syscalls: any;
    /**
     * Initializes a new OS instance for DOS.
     *
     * @param {Machine} machine - The virtual machine instance.
     */
    constructor(machine, options = {}) {
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
    boot() {
    }

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
        console.log("DPMI call", "0x" + this._machine.cpu.core.ax.toString(16));
        this._dpmi.invoke();
        return false;
    }
}
