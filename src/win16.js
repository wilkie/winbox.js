"use strict";

import { Loader } from './loader.js';

// Subsystems
import { Allocator } from './win16/allocator.js';

// The various OS modules
import { Kernel } from './win16/kernel.js';
import { Gdi } from './win16/gdi.js';
import { User, MSG } from './win16/user.js';
import { Types, Struct } from './win16/types.js';

// Kernel calls
import { LocalInit } from './win16/kernel/LocalInit.js';
import { GetTickCount } from './win16/user/GetTickCount.js';

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
    constructor(machine, desktop, options = {}) {
        this._desktop = desktop;
        this._machine = machine;
        this._memory = machine.memory;
        this._startTime = (new Date).getTime();

        // Keep track of all window instances.
        // The '0' index window is the desktop.
        this._windows = [];
        this._windows.push([this._desktop, null]);

        this._classes = {};

        // Register system calls
        machine.cpu.onInterrupt(0x21, this.syscallDOS.bind(this));
        machine.cpu.onInterrupt(0x80, this.syscallInvoke.bind(this));
        machine.cpu.onInterrupt(0x81, this.syscallCallbackReturn.bind(this));

        // Register modules
        this._modules = {};
        this.register(Kernel);
        this.register(Gdi);
        this.register(User);

        // Keep track of the tasks in memory
        this._loaded = {};

        // And the special system segments
        this._segments = {};

        // And the system memory allocator
        this._allocator = new Allocator(this.machine.memory);
    }

    /**
     * Returns the local time when the system was started.
     */
    get startTime() {
        return this._startTime;
    }

    /**
     * Returns the current running task.
     *
     * @return {Task} The current running task.
     */
    get task() {
        return this._currentTask;
    }

    /**
     * Returns the current machine.
     *
     * @return {Machine} The current machine.
     */
    get machine() {
        return this._machine;
    }

    /**
     * Returns the current memory allocator.
     *
     * @return {Allocator} The current memory allocator.
     */
    get allocator() {
        return this._allocator;
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
        this._machine.memory.map(loader.ds >> 3, new DataView(stack.buffer));

        // Allocate a heap to the data segment
        let heapStart = this._machine.memory.sizeOf(loader.ds >> 3);
        let heapEnd = heapStart + executable.neHeader.initialLocalHeapSize;
        LocalInit.bind(this)(loader.ds, heapStart, heapEnd);

        return task;
    }

    run(task) {
        this._currentTask = task;
        let dataSegment = task.loader.segments[(task.loader.ds >> 3) - 1];

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
        this._machine.cpu.es = (programSegment << 3) | 0x3;

        // Set initial context
        task.context = this._machine.cpu.state;
        this.resume(task);
    }



    /**
     * Initializes the task. The program calls this function.
     *
     * Specifically, the Kernel.InitTask function calls this function while the
     * task is currently scheduled.
     */
    initTask() {
        // Get data segment
        let loader = this.task.loader;
        let dataSegment = loader.segments[(loader.ds >> 3) - 1];

        this._machine.cpu.ds = loader.ds;
        this._machine.cpu.bx = 0x81; //
        this._machine.cpu.es = (this.task.programSegment << 3) | 0x3;
        this._machine.cpu.cx = dataSegment.length; // The limit for the stack.
        this._machine.cpu.di = 0x88; // hModule
        this._machine.cpu.dx = User.SW_SHOWNORMAL; // Show the main window

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
        // And return 1 for success
        return 1;
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
                            let segment = module.segment;
                            let offset = module.step * (relocation.ordinal + 1);

                            if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_SEGMENT) {
                                this.writeRelocation16(
                                    relocation, segmentIndex,
                                    (segment << 3) | 0x3
                                );
                            }
                            else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_FARADDR) {
                                this.writeRelocation32(
                                    relocation, segmentIndex,
                                    (segment << 3) | 0x3, offset
                                );
                            }
                            else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_OFFSET) {
                                this.writeRelocation16(
                                    relocation, segmentIndex,
                                    offset
                                );
                            }
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

                    // Get the segment:offset that should be written (if fixed)
                    let segment = relocation.segment;
                    let offset = relocation.targetOffset;

                    // Get the entrypoint for that ordinal (if movable)
                    if (relocation.ordinal) {
                        let entryPoint = task.executable.entryPoints[relocation.ordinal];
                        segment = entryPoint.segment;
                        offset = entryPoint.offset;
                    }

                    // TODO: lookup appropriate segment number

                    if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_SEGMENT) {
                        this.writeRelocation16(
                            relocation, segmentIndex,
                            (segment << 3) | 0x3
                        );
                    }
                    else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_FARADDR) {
                        this.writeRelocation32(
                            relocation, segmentIndex,
                            (segment << 3) | 0x3, offset
                        );
                    }
                    else if (relocation.addressType == Loader.RELOCATION_ADDRESSTYPE_OFFSET) {
                        this.writeRelocation16(
                            relocation, segmentIndex,
                            offset
                        );
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

    /**
     * Registers a window class.
     */
    registerClass(name, windowClass) {
        this._classes[name] = windowClass;
    }

    /**
     * Retrieves the class description based on the given name.
     */
    retrieveClass(name) {
        return this._classes[name];
    }

    /**
     * Registers a window.
     */
    registerWindow(windowInstance, windowClass) {
        this._windows.push([windowInstance, windowClass]);

        let task = this.task;
        let hWnd = this._windows.length - 1;

        // Capture events
        console.log("registering window");
        console.log(windowInstance);
        ['client-mousedown'].forEach( (event) => {
            windowInstance.on(event, (data) => {
                this.createMessage(task, hWnd, event, data);
            });
        });

        // TODO: We probably want a unique id every time in case a window closes.
        return hWnd;
    }

    retrieveWindow(hWnd) {
        return this._windows[hWnd][0];
    }

    retrieveClassFor(hWnd) {
        return this._windows[hWnd][1];
    }

    /**
     * Crafts a message for the given event and pushes it to the given task.
     */
    createMessage(task, hWnd, event, data) {
        let msg = new MSG();
        msg.hwnd = hWnd;

        if (event === 'client-mousedown' ||
            event === 'client-mouseup') {

            // Get the proper message
            if (event === 'client-mousedown') {
                if (data.clicks == 2) {
                    msg.message = [
                        User.WM_LBUTTONDBLCLK,
                        User.WM_MBUTTONDBLCLK,
                        User.WM_RBUTTONDBLCLK
                    ][data.button];
                }
                else {
                    msg.message = [
                        User.WM_LBUTTONDOWN,
                        User.WM_MBUTTONDOWN,
                        User.WM_RBUTTONDOWN
                    ][data.button];
                }
            }
            else {
                msg.message = [
                    User.WM_LBUTTONUP,
                    User.WM_MBUTTONUP,
                    User.WM_RBUTTONUP
                ][data.button];
            }

            // Set flags
            if (data.buttons & 1) {
                msg.wParam |= User.MK_LBUTTON;
            }
            if (data.buttons & 2) {
                msg.wParam |= User.MK_RBUTTON;
            }
            if (data.buttons & 4) {
                msg.wParam |= User.MK_MBUTTON;
            }
            if (data.shift) {
                msg.wParam |= User.MK_SHIFT;
            }
            if (data.control) {
                msg.wParam |= User.MK_CONTROL;
            }

            // Set position
            msg.lParam = (data.x & 0xffff) | ((data.y & 0xffff) << 16)
        }

        // If we have a new message, post it
        if (msg.message != 0) {
            msg.time = GetTickCount.bind(this)();
            task.push(msg);
            this.resume(task);
        }
    }

    moduleFromName(name) {
        return this._modules[name];
    }

    /**
     * The current task yields to the system.
     */
    yield() {
        console.log("Yielding");

        // Stop execution
        this.task.halt();

        // Save context
        this.task.context = this._machine.cpu.state;

        // Reset the return value
        this.task.returnValue = null;
    }

    /**
     * The current task halts.
     */
    halt() {
        this.task.halt();
    }

    /**
     * Resumes execution of the given task.
     */
    resume(task) {
        this.task.halt();
        this._currentTask = task;
        this.task.run();

        function step(elapsed) {
            try {
                for (let i = 0; i < 1000; i++) {
                    if (this._currentTask.stopped) {
                        break;
                    }
                    this._machine.cpu.step();
                }

                if (!this._currentTask.stopped) {
                    window.requestAnimationFrame(step.bind(this));
                }
            }
            catch (e) {
                console.log("error", e);
                return;
            }
        }

        window.requestAnimationFrame(step.bind(this));
    }

    /**
     * Sends a message to the given window.
     */
    send() {
    }

    /**
     * Calls into the VM from the given module.
     */
    call(module, segment, offset, args) {
        // Get the memory space for the module
        let loadedModule = this._loaded[module.name];
        let moduleSegment = loadedModule.segment;

        // Write new immediate for the call
        this.machine.memory.write16(moduleSegment, 1, offset);
        this.machine.memory.write16(moduleSegment, 3, (segment << 3) | 0x3);

        // Keep track of the current CS:IP by halting the task
        this.task.halt();

        // Preserve context
        this.task.context = this.machine.cpu.state;

        // Set up stack
        args.forEach( (arg) => {
            let argType = arg[1];
            let value = arg[0];

            if (Types.sizeof(argType) <= 2) {
                this._machine.cpu.push16(value);
            }
            else if (Types.sizeof(argType) == 4) {
                let lo = (value >> 16) & 0xffff;
                let hi = value & 0xffff;

                this._machine.cpu.push16(lo);
                this._machine.cpu.push16(hi);
            }
        });

        // Call
        this.machine.cpu.cs = (moduleSegment << 3) | 0x3;
        this.machine.cpu.ip = 0;

        return 'call';
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
        // So our craft code fires an interrupt and the position of the
        // instruction pointer tells us the ordinal.
        //
        // int  0x80        // Interrupt
        // retf 0x12        // Return. We need to know the arguments.

        // We know how big the code section needs to be...
        loadedModule.step = 8;

        let code = new Uint8Array(1000 * loadedModule.step);

        // We start after the callback function
        let position = 8;

        // The callback thunk

        // callf
        code[0] = 0x9a; // callf
        code[1] = 0x00; // ip lo
        code[2] = 0x00; // ip hi
        code[3] = 0xff; // cs lo
        code[4] = 0xff; // cs hi

        // int
        code[5] = 0xcd;
        code[6] = 0x81;
        code[7] = 0x00;

        for (let ordinal = 0; ordinal < 1000; ordinal++) {
            let tuple = module.exports[ordinal];
            if (!tuple) {
                tuple = [module.stub, "Unknown", 0];
            }

            let pop = tuple[2] || 0;
            let popl = (pop & 0xff);
            let poph = (pop >> 0xff) & 0xff;

            // INT 0x80
            code[position + 0] = 0xcd;
            code[position + 1] = 0x80;

            // RETF bytes
            code[position + 2] = 0xca;
            code[position + 3] = popl;
            code[position + 4] = poph;

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
        //console.log("invoke! called from:", this._machine.cpu.cs, this._machine.cpu.ip);

        // Get the module from the CS
        let segment = this._machine.cpu.cs >> 3;
        let module = this._segments[segment];

        // Get the ordinal from the step
        let ip = this._machine.cpu.ip & ~(module.step - 1);
        ip = (ip / module.step);

        // We need to subtract 1 since the first ordinal is the callback thunk
        ip--;

        let callerIP = this._memory.read16(
            this._machine.cpu.ss >> 3,
            this._machine.cpu.sp
        );

        let callerCS = this._memory.read16(
            this._machine.cpu.ss >> 3,
            this._machine.cpu.sp + 2
        );

        let functionDefinition = module.instance.exports[ip];

        let implementation = functionDefinition[0];
        let returnType = functionDefinition[4];

        // Craft the arguments from the stack
        let args = functionDefinition[3] || [];
        let offset = 4; // Account for CS:IP on stack
        args = args.reverse().map( (argType) => {
            if (Types.sizeof(argType) <= 2) {
                let read16 = this._memory.read16.bind(this._memory);
                if (Types.signed(argType)) {
                    read16 = this._memory.readSigned16.bind(this._memory);
                }

                let ret = read16(
                    this._machine.cpu.ss >> 3,
                    this._machine.cpu.sp + offset
                );
                offset += 2;
                return ret;
            }
            else if (Types.sizeof(argType) == 4) {
                let lo = this._memory.read16(
                    this._machine.cpu.ss >> 3,
                    this._machine.cpu.sp + offset
                );

                let hi = this._memory.read16(
                    this._machine.cpu.ss >> 3,
                    this._machine.cpu.sp + offset + 2
                );

                offset += 4;

                let pointer = false;
                if (argType instanceof Array) {
                    // This is a pointer of the type inside the array
                    pointer = true;
                    argType = argType[0];
                }

                if (argType.prototype instanceof Struct) {
                    // This is a pointer to a struct
                    if (hi == 0 && lo == 0) {
                        // null pointer
                        return null;
                    }

                    // Read in the struct data
                    let struct = new argType();
                    struct.loadFromMemory(this._memory, hi >> 3, lo);
                    return struct;
                }
                else if (argType == Types.LPCSTR) {
                    // Read string at [ret-hi]:[ret-lo]
                    if (hi == 0 && lo == 0) {
                        // null string
                        return null;
                    }

                    let ret = this._memory.readCString(hi >> 3, lo);
                    return ret;
                }

                return (hi << 16) | (lo & 0xffff);
            }
        }).reverse();

        // Call normal function
        console.log("Calling", module.instance.name, module.instance.exports[ip][1], callerCS.toString(16), ":", callerIP.toString(16), args);

        let result = implementation.bind(this).apply(null, args);
        console.log("result", result, typeof result === 'function');
        if (result === 'call') {
            // We make the callback and postpone the return until the callback
            // returns. The callback is responsible for setting return values.
            this.resume(this.task);
        }
        else if (typeof result === 'function') {
            // We yield and postpone the return until the program starts again.
            this.yield();
            this.task.returnValue = () => {
                let bound = result.bind(this)();

                if (returnType !== undefined) {
                    // Place top value in DX
                    if (Types.sizeof(returnType) > 2) {
                        this._machine.cpu.dx = (bound >> 16) & 0xffff;
                    }

                    // Place low-word in AX
                    this._machine.cpu.ax = bound & 0xffff;
                }
            };
        }
        else if (returnType !== undefined) {
            // Place top value in DX
            if (Types.sizeof(returnType) > 2) {
                this._machine.cpu.dx = (result >> 16) & 0xffff;
            }

            // Place low-word in AX
            this._machine.cpu.ax = result & 0xffff;
        }
    }

    /**
     * This system call happens when a callback completes.
     *
     * Generally, this will yield back to the normal execution of the current
     * task.
     */
    syscallCallbackReturn() {
        console.log("callback return");

        // Get the CS:IP from the task
        let context = this.task.context;

        // Stop execution
        this.task.halt();

        // Reset CS:IP to the point after the syscall
        console.log("back to", context.cs.toString(16), context.ip.toString(16));
        this.machine.cpu.cs = context.cs;
        this.machine.cpu.ip = context.ip;

        // Resume the task
        this.resume(this.task);
    }
}

class Task {
    constructor(executable, loader) {
        this._executable = executable;
        this._loader = loader;
        this._stopped = false;
        this._messages = [];
        this._context = null;
    }

    get context() {
        return this._context;
    }

    set context(value) {
        this._context = value;
    }

    set returnValue(procedure) {
        this._returnValue = procedure;
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

    run() {
        if (this._returnValue) {
            // Call the return value procedure
            this._returnValue();
            this._returnValue = null;
        }

        this._stopped = false;
    }

    halt() {
        this._stopped = true;
    }

    /**
     * Pushes a window message to the message queue.
     */
    push(message) {
        this._messages.push(message);
    }

    /**
     * Returns the next message in the queue or null if empty.
     */
    peek() {
        if (this._messages.length == 0) {
            return null;
        }

        return this._messages[0];
    }

    /**
     * Pulls the oldest message from the queue or returns null if empty.
     */
    pull() {
        if (this._messages.length == 0) {
            return null;
        }

        let ret = this._messages.splice(0, 1)[0];
        return ret;
    }
}

export default Win16;
