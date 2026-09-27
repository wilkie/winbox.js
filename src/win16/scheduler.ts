'use strict';

import { segmentSelector } from './selectors.js';
import { Types, HWND, WPARAM, LPARAM, UINT, LRESULT } from './types.js';

import { User } from './user.js';

/**
 * Represents the system scheduler.
 *
 * This manages all entrypoints and calls into applications. This is responsible
 * for running, pausing, and hitting callbacks for the application.
 */
export class Scheduler {
  declare _currentTask: any;
  declare _nextFrame: any;
  declare _cycles: any;
  declare _frameStart: any;
  declare _machine: any;
  declare _modules: any;
  declare _running: any;
  declare _tasks: any;
  declare _onError: any;
  /** The system's handles, to find a window's own procedure. */
  declare handles: any;

  constructor(machine, modules, options: any = {}) {
    this._tasks = {};
    this._machine = machine;
    this._modules = modules;
    this._running = false;
    this._cycles = 0;
    this._frameStart = new Date().getTime();

    /* How the next slice of guest execution gets scheduled.
     *
     * In a browser this is the animation frame, which is what keeps the guest
     * from starving the page. Nothing else about scheduling needs a browser,
     * though, and requiring one meant a task could not be run anywhere else --
     * not from a test, not from a script, not from the recorder. So the driver
     * is injectable and falls back to a timer when there is no window.
     */
    this._nextFrame = options.nextFrame ?? Scheduler.defaultFrameDriver();

    /* Where a failure goes when there is nobody on the stack to catch it.
     *
     * An API call that suspends its task resumes it from a promise callback,
     * and an exception there has no caller: it becomes an unhandled rejection,
     * the task never resumes, and the program stops with nothing said about
     * why. Anything watching gets told instead.
     */
    this._onError = options.onError ?? null;

    this._currentTask = null;
  }

  /**
   * The frame driver to use when the caller has no opinion.
   *
   * @returns {Function} A function that schedules a callback.
   */
  static defaultFrameDriver() {
    const host: any = globalThis as any;

    if (host.window?.requestAnimationFrame) {
      return (callback) => host.window.requestAnimationFrame(callback);
    }

    return (callback) => setTimeout(callback, 0);
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
      // A task that has ended stays ended; nothing resumes it.
      if (this.task.ended) {
        return;
      }

      this.task.yield = false;
      this.task.run();
    }

    this.run();
  }

  onInterrupt(_index, _callback) {}

  /* ---- Several tasks, one processor ----
   *
   * One task's state is in the processor at a time: the owner, `active`. A
   * task gives the processor up only where Windows switches tasks -- as it
   * waits for a message, or for another task to answer one it sent -- and
   * takes it back before it goes on. Those waiting for it are granted it in
   * turn, each with its registers, flags and floating-point unit as it left
   * them. A task that waits for anything else -- a file, say -- keeps it. */

  /** Those waiting for the processor, in turn. */
  declare _waiting: { handle: number; granted: () => void }[];

  /** The processor as a task leaves it. */
  snapshot() {
    const core: any = this._machine.cpu.core;
    const fpu: any = core._fpu;

    return {
      registers: this._machine.cpu.state,
      flags: { ...core._flags },
      fpu: fpu
        ? {
            registers: Float64Array.from(fpu.registers),
            empty: [...fpu.empty],
            status: fpu.status,
            control: fpu.control,
          }
        : null,
    };
  }

  /** The processor as a task left it. */
  restore(saved: any) {
    const core: any = this._machine.cpu.core;

    if (!saved?.registers) {
      /* A task's first state, the registers alone (see `Win16.prepare`), and
       * the direction flag clear, as a program is started with it. */
      this._machine.cpu.state = saved;
      core._flags.direction = false;
      return;
    }

    this._machine.cpu.state = saved.registers;
    Object.assign(core._flags, saved.flags);

    if (saved.fpu && core._fpu) {
      core._fpu.registers.set(saved.fpu.registers);
      core._fpu.empty.splice(0, 8, ...saved.fpu.empty);
      core._fpu.status = saved.fpu.status;
      core._fpu.control = saved.fpu.control;
    }
  }

  /** Gives the processor up: the task's state kept, and the next waiting granted it. */
  release(handle = this._currentTask) {
    const task = this._tasks[handle];

    if (handle !== this._currentTask || !task) {
      return;
    }

    task.halt();
    task.context = this.snapshot();
    this._currentTask = null;
    this.onRelease?.(handle);
    this.grant();
  }

  /** Waits for the processor, and takes it with the task's state as it left it. */
  acquire(handle): Promise<void> {
    if (this._currentTask === handle) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      (this._waiting ??= []).push({ handle, granted: resolve });
      this.grant();
    });
  }

  /** The processor, if nobody has it, to the first waiting for it. */
  grant() {
    if (this._currentTask !== null && this._currentTask !== undefined) {
      return;
    }

    for (;;) {
      const next = (this._waiting ??= []).shift();

      if (!next) {
        return;
      }

      const task = this._tasks[next.handle];

      /* A task that ended while it waited is passed over. */
      if (!task || task.ended) {
        continue;
      }

      this.restore(task.context);
      this._currentTask = next.handle;
      next.granted();

      return;
    }
  }

  /**
   * Waits for something with the processor given up: the task's own state
   * kept meanwhile, and taken back before it goes on.
   */
  async waitReleased<T>(promise: Promise<T>): Promise<T> {
    const handle = this._currentTask;

    this.release(handle);

    try {
      return await promise;
    } finally {
      await this.acquire(handle);
    }
  }

  /**
   * A task ready to start, its first state in its `context`: it runs when it
   * is granted the processor, the first to be if `first`.
   */
  start(handle, first = false) {
    const entry = { handle, granted: () => this.resume(handle) };

    this._waiting ??= [];

    if (first) {
      this._waiting.unshift(entry);
    } else {
      this._waiting.push(entry);
    }

    this.grant();
  }

  /** A task ended: it has the processor no more, and the next is granted it. */
  ended(handle) {
    if (this._currentTask === handle) {
      this._currentTask = null;
    }

    this._waiting = (this._waiting ?? []).filter((entry) => entry.handle !== handle);
    this.grant();
  }

  /** Told of each task giving the processor up (see `Win16`). */
  declare onRelease: ((handle: number) => void) | undefined;

  /**
   * Lets the others run, as `Yield` does: the processor given up and taken
   * back in turn, answering anything sent this task meanwhile.
   */
  async yieldTurn(first: number | null = null) {
    const handle = this._currentTask;

    if (handle === null || handle === undefined) {
      return;
    }

    /* A task named goes first, as `DirectedYield` asks (`tasks2`). */
    if (first) {
      const waiting = (this._waiting ??= []);
      const at = waiting.findIndex((entry) => entry.handle === first);

      if (at > 0) {
        waiting.unshift(...waiting.splice(at, 1));
      }
    }

    /* In line behind every task already waiting, then given up: those run,
     * each until it waits, before this one goes on (`tasks2`). */
    const turn = new Promise<void>((granted) => (this._waiting ??= []).push({ handle, granted }));

    this.release(handle);
    await turn;
    await this.takeSent(this._tasks[handle]);
  }

  /**
   * Waits to be woken -- by a message posted or sent, a paint or a timer, a
   * signal -- with the processor given up, or until `timeout` passes; put in
   * line for the processor as it is woken, and going on when granted it.
   */
  waitForWake(timeout?: number): Promise<void> {
    const handle = this._currentTask;
    const task = this._tasks[handle];

    return new Promise<void>((granted) => {
      let timer: any = null;

      task.onWake = () => {
        if (timer) {
          clearTimeout(timer);
        }

        (this._waiting ??= []).push({ handle, granted });
        this.grant();
      };

      if (timeout !== undefined && timeout !== Infinity) {
        timer = setTimeout(
          () => {
            const wake = task.onWake;

            task.onWake = null;
            wake?.();
          },
          Math.max(0, timeout)
        );
      }

      this.release(handle);
    });
  }

  /** Runs what other tasks have sent this one, in order, on its own state. */
  async takeSent(task) {
    while (task?.sent?.length) {
      const item = task.sent.shift();

      try {
        item.done(await item.run());
      } catch (error) {
        item.done(0);
        this.fail(error);
      }
    }
  }

  /**
   * A window procedure of another task's, called as `SendMessage` calls one:
   * handed to that task, which runs it where it waits for a message, while
   * this one waits -- answering what is sent to it meanwhile -- for the
   * answer.
   */
  async sendAcross(target, run: () => Promise<number>) {
    const task = this._tasks[target];
    const self = this._currentTask;
    const me = this._tasks[self];
    let answer: { value: number } | null = null;
    const done = (value: number) => {
      answer = { value };
      me.signal();
    };

    (task.sent ??= []).push({ run, done });
    task.signal();

    for (;;) {
      await this.waitForWake();

      if (answer) {
        return (answer as { value: number }).value;
      }

      await this.takeSent(me);
    }
  }

  /** The task a window belongs to: the one that made it. */
  windowTask(hwnd) {
    const window = this.handles?.resolve(hwnd);

    return window?.data?.hInstance && this._tasks[window.data.hInstance]
      ? window.data.hInstance
      : 0;
  }

  run() {
    if (this._running) {
      //console.log("already running");
      return;
    }

    this._running = true;
    function step(_elapsed) {
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
            this._nextFrame(step.bind(this));
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

  /**
   * Reports a failure that happened with no caller to raise it to, and stops
   * the task it happened in.
   *
   * @param {Error} error - What went wrong.
   */
  fail(error) {
    if (this._onError) {
      this._onError(error);
    } else {
      console.error('API call failed:', error);
    }

    /* The task cannot continue: it is suspended waiting on a return that is
     * not coming. Ending it is what makes the program stop rather than hang.
     */
    this.task?.end();
  }

  interpretReturnValue(result, returnType) {
    const currentTask = this.active;

    if (result instanceof Promise) {
      // Asynchronous API call
      const asyncCall = result;

      // The result is actually the async callback, so wait for the
      // Promise to resolve.
      asyncCall.then(
        (result) => {
          /* Resuming runs the guest, so anything the guest does next throws
           * here -- inside a promise callback, where an exception would be an
           * unhandled rejection rather than a fault anybody sees.
           */
          try {
            // Actually interpret the proper return result (sets AX/DX, resumes)
            this.interpretReturnValue(result, returnType);
          } catch (error) {
            this.fail(error);
          }
        },
        (error) => {
          /* An API call that fails while suspended used to stop the program
           * dead: the task is halted before every call and resumed by the
           * return, so a rejection meant nothing ever resumed it and the
           * program simply stopped, with no fault raised and nothing to see.
           *
           * Returning zero instead would let the program carry on with an
           * answer we invented, which buys a few hundred more instructions and
           * costs the only evidence of what is actually missing.
           */
          this.fail(error);
        }
      );
    } else if (returnType !== undefined) {
      this.task.popContext();

      // Place top value in DX
      if (Types.sizeof(returnType) > 2) {
        this._machine.cpu.core.dx = (result >> 16) & 0xffff;
      }

      // Place low-word in AX
      this._machine.cpu.core.ax = result & 0xffff;

      // Resume
      this.resume(currentTask);
    } else {
      // Resume (CPU context unchanged)
      this.task.popContext();
      this.resume(currentTask);
    }
  }

  /**
   * Specifically calls into the VM at the given window class' window
   * message procedure.
   */
  async callWndProc(windowClass, hwnd, message, wParam, lParam) {
    /* The window's own procedure, when a program has set one with
     * `SetWindowLong` -- subclassed it -- and otherwise its class's. */
    const own = this.handles?.resolve(hwnd)?.wndProc;

    return await this.callWindowProc(
      own ?? windowClass?.lpfnWndProc,
      hwnd,
      message,
      wParam,
      lParam
    );
  }

  /**
   * A window procedure called: one of USER's own, which is a function here,
   * or a program's, at a far address.
   */
  async callWindowProc(proc, hwnd, message, wParam, lParam) {
    if (typeof proc === 'function') {
      return await proc(hwnd, message, wParam, lParam);
    }

    if (!proc) {
      return 0;
    }

    /* Another task's window: its procedure runs in that task, as Windows
     * switches to it to deliver a message sent. */
    const target = this.windowTask(hwnd);

    if (
      target &&
      this._currentTask !== null &&
      target !== this._currentTask &&
      !this._tasks[target].ended
    ) {
      return this.sendAcross(target, () =>
        this.callWindowProc(proc, hwnd, message, wParam, lParam)
      );
    }

    // Get the function to call and craft that function call and return to the
    // current CS:IP
    const newCS = (proc >> 16) & 0xffff;
    const newIP = proc & 0xffff;

    //console.log("calling wndproc", newCS.toString(16), newIP.toString(16));

    const args = [
      [hwnd, HWND],
      [message, UINT],
      [wParam, WPARAM],
      [lParam, LPARAM],
    ];

    /* USER calls a window procedure with DS and ES the stack's segment --
     * the task's own data, for a program -- and AX the window's instance
     * with its low bit set (`USER.EXE` seg1 `27ad`, `3aa3`). A program's
     * procedure that takes its data segment as it comes in finds its own,
     * even when the message is dispatched from a library's loop: Calendar's,
     * painting behind the common dialog's File Open, read COMMDLG's. */
    const window = this.handles?.resolve(hwnd);
    const instance = window?._createStruct?.hInstance ?? window?.data?.hInstance ?? 0;
    const ss = this._machine.cpu.core.ss;

    return await this.call(User, newCS, newIP, args, LRESULT, {
      ds: ss,
      es: ss,
      ax: (instance | 1) & 0xffff,
    });
  }

  /** Calls a procedure a program gave, a far pointer, with arguments: a timer's, say. */
  async callProc(proc, args) {
    return await this.call(User, (proc >> 16) & 0xffff, proc & 0xffff, args, LRESULT);
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
  async call(module, segment, offset, args, returnType, registers: Record<string, number> = {}) {
    // Get the memory space for the module
    const loadedModule = this._modules.instanceFor(module.name);
    const moduleSegment = segmentSelector(loadedModule.segment);

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
      let value = arg[0];

      // If there is a struct, we place the struct in stack space and
      // then set the argument to the far pointer of that struct.
      if (value instanceof Array) {
        // We need to place this struct on the stack and place its address
        // into the parameter instead.
        value = value[0];
        stackOffset -= value.structSize;
        value.storeToMemory(this._machine.memory, this._machine.cpu.core.ss >> 3, stackOffset);
        value.loadFromMemory(this._machine.memory, this._machine.cpu.core.ss >> 3, stackOffset);
        /* The program is handed a far pointer: the stack's selector, not the
         * descriptor index the memory is written through. Handed the index, a
         * program that read the structure -- Character Map reads its
         * `CREATESTRUCT` -- loaded a selector that names nothing and faulted. */
        arg[0] = ((this._machine.cpu.core.ss << 16) | stackOffset) >>> 0;
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

    /* Registers the procedure is to find set, as a library's entry point
     * finds its data segment and its instance. */
    for (const [name, value] of Object.entries(registers)) {
      (this._machine.cpu.core as any)[name] = value;
    }

    // Call
    this._machine.cpu.core.cs = moduleSegment;
    this._machine.cpu.core.ip = 0;

    let pendingResolve = null;
    const ret = new Promise((resolve) => {
      pendingResolve = resolve;
    });

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
