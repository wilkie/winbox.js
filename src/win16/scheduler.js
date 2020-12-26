"use strict";

import { Types, HWND, WPARAM, LPARAM, UINT } from './types.js';

import { User, MSG } from './user.js';

/**
 * Represents the system scheduler.
 *
 * This manages all entrypoints and calls into applications. This is responsible
 * for running, pausing, and hitting callbacks for the application.
 */
export class Scheduler {
    constructor(machine, modules) {
        this._tasks = {};
        this._machine = machine;
        this._modules = modules;

        this._dirtySurfaces = [];

        this._currentTask = null;
    }

    pushDirty(surface) {
        if (!this._dirtySurfaces.includes(surface)) {
            this._dirtySurfaces.push(surface);
        }
    }

    /**
     * Returns the current task handle.
     *
     * @return {HINSTANCE} The current task handle.
     */
    get active() {
        return this._currentTask;
    }

    /**
     * Returns the current active task.
     *
     * @return {Task} The current active task.
     */
    get task() {
        return this._tasks[this._currentTask];
    }

    /**
     * Registers the task by its handle.
     */
    register(handle, task) {
        this._tasks[handle] = task;
    }

    /**
     * Places the given task in the scheduler queue by its handle.
     */
    queue(handle) {
        this._currentTask = handle;
    }

    /**
     * Yields the current task and allows other tasks to be scheduled.
     *
     * This will pause the current task until there is a reason to resume the
     * task once more.
     */
    yield() {
        // Stop execution
        if (this.task) {
            this.task.halt();

            // Save context
            this.task.context = this._machine.cpu.state;

            // Reset the return value
            this.task.returnValue = null;
        }
    }

    resume(handle) {
        this.queue(handle);
        this.task.run();
        this.run();
    }

    run() {
        function step(elapsed) {
            try {
                let currentTask = this.task;

                if (currentTask) {
                    /*let last = (new Date).getTime();
                    console.log("step", last);*/

                    // If there is an asynchronous call on the queue, run that
                    let callItem = currentTask.pollCall();
                    while (currentTask.currentCall != callItem) {
                        currentTask.currentCall = callItem;

                        if (callItem instanceof Array && (typeof callItem[0]) === 'string') {
                            // Proper call item
                            let proc = callItem[0];
                            if (proc === 'callWndProc') {
                                this.callWndProc(
                                    callItem[1], callItem[2], callItem[3],
                                    callItem[4], callItem[5], callItem[6],
                                    callItem[7]
                                );
                            }
                        }
                        else {
                            // If there is a tuple, we set the return value registers.
                            if (callItem instanceof Array) {
                                // Interpret return value
                                this.interpretReturnValue(callItem[1], callItem[0]);
                            }
                        }

                        callItem = currentTask.pollCall();
                    }

                    let i = 0;
                    for ( ; i < 50; i++) {
                        if (currentTask.stopped || currentTask.yield) {
                            break;
                        }
                        this._machine.cpu.step();
                    }

                    this._dirtySurfaces.forEach( (surface) => {
                        if (surface.dirty) {
                            surface.update();
                        }
                    });
                    this._dirtySurfaces = [];

                    /*
                    let now = (new Date).getTime();
                    let elapsed = now - last;
                    last = now;
                    console.log(i, "in", elapsed, now);

                    if (elapsed > 1000) {
                        console.log("SLOW");
                    }
                    */

                    currentTask.yield = false;

                    if (!currentTask.stopped) {
                        window.requestAnimationFrame(step.bind(this));
                    }
                }
            }
            catch (e) {
                console.log("error", e);
                return;
            }
        }

        window.requestAnimationFrame(step.bind(this));
    }

    interpretReturnValue(result, returnType) {
        if (result instanceof Array) {
            //console.log("a call dispatch");

            // A call dispatch listing
            // If we are currently within a call, push that context to the
            // pending stack.
            if (this.task.currentCall) {
                this.task.pushPending(this.task.currentCall);
            }

            // Push each call we desire on the call stack (to the top)
            result.reverse().forEach( (callItem) => {
                // Push the call to the active task
                //console.log("pushing", callItem);
                this.task.unpullCall(callItem);
            });
        }
        else if (result === 'call') {
            // We make the callback and postpone the return until the callback
            // returns. The callback is responsible for setting return values.
            this.resume(this.active);
        }
        else if (typeof result === 'function') {
            // We yield and postpone the return until the program starts again.
            this.yield();
            this.task.returnValue = () => {
                let bound = result.bind(this)();

                if (returnType !== undefined) {
                    // Place top value in DX
                    if (Types.sizeof(returnType) > 2) {
                        this._machine.cpu.core.dx = (bound >> 16) & 0xffff;
                    }

                    // Place low-word in AX
                    this._machine.cpu.core.ax = bound & 0xffff;
                }
            };

            // If there is a pending message, just start the task
            // TODO: scheduler can schedule a different task
            if (this.task.peek()) {
                this.resume(this.active);
            }
        }
        else if (returnType !== undefined) {
            // Place top value in DX
            if (Types.sizeof(returnType) > 2) {
                this._machine.cpu.core.dx = (result >> 16) & 0xffff;
            }

            // Place low-word in AX
            this._machine.cpu.core.ax = result & 0xffff;
        }
    }

    /**
     * Specifically calls into the VM at the given window class' window
     * message procedure.
     */
    callWndProc(windowClass, hwnd, message, wParam, lParam, callback, returnType) {
        // Get the function to call and craft that function call and return to the
        // current CS:IP
        let newCS = (windowClass.lpfnWndProc >> 16) & 0xffff;
        let newIP = windowClass.lpfnWndProc & 0xffff;

        let args = [
            [hwnd, HWND], [message, UINT],
            [wParam, WPARAM], [lParam, LPARAM]
        ];

        return this.call(User, newCS, newIP, args, callback, returnType);
    }

    /**
     * Calls into the VM from the given module.
     *
     * It sets up the machine such that the next instruction executed is a
     * stub that calls into the requested function. The stub will signal a
     * syscall (interrupt) when the requested function returns to that stub.
     *
     * The call function also preserves the CPU state prior to the alterations
     * to set up the actual call to the given function. The goal is to make
     * this call without any alteration to the CPU state as though it were
     * a system call.
     *
     * When the function ends, the given callback is executed (if any). If
     * the callback returns a value, that value is interpreted as the return
     * value of the callback routine based on the given returnType (if any).
     *
     * If no returnType is specified, the value is not considered. The CPU
     * state is restored without alteration. If the returnType is specified,
     * however, the CPU state is restored except for the return value registers
     * required to represent the value returned by the callback. How many and
     * which registers depends on the given returnType.
     */
    call(module, segment, offset, args, callback, returnType) {
        // Get the memory space for the module
        let loadedModule = this._modules.instanceFor(module.name);
        let moduleSegment = (loadedModule.segment << 3) | 0x3;

        // Write new immediate for the call
        this._machine.cpu.core.write16(moduleSegment, 1, offset);
        this._machine.cpu.core.write16(moduleSegment, 3, segment);

        // Keep track of the current CS:IP by halting the task
        this.task.halt();

        // Preserve context
        this.task.pushContext(this._machine.cpu.state);

        // Preserve callback
        this.task.pushCallback([callback, returnType]);

        // Set up stack

        // Windows 3.1 seems to allocate its own stack space for this call and
        // places whatever it wants here. It allocates ~0x60 bytes apparently.
        // I would assume it places the calling context there and any data
        // passed to the window procedure.
        // TODO: should we also place calling context there?

        // Allocate context and metadata space
        let stackOffset = this._machine.cpu.core.sp;
        this._machine.cpu.core.sp -= 0x60;

        args.forEach( (arg) => {
            let argType = arg[1];
            let value = arg[0];

            // If there is a struct, we place the struct in stack space and
            // then set the argument to the far pointer of that struct.
            if (value instanceof Array) {
                // We need to place this struct on the stack and place its address
                // into the parameter instead.
                value = value[0];
                stackOffset -= value.structSize;
                let size = value.storeToMemory(this._machine.memory, this._machine.cpu.core.ss >> 3, stackOffset);
                value.loadFromMemory(this._machine.memory, this._machine.cpu.core.ss >> 3, stackOffset);
                arg[0] = ((this._machine.cpu.core.ss >> 3) << 16) | stackOffset;
            }
        });

        args.forEach( (arg) => {
            let argType = arg[1];
            let value = arg[0];

            if (Types.sizeof(argType) <= 2) {
                this._machine.cpu.core.push16(value);
            }
            else if (Types.sizeof(argType) == 4) {
                let lo = (value >> 16) & 0xffff;
                let hi = value & 0xffff;

                this._machine.cpu.core.push16(lo);
                this._machine.cpu.core.push16(hi);
            }
        });

        // Call
        this._machine.cpu.core.cs = moduleSegment;
        this._machine.cpu.core.ip = 0;

        // The task is stopped until it yields
        this.task.run();
    }

    callReturn() {
        //console.log("Callback return");

        // Stop execution
        this.task.halt();

        // Pull the call item off its call stack
        this.task.pullCall();

        // The task is no longer handling a call (unless returning to a
        // prior call)
        this.task.currentCall = null;
        if (this.task.pollCall() == this.task.pollPending()) {
            this.task.currentCall = this.task.popPending();
        }

        // Get the CS:IP from the task
        let context = this.task.popContext();

        // Get the callback
        let callback = this.task.popCallback();

        // Reset CS:IP to the point after the syscall
        this._machine.cpu.state = context;

        //console.log("Resuming at", context.cs >> 3, ":", context.ip);

        // If there is a pending callback, we will call that
        // This callback may request a call into the VM again...
        if (callback[0]) {
            let result = callback[0]();

            this.interpretReturnValue(result, callback[1]);
        }

        // Resume the task
        this.resume(this.active);
    }
}
