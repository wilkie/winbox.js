'use strict';

import { Types, HWND, WPARAM, LPARAM, UINT, LRESULT } from './types.js';

import { User, MSG } from './user.js';

/**
 * Represents the system scheduler.
 *
 * This manages all entrypoints and calls into applications. This is responsible
 * for running, pausing, and hitting callbacks for the application.
 */
export class Scheduler {
  declare _currentTask: any;
  declare _cycles: any;
  declare _frameStart: any;
  declare _machine: any;
  declare _modules: any;
  declare _running: any;
  declare _tasks: any;
  constructor(machine, modules) {
    this._tasks = {};
    this._machine = machine;
    this._modules = modules;
    this._running = false;
    this._cycles = 0;
    this._frameStart = new Date().getTime();

    this._currentTask = null;
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
    //console.log('queuing', handle);
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

      // Unschedule the task
      this._currentTask = null;
    }
  }

  resume(handle) {
    this.queue(handle);
    if (this.task) {
      this.task.yield = false;
      this.task.run();
    }
    this.run();
  }

  onInterrupt(index, callback) {}

  run() {
    if (this._running) {
      //console.log("already running");
      return;
    }

    this._running = true;
    function step(elapsed) {
      try {
        const currentTask = this.task;
        const taskHandle = this.active;
        const fps = 30;
        const freq = Math.floor(1000 / fps) - 5;

        if (currentTask) {
          let span = 0;

          const max = 500;
          do {
            this._cycles++;
            for (; this._cycles % max != 0; this._cycles++) {
              this._machine.cpu.step();

              if (this._machine.cpu.interrupt !== null) {
                // Handle interrupt
                //console.log("interrupt", this._machine.cpu.interrupt.toString(16));
                this.task.halt();
                break;
              }
            }

            const now = new Date().getTime();
            span = now - this._frameStart;
          } while (this._cycles % max == 0 && span < freq);

          if (!currentTask.stopped) {
            this._frameStart = new Date().getTime();
            window.requestAnimationFrame(step.bind(this));
            return;
          }
        }

        this._running = false;

        if (this._machine.cpu.interrupt !== null) {
          const index = this._machine.cpu.interrupt;
          this._machine.cpu.interrupt = null;
          const result = this._machine.interrupts.dispatch(index);
          if (result === true) {
            this.resume(taskHandle);
          } else if (result instanceof Promise) {
            result.then((value) => {
              if (value) {
                this.resume(taskHandle);
              }
            });
          }
        }
      } catch (e) {
        console.log(
          'error',
          e,
          this._machine.cpu._instruction.cs.toString(16),
          ':',
          this._machine.cpu._instruction.ip.toString(16)
        );
        throw e;
      }
    }

    step.bind(this)();
  }

  interpretReturnValue(result, returnType) {
    const currentTask = this.active;

    if (result instanceof Promise) {
      // Asynchronous API call
      const asyncCall = result;

      // The result is actually the async callback, so wait for the
      // Promise to resolve.
      asyncCall.then((result) => {
        //console.log("finally", result, this._machine.cpu.core.cs.toString(16), this._machine.cpu.core.ip.toString(16));
        // Actually interpret the proper return result
        // (sets CPU ax/dx/eax, etc)
        this.interpretReturnValue(result, returnType);
      });
    } else if (returnType !== undefined) {
      const context = this.task.popContext();

      // Place top value in DX
      if (Types.sizeof(returnType) > 2) {
        this._machine.cpu.core.dx = (result >> 16) & 0xffff;
      }

      // Place low-word in AX
      this._machine.cpu.core.ax = result & 0xffff;

      const callerIP = this._machine.cpu.core.read16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp
      );

      const callerCS = this._machine.cpu.core.read16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp + 2
      );

      // Resume
      //console.log("popContext (1)", context);
      //console.log("Resuming at", callerIP, callerCS, this._machine.cpu.core.cs.toString(16), ":", this._machine.cpu.core.ip.toString(16));
      this.resume(currentTask);
    } else {
      // Resume (CPU context unchanged)
      const context = this.task.popContext();

      //console.log("popContext (1)", context);

      const callerIP = this._machine.cpu.core.read16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp
      );

      const callerCS = this._machine.cpu.core.read16(
        this._machine.cpu.core.ss,
        this._machine.cpu.core.sp + 2
      );

      //console.log("Resuming at", callerIP, callerCS, this._machine.cpu.core.cs.toString(16), ":", this._machine.cpu.core.ip.toString(16));
      this.resume(currentTask);
    }
  }

  /**
   * Specifically calls into the VM at the given window class' window
   * message procedure.
   */
  async callWndProc(windowClass, hwnd, message, wParam, lParam) {
    // Get the function to call and craft that function call and return to the
    // current CS:IP
    const newCS = (windowClass.lpfnWndProc >> 16) & 0xffff;
    const newIP = windowClass.lpfnWndProc & 0xffff;

    //console.log("calling wndproc", newCS.toString(16), newIP.toString(16));

    const args = [
      [hwnd, HWND],
      [message, UINT],
      [wParam, WPARAM],
      [lParam, LPARAM],
    ];

    return await this.call(User, newCS, newIP, args, LRESULT);
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
   * If no returnType is specified, the value is not considered. The CPU
   * state is restored without alteration. If the returnType is specified,
   * however, the CPU state is restored except for the return value registers
   * required to represent the value returned by the callback. How many and
   * which registers depends on the given returnType.
   */
  async call(module, segment, offset, args, returnType) {
    // Get the memory space for the module
    const loadedModule = this._modules.instanceFor(module.name);
    const moduleSegment = (loadedModule.segment << 3) | 0x3;

    // Write new immediate for the call
    this._machine.cpu.core.write16(moduleSegment, 1, offset);
    this._machine.cpu.core.write16(moduleSegment, 3, segment);

    const handle = this.active;

    // Keep track of the current CS:IP by halting the task
    this.task.halt();

    // Preserve context
    //console.log("pushContext");
    this.task.pushContext(this._machine.cpu.state);

    // Set up stack

    // Windows 3.1 seems to allocate its own stack space for this call and
    // places whatever it wants here. It allocates ~0x60 bytes apparently.
    // I would assume it places the calling context there and any data
    // passed to the window procedure.
    // TODO: should we also place calling context there?

    // Allocate context and metadata space
    let stackOffset = this._machine.cpu.core.sp;
    this._machine.cpu.core.sp -= 0x60;

    args.forEach((arg) => {
      const argType = arg[1];
      let value = arg[0];

      // If there is a struct, we place the struct in stack space and
      // then set the argument to the far pointer of that struct.
      if (value instanceof Array) {
        // We need to place this struct on the stack and place its address
        // into the parameter instead.
        value = value[0];
        stackOffset -= value.structSize;
        const size = value.storeToMemory(
          this._machine.memory,
          this._machine.cpu.core.ss >> 3,
          stackOffset
        );
        value.loadFromMemory(this._machine.memory, this._machine.cpu.core.ss >> 3, stackOffset);
        arg[0] = ((this._machine.cpu.core.ss >> 3) << 16) | stackOffset;
      }
    });

    args.forEach((arg) => {
      const argType = arg[1];
      const value = arg[0];

      if (Types.sizeof(argType) <= 2) {
        this._machine.cpu.core.push16(value);
      } else if (Types.sizeof(argType) == 4) {
        const lo = (value >> 16) & 0xffff;
        const hi = value & 0xffff;

        this._machine.cpu.core.push16(lo);
        this._machine.cpu.core.push16(hi);
      }
    });

    // Call
    this._machine.cpu.core.cs = moduleSegment;
    this._machine.cpu.core.ip = 0;

    let pendingResolve = null;
    const ret = new Promise((resolve) => {
      pendingResolve = resolve;
    });

    while (!pendingResolve) {}
    this.task.pushCall([pendingResolve, returnType]);

    // The task is stopped until it yields
    this.task.run();
    this.resume(handle);

    return ret;
  }

  callReturn() {
    //console.log("returning");
    const currentTask = this.active;

    // Stop execution
    this.task.halt();

    // Pull the callback item off its call stack
    const call = this.task.pullCall();
    //console.log("pulled the call", call);

    // The task is no longer handling a call (unless returning to a
    // prior call)
    this.task.currentCall = null;
    if (this.task.pollCall() == this.task.pollPending()) {
      this.task.currentCall = this.task.popPending();
    }

    // Interpret the result
    let result = 0;
    if (call && call[1]) {
      if (Types.sizeof(call[1]) == 1) {
        result = this._machine.cpu.core.al;
      } else if (Types.sizeof(call[1]) == 2) {
        result = this._machine.cpu.core.ax;
      } else if (Types.sizeof(call[1]) == 4) {
        result = this._machine.cpu.core.ax;
        result |= this._machine.cpu.core.dx << 16;
      }
    }

    // Get the CS:IP from the task
    //console.log("popContext");
    const context = this.task.popContext();

    // Reset CS:IP to the point after the syscall
    if (context != 1) {
      this._machine.cpu.state = context;
    }

    //console.log("Resuming at", this._machine.cpu.core.cs.toString(16), ":", this._machine.cpu.core.ip.toString(16));

    // If there is a pending callback, we will call that
    // This callback may request a call into the VM again...
    if (call) {
      call[0](result);
    }

    // And then resume where we left off
    if (!this.task.pollCall() && !call) {
      this.resume(currentTask);
    }
  }
}
