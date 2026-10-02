'use strict';

import { clockOf } from '../emulator/clock.js';
import { indexFor, segmentSelector } from './selectors.js';
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
  /** The virtual clock's time when the frame started. */
  declare _frameTime: number;
  declare _machine: any;
  declare _modules: any;
  declare _running: any;
  declare _tasks: any;
  declare _onError: any;
  /** The system's handles, to find a window's own procedure. */
  declare handles: any;
  /** What is called with each message sent before its window procedure is: the hooks (`hooks.ts`). */
  declare sentHook: any;
  /** Looked at between slices of a task's instructions: what has come due (`pollTimeEvents`). */
  declare onSlice: (() => void) | undefined;
  /** Procedures waiting to be called as at interrupt time; see `atInterrupt`. */
  declare _interrupts: { proc: number; args: any[]; key?: unknown }[];
  /** Whether one is being called now. */
  declare _inInterrupt: boolean;

  constructor(machine, modules, options: any = {}) {
    this._tasks = {};
    this._machine = machine;
    this._modules = modules;
    this._running = false;
    this._cycles = 0;
    this._frameStart = new Date().getTime();
    this._frameTime = 0;

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

  /**
   * Calls a program's procedure as Windows calls one at interrupt time --
   * MMSYSTEM's timer events (`mmtime`) -- whatever the task is doing: between
   * two of its instructions as it runs, or, as it waits for a message, as
   * soon as it wakes, which this wakes it to. One at a time, each run to its
   * end, the processor then as it was.
   *
   * Never while the task is stopped inside some other call of the API: that
   * call may be calling the program itself, and two calls made at once
   * would return out of turn.
   *
   * Not recorded: the registers and the stack Windows calls it with; here
   * DS and AX are the stack's segment, as for a hook, and the stack is the
   * task's.
   */
  atInterrupt(proc: number, args: any[], key?: unknown, task?: number) {
    (this._interrupts ??= []).push({ proc, args, key });

    if (task !== undefined) {
      this._tasks[task]?.signal?.();
    }
  }

  /** Takes back the calls waiting that were made with this key. */
  cancelInterrupts(key: unknown) {
    this._interrupts = (this._interrupts ?? []).filter((waiting) => waiting.key !== key);
  }

  /**
   * From the run loop, between two of the task's instructions: calls the
   * next procedure waiting, the task running on after it.
   */
  deliverInterrupt() {
    if (this._inInterrupt || !this._interrupts?.length) {
      return;
    }

    const task = this.task;

    if (!task || task.ended || this._machine.cpu.interrupt !== null) {
      return;
    }

    /* Nor where a call is begun and not yet made: at the far call that
     * opens a module's stub segment (see `call`), whose target another call
     * would write over. The rest of the stubs -- where each call of the API
     * returns to the program -- are as good as the program's own code. */
    const core = this._machine.cpu.core;

    if (core.ip < 5 && this._modules?.fromSegment?.(indexFor(core.cs))) {
      return;
    }

    const { proc, args } = this._interrupts.shift()!;
    const handle = this.active;

    this._inInterrupt = true;
    this.callProc(proc, args, this.stackRegisters()).finally(() => {
      this._inInterrupt = false;
      this.resume(handle);
    });
  }

  /**
   * From inside the API, where it waits and nothing else is under way: calls
   * each procedure waiting, in turn.
   */
  async takeInterrupts() {
    while (!this._inInterrupt && this._interrupts?.length && this.task && !this.task.ended) {
      const { proc, args } = this._interrupts.shift()!;

      this._inInterrupt = true;

      try {
        await this.callProc(proc, args, this.stackRegisters());
      } finally {
        this._inInterrupt = false;
      }
    }
  }

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

    /* With no other task waiting, even once those with a window to paint
     * are woken, the turn comes straight back: the processor's state is not
     * put away and taken out again for nothing. A program polling with
     * `PeekMessage` yields on every call, and that was a sixth of its time. */
    if (!first && !this._waiting?.length) {
      this.onRelease?.(handle);

      if (!this._waiting?.length) {
        await this.takeSent(this._tasks[handle]);
        return;
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
      const clock = clockOf(this._machine);
      let timer: any = null;

      task.onWake = () => {
        if (timer) {
          clock.cancel(timer);
        }

        (this._waiting ??= []).push({ handle, granted });
        this.grant();
      };

      if (timeout !== undefined && timeout !== Infinity) {
        timer = clock.after(timeout, () => {
          const wake = task.onWake;

          task.onWake = null;
          wake?.();
        });
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

    /* Asked from inside a step -- a call answered at once resumes its task
     * from there -- the step already running goes again when it returns,
     * rather than a step inside a step: a program making thousands of calls
     * in a frame went that deep, and past the host's stack. */
    if (this._stepping) {
      this._again = true;
      return;
    }

    this._running = true;
    this.drive();
  }

  /** Steps until nothing asks for another; see `run`. */
  drive() {
    this._stepping = true;

    try {
      do {
        this._again = false;
        this.step();

        if (this._again) {
          this._running = true;
        }
      } while (this._again);
    } finally {
      this._stepping = false;
    }
  }

  /** Whether a step is under way, and whether another was asked for in it. */
  declare _stepping: boolean;
  declare _again: boolean;

  step() {
    try {
      const currentTask = this.task;
      const taskHandle = this.active;
      const fps = 30;
      const freq = Math.floor(1000 / fps) - 5;
      const clock = clockOf(this._machine);

      if (currentTask) {
        let span = 0;

        const max = 500;
        do {
          this._cycles++;

          /* What the clock has come to: on a virtual one, a timer's time
           * passes only as instructions run. */
          clock.tick();

          /* A procedure due at interrupt time comes between two slices
           * of the task's own instructions. */
          this.onSlice?.();

          if (this._interrupts?.length && !this.task.stopped) {
            this.deliverInterrupt();
          }

          const cpu = this._machine.cpu;

          if (cpu._wasm) {
            /* With the Rust core beside it, the slice's rest in one run;
             * counted as the loop below counts, the instruction that
             * raised an interrupt not among them. */
            const ran = cpu.runFor(max - (this._cycles % max));

            if (cpu.interrupt !== null) {
              this._cycles += ran - 1;
              this.task.halt();
            } else {
              this._cycles += ran;
            }
          } else {
            for (; this._cycles % max != 0; this._cycles++) {
              cpu.step();

              if (cpu.interrupt !== null) {
                // Handle interrupt
                //console.log("interrupt", cpu.interrupt.toString(16));
                this.task.halt();
                break;
              }
            }
          }

          /* A frame is a share of the host's time, or, on a virtual
           * clock, a frame of its time, whatever the host's
           * speed: the same run each time. */
          span = clock.virtual
            ? clock.now() - this._frameTime
            : new Date().getTime() - this._frameStart;
        } while (this._cycles % max == 0 && span < (clock.virtual ? 1000 / fps : freq));

        if (!currentTask.stopped) {
          this._frameStart = new Date().getTime();
          this._frameTime = clock.now();
          this._nextFrame(() => this.drive());
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

  interpretReturnValue(result, returnType, caller = this.active) {
    const currentTask = caller;

    /* A caller that ended in the call -- a program's exit -- is answered
     * nothing: another task may have the processor by now. */
    if (!(result instanceof Promise) && this._tasks[currentTask]?.ended) {
      return;
    }

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
            /* The answer goes in the caller's registers: if another task
             * has the processor, the caller waits its turn for it first. */
            const other = this.active;

            if (
              other !== null &&
              other !== undefined &&
              other !== currentTask &&
              this._tasks[currentTask]
            ) {
              this.acquire(currentTask).then(
                () => this.interpretReturnValue(result, returnType, currentTask),
                (error) => this.fail(error)
              );
              return;
            }

            // Actually interpret the proper return result (sets AX/DX, resumes)
            this.interpretReturnValue(result, returnType, currentTask);
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
  async callWndProc(windowClass, hwnd, message, wParam, lParam, sent = true) {
    /* Nothing is sent to a window that is gone: activation's messages to
     * the window that was active, destroyed meanwhile, would otherwise run
     * its procedure with no instance to find its data by. */
    if (hwnd && this.handles && !this.handles.resolve(hwnd)) {
      return 0;
    }

    /* The window's own procedure, when a program has set one with
     * `SetWindowLong` -- subclassed it -- and otherwise its class's. */
    const own = this.handles?.resolve(hwnd)?.wndProc;

    /* A message dispatched, rather than sent, is not the hooks'. */
    if (sent && this.sentHook) {
      ({ message, wParam, lParam } = await this.sentHook(hwnd, message, wParam, lParam));
    }

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
  async callWindowProc(proc, hwnd, message, wParam, lParam, ax?: number) {
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
      /* Taken by that task later: a window destroyed meanwhile is sent
       * nothing. */
      return this.sendAcross(target, async () =>
        this.handles?.resolve(hwnd)
          ? this.callWindowProc(proc, hwnd, message, wParam, lParam, ax)
          : 0
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
      ax: ax ?? (instance | 1) & 0xffff,
    });
  }

  /** Calls a procedure a program gave, a far pointer, with arguments: a timer's, say. */
  async callProc(
    proc,
    args,
    registers: Record<string, number> | ((placed: number[]) => Record<string, number>) = {}
  ) {
    return await this.call(User, (proc >> 16) & 0xffff, proc & 0xffff, args, LRESULT, registers);
  }

  /**
   * The registers USER calls most of a program's procedures with: AX, DS and
   * ES the stack's segment, which is the program's data (`mov ax, ss`; a
   * timer's, a hook's, a dialog's, an enumeration's). A program's exported
   * procedure takes its data segment from AX, so it finds its own without
   * `MakeProcInstance`.
   */
  stackRegisters() {
    const ss = this._machine.cpu.core.ss;

    return { ax: ss, ds: ss, es: ss };
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
  async call(
    module,
    segment,
    offset,
    args,
    returnType,
    registers: Record<string, number> | ((placed: number[]) => Record<string, number>) = {}
  ) {
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

    /* A structure may be given its place: its offset from the stack pointer
     * as the procedure is entered, as GDI's font enumeration lays them out
     * (`enumregs`). The frame is made deep enough to hold them, the
     * arguments and the return address. */
    const placedAt = (arg: any) =>
      arg[0] instanceof Array && typeof arg[0][1] === 'number' ? arg[0][1] : null;
    const placed: number[] = [];
    const structures: { value: any; segment: number; offset: number }[] = [];
    let entry = 0;

    if (args.some((arg) => placedAt(arg) !== null)) {
      const argBytes = args.reduce((total, arg) => total + Types.sizeof(arg[1]), 0);
      const need = Math.max(
        ...args.map((arg) => (placedAt(arg) === null ? 0 : placedAt(arg) + arg[0][0].structSize))
      );
      const frame = (Math.max(need, 0x60 + argBytes + 4) + 1) & ~1;

      entry = (stackOffset - frame) & 0xffff;
      this._machine.cpu.core.sp = entry + 4 + argBytes;
    }

    args.forEach((arg, index) => {
      let value = arg[0];

      // If there is a struct, we place the struct in stack space and
      // then set the argument to the far pointer of that struct.
      if (value instanceof Array) {
        const at = placedAt(arg);

        // We need to place this struct on the stack and place its address
        // into the parameter instead.
        value = value[0];
        stackOffset = at === null ? stackOffset - value.structSize : entry + at;
        placed[index] = stackOffset;
        structures.push({ value, segment: this._machine.cpu.core.ss >> 3, offset: stackOffset });
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
    for (const [name, value] of Object.entries(
      typeof registers === 'function' ? registers(placed) : registers
    )) {
      (this._machine.cpu.core as any)[name] = value;
    }

    // Call
    this._machine.cpu.core.cs = moduleSegment;
    this._machine.cpu.core.ip = 0;

    let pendingResolve = null;
    const ret = new Promise((resolve) => {
      pendingResolve = resolve;
    });

    this.task.pushCall([pendingResolve, returnType, structures]);

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

    /* The structures the procedure was handed, read back as it left them:
     * a window procedure may change the `WINDOWPOS` of
     * `WM_WINDOWPOSCHANGING`, and the move is then made as it says
     * (documented). Read before anything else can use that stack. */
    for (const { value, segment, offset } of call?.[2] ?? []) {
      value.loadFromMemory(this._machine.memory, segment, offset);
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
