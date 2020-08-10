"use strict";

import { Loader } from './loader.js';

// The various OS modules
import { Kernel } from './win16/kernel.js';
import { Gdi } from './win16/gdi.js';
import { User } from './win16/user.js';

/**
 * This represents the Windows 16-bit Operating System emulation.
 */
export class Win16 {
    /**
     * Initializes a new OS instance.
     *
     * The operating system manages the system memory and loads executables
     * and libraries.
     */
    constructor(machine, options = {}) {
        this._machine = machine;
        this._memory = machine.memory;

        // Register system calls
        machine.cpu.onInterrupt(0x21, this.syscallDOS.bind(this));
        machine.cpu.onInterrupt(0x80, this.syscallInvoke.bind(this));

        // Register modules
        this._modules = {};
        this.register(Kernel);
        this.register(Gdi);
        this.register(User);
        console.log(this._modules);

        // Keep track of the tasks in memory
        this._loaded = {};

        // And the special system segments
        this._segments = {};
    }

    get task() {
        return this._currentTask;
    }

    /**
     * Loads the given executable into memory as a task.
     */
    load(executable) {
        // A loader parses the executable data for information useful for
        // link/loading the task.
        let loader = new Loader(executable, this._memory);

        // The task encapsulates a running program and its address space.
        let task = new Task(executable, loader);

        // Gather the initial data segment
        let dataSegment = loader.segments[loader.ds - 1];

        // Allocate a stack to the data segment
        let stack = new Uint8Array(executable.neHeader.initialStackSize);
        this._machine.memory.map(loader.ds, new DataView(stack.buffer));

        return task;
    }

    run(task) {
        this._currentTask = task;
        let dataSegment = task.loader.segments[task.loader.ds - 1];

        // We need to allocate an interrupt descriptor table
        let idtSegment = 0xfff0;
        let idtBytes = new Uint8Array(4096);
        this._machine.memory.map(
            idtSegment,
            new DataView(idtBytes.buffer)
        );
        this._machine.idtSegment = idtSegment;

        // We need to allocate a program segment to contain the command line
        // arguments and environment.
        let programSegment = 0xffe;
        let environmentSegment = 0xfff;

        // Allocate 256 bytes for the program segment prefix
        let programSegmentBytes = new Uint8Array(256);
        this._machine.memory.map(
            programSegment,
            new DataView(programSegmentBytes.buffer)
        );

        // Environment variables
        // The environment is a null-terminated series of keys and values.
        let environmentSegmentBytes = new Uint8Array(256);
        this._machine.memory.map(
            environmentSegment,
            new DataView(environmentSegmentBytes.buffer)
        );

        // Set up the program segment prefix.
        // https://en.wikipedia.org/wiki/Program_Segment_Prefix

        // Write INT 0x20 for CP/M exit (lol)
        this._machine.memory.write8(programSegment, 0x0, 0xcd);
        this._machine.memory.write8(programSegment, 0x1, 0x20);

        // Write environment segment
        this._machine.memory.write16(programSegment, 0x2c, environmentSegment);

        // Write command line arguments
        let commandLineLength = 0;
        this._machine.memory.write8(programSegment, 0x80, commandLineLength);

        task.programSegment = programSegment;

        this._machine.cpu.ds = task.loader.ds;
        this._machine.cpu.ss = task.loader.ss;
        this._machine.cpu.sp = dataSegment.length + task.executable.neHeader.initialStackSize;
        this._machine.cpu.cs = task.loader.cs;
        this._machine.cpu.ip = task.loader.ip;
        this._machine.cpu.bx = task.executable.neHeader.initialStackSize;
        this._machine.cpu.cx = task.executable.neHeader.initialLocalHeapSize;
        this._machine.cpu.di = 0x88; // hModule
        this._machine.cpu.si = 0;
        this._machine.cpu.es = programSegment;

        let timer = window.setInterval( () => {
            try {
                if (this.task.stopped) {
                    window.clearInterval(timer);
                }
                else {
                    this._machine.cpu.step();
                }
            }
            catch (e) {
                console.log("error", e);
                window.clearInterval(timer);
            }
        }, 10);
    }

    /**
     * Initializes the task. The program calls this function.
     *
     * Specifically, the Kernel.InitTask function calls this function while the
     * task is currently scheduled.
     */
    initTask() {
        console.log("INIT", this);

        // Get data segment
        let loader = this.task.loader;
        let dataSegment = loader.segments[loader.ds - 1];

        this._machine.cpu.ds = loader.ds;
        this._machine.cpu.bx = 0x81; //
        this._machine.cpu.es = this.task.programSegment; // TODO: Points to the program segment
        this._machine.cpu.cx = dataSegment.length; // The limit for the stack.
        this._machine.cpu.di = 0x88; // hModule

        // Set up the base frame
        this._machine.cpu.bp = this._machine.cpu.sp;

        // Pop the return address
        let retIP = this._machine.cpu.pop16();
        let retCS = this._machine.cpu.pop16();

        // Push a 0x0 to support frame walks.
        this._machine.cpu.push16(0x0);

        // Push the return address again
        this._machine.cpu.push16(retCS);
        this._machine.cpu.push16(retIP);

        // We then return to the program...
        // And return the Program Segment
        // TODO: program segment
        return 0x88;
    }

    /**
     * Writes the relocation data to the indicated memory for a 16-bit value.
     *
     * The value can be an offset or a segment number.
     *
     * @param {Object} relocation - The relocation metadata.
     * @param {number} destinationSegment - The segment to write.
     * @param {number} value - The value to write.
     */
    writeRelocation16(relocation, destinationSegment, value) {
        if (relocation.additive) {
            // Not a relocation chain... just add to the current value
            offset += this._memory.read16(destinationSegment, relocation.offset);
            this._memory.write16(destinationSegment, relocationOffset, value);
        }
        else {
            let nextOffset = relocation.offset;
            let limit = 1000;
            while (limit > 0 && nextOffset != 0xffff) {
                // Get the next offset
                let thisOffset = nextOffset;
                nextOffset = this._memory.read16(destinationSegment, thisOffset)

                // Rewrite the code segment
                this._memory.write16(destinationSegment, thisOffset, value);

                limit--;
            }
        }
    }

    /**
     * Writes the relocation data to the indicated memory for a 32-bit pointer.
     *
     * The 32-bit pointer is provided in each 16-bit part: The segment and
     * offset values.
     *
     * @param {Object} relocation - The relocation metadata.
     * @param {number} destinationSegment - The segment to write.
     * @param {number} segment - The segment to write.
     * @param {number} offset - The offset to write.
     */
    writeRelocation32(relocation, destinationSegment, segment, offset) {
        if (relocation.additive) {
            // Not a relocation chain... just add to the current values
            offset += this._memory.read16(destinationSegment, relocation.offset);
            segment += this._memory.read16(destinationSegment, relocation.offset + 2);
            this._memory.write16(destinationSegment, relocation.offset, offset);
            this._memory.write16(destinationSegment, relocation.offset + 2, segment);
        }
        else {
            let nextOffset = relocation.offset;
            let limit = 1000;
            while (limit > 0 && nextOffset != 0xffff) {
                // Get the next offset
                let thisOffset = nextOffset;
                nextOffset = this._memory.read16(destinationSegment, thisOffset)

                // Rewrite the code segment
                this._memory.write16(destinationSegment, thisOffset, offset);
                this._memory.write16(destinationSegment, thisOffset + 2, segment);

                limit--;
            }
        }
    }

    /**
     * Links the executable.
     */
    link(task) {
        // Go through the relocations and link/load imported modules
        console.log("Linking...");

        // Link each segment relocations
        task.loader.segments.forEach( (segment, i) => {
            // TODO: get the actual segment index
            let segmentIndex = i + 1;
            let relocations = segment.relocations;

            relocations.sort( (a, b) => a.offset - b.offset );

            relocations.forEach( (relocation) => {
                if (relocation.type == Loader.RELOCATION_IMPORT) {
                    let module = this.moduleFromName(relocation.from);

                    if (module) {
                        module = this.loadModule(module);
                        if (relocation.ordinal) {
                            this.writeRelocation32(relocation, segmentIndex, module.segment, module.step * relocation.ordinal);
                        }
                        else {
                            console("HMM");
                        }
                    }
                    else {
                        console.log("WE NEED", relocation.from + ".DLL");
                    }
                }
                else {
                    // Internal relocation
                    console.log("RELOCATION?", "0x" + relocation.offset.toString(16), relocation);

                    // Get the entrypoint for that ordinal
                    let entryPoint = task.executable.entryPoints[relocation.ordinal];

                    // TODO: lookup appropriate segment number

                    if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_SEGMENT) {
                        this.writeRelocation16(relocation, segmentIndex, entryPoint.segment);
                    }
                    else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_FARADDR) {
                        this.writeRelocation32(relocation, segmentIndex, entryPoint.segment, entryPoint.offset);
                    }
                    else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_OFFSET) {
                        this.writeRelocation16(relocation, segmentIndex, entryPoint.offset);
                    }
                }
            });
        });
    }

    /**
     * Register a module as a library.
     */
    register(module) {
        this._modules[module.name] = module;
    }

    moduleFromName(name) {
        return this._modules[name];
    }

    loadModule(module) {
        if (this._loaded[module.name]) {
            return this._loaded[module.name];
        }

        let loadedModule = {
            instance: module,
        };

        // Keep track of it
        this._loaded[module.name] = loadedModule;

        // Assign it a segment
        loadedModule.segment = 4096 + Object.keys(this._loaded).length;

        console.log("loading", module.name, "@", loadedModule.segment, "with", module.exports.length);
        this._segments[loadedModule.segment] = loadedModule;

        // Craft code stubs for each function.
        // Win16 functions are far-called from the running program.
        // So our craft code needs to move the ordinal into a register
        // and fire an interrupt.
        //
        // mov  ax, 0x42    // AX contains the function to call.
        // int  0x80        // Interrupt
        // retf 0x12        // Return. We need to know the arguments.

        // We know how big the code section needs to be...
        loadedModule.step = 8;

        let code = new Uint8Array(1000 * loadedModule.step);

        let position = 0;

        for (let ordinal = 0; ordinal < 1000; ordinal++) {
            let tuple = module.exports[ordinal];
            if (!tuple) {
                tuple = [module.stub, "Unknown", 0];
            }

            let ordl = (ordinal & 0xff);
            let ordh = (ordinal >> 0xff) & 0xff;

            let pop = tuple[2] || 0;
            let popl = (pop & 0xff);
            let poph = (pop >> 0xff) & 0xff;

            // MOV AX, ordinal
            code[position + 0] = 0xb8;
            code[position + 1] = ordl;
            code[position + 2] = ordh;

            // INT 0x80
            code[position + 3] = 0xcd;
            code[position + 4] = 0x80;

            // RETF bytes
            code[position + 5] = 0xca;
            code[position + 6] = popl;
            code[position + 7] = poph;

            // We still skip when there is no implementation.
            position += loadedModule.step;
        }

        // Load the module's code segment
        this._memory.map(loadedModule.segment, new DataView(code.buffer));

        return loadedModule;
    }

    syscallDOS() {
        // A DOS/bios call
        console.log(
            "dos syscall called from:",
            this._machine.cpu.cs,
            this._machine.cpu.ip,
            this._machine.cpu.ah.toString(16)
        );

        switch (this._machine.cpu.ah) {
            case 0x25:  // Set Interrupt Vector
                this._machine.memory.write16(
                    this._machine.idtSegment, this._machine.cpu.al * 4,
                    this._machine.cpu.dx
                );
                this._machine.memory.write16(
                    this._machine.idtSegment, (this._machine.cpu.al * 4) + 2,
                    this._machine.cpu.ds
                );
                break;

            case 0x2a:  // Get System Date
                {
                    let today = new Date();
                    this._machine.cpu.cx = today.getYear();
                    this._machine.cpu.dh = today.getMonth();
                    this._machine.cpu.dl = today.getDate();
                    this._machine.cpu.al = today.getDay();
                }
                break;

            case 0x2c:  // Get System Time
                {
                    let today = new Date();
                    this._machine.cpu.ch = today.getHours();
                    this._machine.cpu.cl = today.getMinutes();
                    this._machine.cpu.dh = today.getSeconds();
                    this._machine.cpu.dl = today.getMilliseconds();
                }
                break;

            case 0x30:  // Get DOS version (We are emulating DOS 6)
                this._machine.cpu.ax = 0x6;
                break;

            case 0x35:  // Get Interrupt Vector
                // TODO: implement a true IDT
                this._machine.cpu.bx = this._machine.memory.read16(
                    this._machine.idtSegment, this._machine.cpu.al * 4
                );
                this._machine.cpu.es = this._machine.memory.read16(
                    this._machine.idtSegment, (this._machine.cpu.al * 4) + 2
                );
                break;

            case 0x4c:  // Exit
                this.task.halt();
                break;

            default:
                console.log(
                    "error: Unknown DOS call",
                    this._machine.cpu.ah.toString(16)
                );
                break;
        }
    }

    syscallInvoke() {
        console.log("invoke! called from:", this._machine.cpu.cs, this._machine.cpu.ip);

        // Get the module from the CS
        let cs = this._machine.cpu.cs;
        let module = this._segments[cs];

        // Get the ordinal from the step
        let ip = this._machine.cpu.ip & ~(module.step - 1);
        ip = (ip / module.step);

        console.log("Calling", module.instance.name, module.instance.exports[ip][1]);

        let implementation = module.instance.exports[ip][0];
        // TODO: some functions may preserve AX if they don't return...
        this._machine.cpu.ax = implementation.bind(this)();
    }
}

class Task {
    constructor(executable, loader) {
        this._executable = executable;
        this._loader = loader;
        this._stopped = false;
    }

    get executable() {
        return this._executable;
    }

    get loader() {
        return this._loader;
    }

    get stopped() {
        return this._stopped;
    }

    get programSegment() {
        return this._programSegment;
    }

    set programSegment(value) {
        this._programSegment = value;
    }

    halt() {
        this._stopped = true;
    }
}

export default Win16;
