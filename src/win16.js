"use strict";

// Task
import { Task } from './win16/task.js';

// Subsystems
import { Allocator } from './win16/allocator.js';
import { Loader } from './win16/loader.js';
import { Linker } from './win16/linker.js';
import { Scheduler } from './win16/scheduler.js'

// Managers
import { ModuleManager } from './win16/module-manager.js';
import { HandleManager } from './win16/handle-manager.js';
import { WindowManager } from './win16/window-manager.js';
import { FontManager } from './win16/font-manager.js';

// The various OS modules
import { Kernel } from './win16/kernel.js';
import { Gdi } from './win16/gdi.js';
import { User, MSG } from './win16/user.js';
import { Types, Struct, VARIADIC,
         HWND, WPARAM, LPARAM, UINT } from './win16/types.js';

// Kernel calls
import { LocalInit } from './win16/kernel/LocalInit.js';

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

        // Remember the time the machine starts
        this._startTime = (new Date).getTime();

        // Create a handle manager
        this._handles = new HandleManager();

        // Register modules
        this._modules = new ModuleManager(this._memory);
        this._modules.register(Kernel);
        this._modules.register(Gdi);
        this._modules.register(User);

        this._classes = {};

        // Register system calls
        machine.cpu.onInterrupt(0x21, this.syscallDOS.bind(this));
        machine.cpu.onInterrupt(0x80, this.syscallInvoke.bind(this));
        machine.cpu.onInterrupt(0x81, this.syscallCallbackReturn.bind(this));

        // Create a Linker
        this._linker = new Linker(this._memory, this._modules);

        // And the system memory allocator
        this._allocator = new Allocator(this.machine.memory);

        // Load system fonts
        this._fonts = new FontManager();
        this._fonts.add("VGASYS.FON");  // System
        this._fonts.add("VGAOEM.FON");  // Terminal

        // The task scheduler
        this._scheduler = new Scheduler(this._machine, this._modules);

        // Keep track of all window instances.
        // The '0' index window is the desktop.
        this._windows = new WindowManager(this._scheduler, this._handles, this._startTime);
    }

    /**
     * Returns the local time when the system was started.
     */
    get startTime() {
        return this._startTime;
    }

    /**
     * Returns the scheduler instance.
     *
     * @return {Scheduler} The active scheduler.
     */
    get scheduler() {
        return this._scheduler;
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
     * Returns the font manager.
     *
     * @return {FontManager} The font manager.
     */
    get fonts() {
        return this._fonts;
    }

    /**
     * Returns the module manager.
     *
     * @return {ModuleManager} The module manager.
     */
    get modules() {
        return this._modules;
    }

    /**
     * Returns the window manager.
     *
     * @return {WindowManager} The window manager.
     */
    get windows() {
        return this._windows;
    }

    /**
     * Returns the handle manager.
     *
     * @return {HandleManager} The handle manager.
     */
    get handles() {
        return this._handles;
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
     *
     * @return {HINSTANCE} The handle to the loaded task.
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

        let handle = this.handles.allocate(task);
        return handle;
    }

    /**
     * Links the given task.
     */
    link(handle) {
        let task = this.handles.resolve(handle);
        this._linker.link(task);
    }

    run(handle) {
        let task = this.handles.resolve(handle);
        this.scheduler.register(handle, task);
        this.scheduler.queue(handle);
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
        this.resume(handle);
    }



    /**
     * Initializes the task. The program calls this function.
     *
     * Specifically, the Kernel.InitTask function calls this function while the
     * task is currently scheduled.
     */
    initTask() {
        // Get data segment
        let taskHandle = this.scheduler.active;
        let task = this.handles.resolve(taskHandle);
        let loader = task.loader;
        let dataSegment = loader.segments[(loader.ds >> 3) - 1];

        this._machine.cpu.ds = loader.ds;
        this._machine.cpu.bx = 0x81; // Offset to the command line in the PSP
        this._machine.cpu.es = (task.programSegment << 3) | 0x3;
        this._machine.cpu.cx = dataSegment.length; // The limit for the stack.
        this._machine.cpu.di = taskHandle; // the HINSTANCE
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
     * The current task yields to the system.
     */
    yield() {
        this.scheduler.yield();
    }

    /**
     * The current task halts.
     */
    halt() {
        let currentHandle = this.scheduler.active;
        let currentTask = this.handles.resolve(currentHandle);
        if (currentTask) {
            currentTask.halt();
        }
    }

    /**
     * Resumes execution of the given task.
     */
    resume(handle) {
        let currentHandle = this.scheduler.active;
        let currentTask = this.handles.resolve(currentHandle);

        if (currentTask) {
            currentTask.halt();
        }

        let task = this.handles.resolve(handle);
        if (!task) {
            return;
        }

        this._fonts.wait().then( () => {
            this.scheduler.resume(handle);
        });
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
                console.log("Exit. Task halted.");
                this.scheduler.task.halt();
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
        let module = this._modules.fromSegment(segment);

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
        let argList = functionDefinition[3] || [];
        let offset = 4; // Account for CS:IP on stack
        if (argList[argList.length - 1] != VARIADIC) {
            // If it is not a variadic, calling conventions reverse the push
            // order on the stack.
            argList.reverse();
        }

        let args = argList.map( (argType) => {
            if (argType == VARIADIC) {
                // Ignore this for now
            }
            else if (Types.sizeof(argType) <= 2) {
                let read16 = this._memory.read16.bind(this._memory);
                if (Types.signed(argType)) {
                    read16 = this._memory.readSigned16.bind(this._memory);
                }

                let ret = read16(
                    this._machine.cpu.ss >> 3,
                    this._machine.cpu.sp + offset
                );
                offset += 2;

                if (Types.sizeof(argType) == 1) {
                    ret = ret & 0xff;
                }
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

                    let ret = new String(this._memory.readCString(hi >> 3, lo));
                    ret.segment = hi >> 3;
                    ret.offset = lo;
                    return ret;
                }

                return (hi << 16) | (lo & 0xffff);
            }
        });

        if (argList[argList.length - 1] == VARIADIC) {
            // Add a pointer to the stack
            let hi = this._machine.cpu.ss;
            let lo = this._machine.cpu.sp + offset;
            args[args.length - 1] = (hi << 16) | lo;
        }
        else {
            args.reverse();
        }

        // Call normal function
        //console.log("Calling", module.instance.name, module.instance.exports[ip][1], callerCS.toString(16), ":", (callerIP - 5).toString(16), args);

        let result = implementation.bind(this).apply(null, args);
        //console.log("result", result, typeof result === 'function');

        this.scheduler.interpretReturnValue(result, returnType);
    }

    /**
     * This system call happens when a callback completes.
     *
     * Generally, this will yield back to the normal execution of the current
     * task.
     */
    syscallCallbackReturn() {
        this.scheduler.callReturn();
    }
}

export default Win16;
