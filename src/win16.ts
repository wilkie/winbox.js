'use strict';

// File System
import { applicationFault } from './win16/kernel/fault.js';
import { segmentSelector } from './win16/selectors.js';

// Task
import { Task } from './win16/task.js';

// Subsystems
import { GlobalAllocator } from './win16/global-allocator.js';
import { Allocator } from './win16/allocator.js';
import { Loader } from './win16/loader.js';
import { loadLibrariesFor, patchPrologues } from './win16/library.js';
import { DEFAULT_DISPLAY_MODE, displayMode } from './win16/display-modes.js';
import { rasterDesktop } from './win16/user/raster-desktop.js';
import { driverResources } from './win16/user/driver-resources.js';
import { RasterInput } from './win16/user/raster-input.js';
import { RasterWindow } from './win16/user/raster-window.js';
import { DesktopHandle } from './win16/user/desktop-handle.js';
import { killTimersOf } from './win16/user/queue.js';
import { BitmapContext } from './raster/bitmap-context.js';
import { Linker } from './win16/linker.js';
import { Scheduler } from './win16/scheduler.js';

// Managers
import { ModuleManager } from './win16/module-manager.js';
import { HandleManager } from './win16/handle-manager.js';
import { WindowManager } from './win16/window-manager.js';
import { FontManager } from './win16/font-manager.js';
import { fontDirectoryOrder, inDirectoryOrder, trueTypeFileOf } from './win16/font-directory.js';

// The various OS modules
import { Kernel } from './win16/kernel.js';
import { Gdi } from './win16/gdi.js';
import { User } from './win16/user.js';
import { MMSystem } from './win16/mmsystem.js';
import { WinG } from './win16/wing.js';
import { Sound } from './win16/sound.js';
import { Win87EM } from './win16/win87em.js';
import { CommDlg } from './win16/commdlg.js';
import { Keyboard } from './win16/keyboard.js';
import { ToolHelp } from './win16/toolhelp.js';
import { Timer } from './win16/timer.js';
import { MciSeq, MciWave } from './win16/mmsystem/mci-drivers.js';
import { dosCall } from './win16/kernel/FileCdr.js';
import { floatingInterrupt } from './win16/win87em/emulator.js';
import { taskEnvironment } from './win16/task-environment.js';
import { Shell } from './win16/shell.js';

// Other useful types
import { Types, Struct, VARIADIC, UINT, LRESULT } from './win16/types.js';

// Kernel calls
import { LocalInit } from './win16/kernel/LocalInit.js';

import { Surface } from './raster/surface.js';
import { DeviceBitmap } from './raster/device-bitmap.js';
import { DevicePalette } from './raster/device-palette.js';

/**
 * This represents the Windows 16-bit Operating System emulation.
 */
export class Win16 {
  declare _allocator: any;
  declare _classes: any;
  declare _desktopWindow: any;
  declare _dos: any;
  declare _fonts: any;
  declare _globalAllocator: any;
  declare _handles: any;
  declare _linker: any;
  declare _machine: any;
  declare _memory: any;
  declare _modules: any;
  declare _scheduler: any;
  declare _display: any;
  declare _screen: any;
  declare _rasterDesktop: any;
  declare _rasterInput: any;
  declare _onCall: any;
  declare _options: any;
  declare _startTime: any;
  declare _windows: any;
  /**
   * Initializes a new OS instance.
   *
   * The operating system manages the system memory and loads executables
   * and libraries.
   */
  constructor(dos, machine, options = {}) {
    // Retain the DOS instance
    this._dos = dos;

    /* DOS keeps some things for each task, as KERNEL does for it: the disk
     * transfer area. See `find.ts`. */
    dos.currentTask = () => this.scheduler?.task ?? null;

    // A program that ends through DOS ends its task.
    dos.onExit = (code) => this.exitTask(code);

    /* Called for every API call a program makes, when anything is listening.
     * See the dispatcher in `syscallInvoke`.
     */
    this._options = options;
    this._onCall = (options as any).onCall ?? null;

    /* Which display driver we are pretending to be. Everything a program can
     * ask about what it is drawing on comes from this, and the answers are
     * properties of a 1992 driver rather than of the browser we are running
     * in. See win16/display-modes.ts.
     */
    this._display = displayMode((options as any).display ?? DEFAULT_DISPLAY_MODE);

    /* A line and a bold smear are the display driver's to draw, and the drivers
     * do not agree -- see `BitmapContext.driver`. Everything that rasterises
     * reads it from there, so the choice of display has to reach it.
     */
    BitmapContext.driver = this._display;

    // Retain the machine instance
    this._machine = machine;

    // Retain a reference to the system memory
    this._memory = machine.memory;

    // Create a global heap
    this._globalAllocator = new GlobalAllocator(machine.cpu, machine.memory);

    // Remember the time the machine starts
    this._startTime = new Date().getTime();

    // Create a handle manager
    this._handles = new HandleManager();

    // Register modules
    this._modules = new ModuleManager(this._globalAllocator);
    let handle = this._handles.allocate(Kernel);
    this._modules.register(Kernel, handle);
    handle = this._handles.allocate(Gdi);
    this._modules.register(Gdi, handle);
    handle = this._handles.allocate(User);
    this._modules.register(User, handle);
    handle = this._handles.allocate(MMSystem);
    this._modules.register(MMSystem, handle);
    handle = this._handles.allocate(Sound);
    this._modules.register(Sound, handle);
    handle = this._handles.allocate(Win87EM);
    this._modules.register(Win87EM, handle);
    handle = this._handles.allocate(WinG);
    this._modules.register(WinG, handle);
    handle = this._handles.allocate(CommDlg);
    this._modules.register(CommDlg, handle);
    handle = this._handles.allocate(Shell);
    this._modules.register(Shell, handle);
    handle = this._handles.allocate(Keyboard);
    this._modules.register(Keyboard, handle);
    handle = this._handles.allocate(ToolHelp);
    this._modules.register(ToolHelp, handle);
    handle = this._handles.allocate(Timer);
    this._modules.register(Timer, handle);
    handle = this._handles.allocate(MciWave);
    this._modules.register(MciWave, handle);
    handle = this._handles.allocate(MciSeq);
    this._modules.register(MciSeq, handle);

    this._classes = {};

    // Register system calls
    machine.interrupts.on(0x80, this.syscallInvoke.bind(this));

    /* WIN87EM's handlers: the instructions KERNEL makes interrupts of when
     * there is no coprocessor, and the lone `FWAIT`s it makes interrupts of
     * either way. See `win87em/emulator.ts`. */
    for (let vector = 0x34; vector <= 0x3d; vector++) {
      machine.interrupts.on(vector, () => floatingInterrupt(this, vector));
    }

    /* DOS, when a task calls it: KERNEL stands in front of it, as it does on
     * Windows, to tell `FileCdr`'s procedure of files changed. With no task
     * running, DOS alone. */
    machine.interrupts.on(0x21, this.dosInvoke.bind(this));
    machine.interrupts.on(0x81, this.syscallCallbackReturn.bind(this));

    /* One of USER's own window procedures called at its address; see
     * `procToken`. */
    machine.interrupts.on(0x84, this.userProcedureInvoke.bind(this));

    /* A general protection fault in a task: see `applicationFault`. */
    machine.interrupts.on(13, () => this.applicationFault(13));

    // Create a Linker
    this._linker = new Linker(this._memory, this._modules, { coprocessor: machine.coprocessor });

    // And the system memory allocator
    this._allocator = new Allocator(this.machine.memory, this._globalAllocator);

    // Allocate/reload the file-system
    let letter = 'C';
    machine.disks.forEach((disk) => {
      if (disk.fileSystem) {
        // TODO: if it is a floppy disk, we assign starting from "A"
        this._dos._files.mount(letter, disk.fileSystem);
        letter = String.fromCharCode(letter.charCodeAt(0) + 1);
      }
    });

    // Load system fonts
    this._fonts = new FontManager();

    // The task scheduler
    this._scheduler = new Scheduler(this._machine, this._modules, options);

    /* A task giving the processor up: the others with a window due to paint
     * look again (see `RasterInput.wake`). */
    this._scheduler.onRelease = (handle) => this.rasterInput?.wake(handle);
    this._scheduler.handles = this._handles;

    // Keep track of all window instances.
    // The '0' index window is the desktop.
    this._windows = new WindowManager(this._scheduler, this._handles, this._startTime);

    /* The desktop window: the first window there is. */
    this._desktopWindow = new DesktopHandle(this);
    this.handles.allocate(this._desktopWindow);
  }

  /**
   * Brings the system up to the state a program expects to find it in.
   *
   * Loading the fonts is the whole of it so far, and it has to finish before
   * anything runs: a device context comes with the system font already in it,
   * and a program that asks how wide its text will be does so long before it
   * would think to load anything itself.
   *
   * Each font is a file to read, so each load is asynchronous. They were
   * started and not waited for, which meant `boot` returned with nothing
   * loaded and the fonts arrived at whatever point they happened to arrive --
   * usually after the first thing that needed them.
   */
  async boot() {
    const files = await this.files.list('C:\\WINDOWS\\SYSTEM');

    /* In the order GDI's font directory holds them rather than the order the
     * directory listing hands them over, because the mapper's ties go to the
     * earliest entry and nothing else separates two faces with a strike at the
     * height asked for. See `font-directory.ts`. One at a time, too: loading
     * them together left the order to whichever read finished first.
     */
    const profile = async (name) => {
      const windows = await this.files.list('C:\\WINDOWS');
      const file: any = windows.find((one: any) => String(one.name ?? '').toUpperCase() === name);

      if (!file) {
        return null;
      }

      const bytes = new Uint8Array(await file.read(0, file.size));

      return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    };

    const order = fontDirectoryOrder(await profile('SYSTEM.INI'), await profile('WIN.INI'));

    const nameOf = (file: any) => String(file.name ?? '').toUpperCase();
    const byName = new Map(files.map((file: any) => [nameOf(file), file]));
    const loaded = new Set<string>();

    const load = async (name: string) => {
      const file = byName.get(name);

      if (!file || loaded.has(name)) {
        return null;
      }

      loaded.add(name);
      await this._fonts.load(file);

      return file;
    };

    /* A TrueType face is installed as a `.FOT` stub, which goes to the
     * manager first -- its pitch and family are read from it -- and then the
     * `.TTF` it names. The replays install fonts the same way. */
    for (const name of order) {
      const file: any = await load(name);

      if (file && name.endsWith('.FOT')) {
        await load(trueTypeFileOf(new Uint8Array(await file.read(0, file.size)), name));
      }
    }

    const rest = inDirectoryOrder(
      files.filter((file: any) => nameOf(file).endsWith('.FON') && !loaded.has(nameOf(file))),
      order,
      nameOf
    );

    /* Loaded so that a program naming their faces is answered, but not in
     * GDI's table, and so never enumerated. */
    for (const file of rest) {
      await this._fonts.load(file, false);
    }
  }

  /**
   * Logs, when the system was started with logging asked for.
   *
   * A program makes tens of thousands of API calls to do anything at all, so
   * this is off unless someone says otherwise.
   */
  debug(...args) {
    if (this._options?.logCalls) {
      console.log(...args);
    }
  }

  /**
   * The display driver being emulated.
   */
  /**
   * USER's raster desktop, when the page asked for one: every window drawn on
   * `screen`, by USER, from the display driver's OEM bitmaps given as
   * `options.raster.driver`, the display driver's bytes. Without it -- no
   * Windows installation to draw with -- a program makes no windows.
   * See `win16/user/desktop.ts`.
   */
  /** The desktop window's handle. See `desktop-handle.ts`. */
  get desktopWindow() {
    return this.handles.lookup(this._desktopWindow);
  }

  get rasterDesktop() {
    const raster = (this._options as any).raster;

    if (!raster) {
      return null;
    }

    this._rasterDesktop ??= rasterDesktop(
      this,
      raster.driver
        ? driverResources(raster.driver, this._display, raster.user)
        : { oem: raster.oem ?? new Map(), icons: new Map(), cursors: new Set<number>() }
    );

    return this._rasterDesktop;
  }

  /**
   * The running task, ended: what the kernel does when a program ends by
   * INT 21h function 4Ch. The task is never resumed; whatever windows it left
   * are taken off the screen with their timers, and the page is told through
   * `options.onExit`.
   *
   * Its windows go without messages to it. Windows 3.1 destroys a finished
   * task's windows as it ends it; whether their procedures are called then is
   * not recorded, and here there is no program left to call.
   */
  exitTask(code: number) {
    const handle = this.scheduler.active;
    const task = this.handles.resolve(handle);

    if (!task) {
      return;
    }

    task.quitCode = null;

    const desktop = (this._options as any).raster ? this.rasterDesktop : null;

    if (desktop) {
      for (const window of [...desktop.windows]) {
        const owner = window.hwnd ? this.handles.resolve(window.hwnd) : null;

        if (owner instanceof RasterWindow && owner.data?.hInstance === handle) {
          killTimersOf(this, window.hwnd);
          window.visible = window.parent ? false : window.visible;
          desktop.destroy(window);
          this.handles.free(window.hwnd);
        }
      }
    }

    task.end();

    /* The processor to the next task waiting for it, if any. */
    this.scheduler.ended(handle);
    (this._options as any).onExit?.(handle, code);
  }

  /**
   * A task that faulted -- a general protection fault, as a real processor
   * raises for memory reached through the null selector -- shown KERNEL's
   * boxes and ended, or let go on past the instruction; see
   * `kernel/fault.ts`. DOSBox, which the recordings are made under, does not
   * fault on the null selector at all (`nullds`).
   */
  applicationFault(vector: number) {
    const handle = this.scheduler.active;

    if (!handle || !this.handles.resolve(handle)) {
      return false;
    }

    return applicationFault(this, vector);
  }

  /** The mouse and keyboard on the raster desktop, when there is one. See `raster-input.ts`. */
  get rasterInput() {
    if (!this.rasterDesktop) {
      return null;
    }

    this._rasterInput ??= new RasterInput(this);

    return this._rasterInput;
  }

  get display() {
    return this._display;
  }

  /**
   * The screen, as something that can be drawn on.
   *
   * `GetDC(NULL)` hands a program a device context for the screen itself
   * rather than for any window, and programs use it for exactly the things a
   * window cannot answer: how big the display is, how many colours it has, and
   * how wide a string will be in a given font. Both of the oracle's drawing
   * probes open one before they ask anything.
   *
   * Its size comes from the display driver rather than from the page. A guest
   * asking the screen how big it is should be told what a VGA is, not what
   * this browser window happens to be, which is the same reason
   * `GetDeviceCaps` answers from the display mode.
   *
   * Built on first use, because most programs never ask.
   */
  get screen() {
    if (!this._screen) {
      /* Off the page, and indexed at the display's depth like every other
       * device context's pixels. See `DeviceBitmap`. */
      this._screen = Surface.memory();
      this._screen.bitmap = new DeviceBitmap(
        this._display.width,
        this._display.height,
        DevicePalette.depthOf(this._display),
        undefined,
        DevicePalette.forDisplay(this._display)
      );
    }

    return this._screen;
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
   * Returns the instance of DOS this system is running upon.
   */
  get dos() {
    return this._dos;
  }

  /**
   * Returns the file manager.
   *
   * @return {FileManager} The file manager.
   */
  get files() {
    return this.dos.files;
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
  async load(executable) {
    // A loader parses the executable data for information useful for
    // link/loading the task.
    const loader = new Loader(executable, this._globalAllocator);
    await loader.parse();

    console.log('resident', loader.residentEntries);
    console.log('non-resident', loader.nonResidentEntries);
    console.log('module-reference', loader.moduleReferenceEntries);
    console.log('exports', loader.exports);

    /* Its exported functions made to take their data segment from AX, as
     * KERNEL patches a program's; see `library.ts`. */
    patchPrologues(this, { loader, executable });

    /* Each segment a block of global memory KERNEL allocated, with a handle
     * and a size: its minimum allocation, 64K for none, and for the data
     * segment two bytes, the stack and the heap more, in paragraphs
     * (`KRNL386.EXE` seg1 `7660`). A Visual Basic program's start-up asks
     * `GlobalHandle` for its own data segment's, and ends when it has
     * none. */
    loader.segments.forEach((segment: any, index: number) => {
      const extra =
        index + 1 === loader.ds
          ? 2 + executable.neHeader.initialStackSize + executable.neHeader.initialLocalHeapSize
          : 0;
      const size = Math.min((segment.minAllocation || 0x10000) + extra, 0x10000);

      this.allocator.setSegmentSize(loader.translate(index + 1), (size + 15) & ~15);
    });

    // Register the module with the system
    this._modules.register(loader);

    // The task encapsulates a running program and its address space.
    const task = new Task(executable, loader);

    /* The libraries it needs from the disk, placed and linked now; their
     * entry points run when it starts. See `library.ts`. */
    const beside = String(executable.path ?? '').replace(/\\[^\\]*$/, '') || null;

    (task as any).libraries = await loadLibrariesFor(this, loader, beside);

    console.log('WE NEED:', this._linker.requirementsFor(task));

    // Gather the initial data segment
    const dataSegment = loader.segments[loader.ds - 1];

    // Allocate a heap to the data segment (after data and before stack)
    /* The stack and the heap follow the data at a word boundary. A data
     * segment of an odd length -- Character Map's is 1,303 bytes -- would
     * otherwise put the stack on an odd address, and a program that runs on
     * Windows never has one there. Whether Windows rounds to a word or to a
     * paragraph is not recorded: every probe's data segment is a multiple of
     * sixteen. */
    const heapStart = dataTop(dataSegment) + executable.neHeader.initialStackSize;
    const heapEnd = heapStart + executable.neHeader.initialLocalHeapSize;
    LocalInit.bind(this)(segmentSelector(loader.translate(loader.ds)), heapStart, heapEnd);

    /* A moveable data segment's heap grows when a request does not fit; see
     * `Heap.grow`. */
    const heap = this.allocator.heapOf(loader.translate(loader.ds));

    if (heap) {
      heap.growable = !!dataSegment.movable;
    }

    const handle = this.handles.allocate(task);
    return handle;
  }

  requirementsFor(handle) {
    const task = this.handles.resolve(handle);
    return this._linker.requirementsFor(task);
  }

  /**
   * Links the given task.
   */
  link(handle) {
    const task = this.handles.resolve(handle);
    this._linker.link(task);
  }

  /**
   * Starts a loaded and linked task: the first, at once; another, when it is
   * granted the processor (see `Scheduler.start`).
   */
  run(
    handle,
    options: {
      commandLine?: string;
      show?: number;
      previous?: number;
      environment?: Uint8Array;
    } = {}
  ) {
    const first = !this.scheduler.active;

    this.prepare(handle, options);

    if (first) {
      this.resume(handle);
    } else {
      this.scheduler.start(handle, true);
    }
  }

  /**
   * A task's first state, kept in its `context` for when it starts: its
   * program segment prefix with the command line, its environment and stack,
   * and the registers the loader starts a program with. The processor is
   * left as it was, for the task that has it.
   */
  prepare(
    handle,
    {
      commandLine = '',
      show = User.SW_SHOWNORMAL,
      previous = 0,
      environment: given = undefined as Uint8Array | undefined,
    } = {}
  ) {
    const task = this.handles.resolve(handle);
    const first = !this.scheduler.active;

    this.scheduler.register(handle, task);
    task.show = show;
    task.previousInstance = previous;

    const dataSegment = task.loader.segments[task.loader.ds - 1];
    const running = first ? null : this.scheduler.snapshot();

    this._machine.cpu.core.msw = 1; // Enable Protected Mode

    /* One interrupt descriptor table, made for the first task: a vector a
     * program sets is the system's, not its own. */
    if (!this._machine.idtSegment) {
      const idtSegment = 0xffd;
      const idtBytes = new Uint8Array(4096);
      this._globalAllocator.map(idtSegment, new DataView(idtBytes.buffer));

      /* Published as a selector rather than as the descriptor index it was
       * mapped by: the DOS interrupt-vector calls address it as a segment,
       * and an index is not one -- it names the right descriptor only by
       * accident of both being small numbers, and names the wrong one as soon
       * as the table or privilege bits matter.
       */
      this._machine.idtSegment = segmentSelector(idtSegment);
    }
    // We need to allocate a program segment to contain the command line
    // arguments and environment.
    const programSegment = this._globalAllocator.find();

    // Allocate 256 bytes for the program segment prefix
    const programSegmentBytes = new Uint8Array(256);
    this._globalAllocator.map(programSegment, new DataView(programSegmentBytes.buffer));

    /* The task's environment; see `task-environment.ts`. */
    const environmentSegment = this._globalAllocator.find();
    const environment = given ?? taskEnvironment('C:\\WINDOWS');
    const environmentSegmentBytes = new Uint8Array(Math.max(256, (environment.length + 15) & ~15));

    environmentSegmentBytes.set(environment);
    task.environment = environment;
    this._globalAllocator.map(environmentSegment, new DataView(environmentSegmentBytes.buffer));

    // Allocate a stack
    const stackBytes = new Uint8Array(task.executable.neHeader.initialStackSize);
    const stackView = new DataView(stackBytes.buffer);
    this._memory.write(
      this._machine.cpu.core.translateAddress(
        segmentSelector(task.loader.translate(task.loader.ds)),
        dataTop(dataSegment)
      ),
      stackView
    );

    // Set up the program segment prefix.
    // https://en.wikipedia.org/wiki/Program_Segment_Prefix

    // Write INT 0x20 for CP/M exit (lol!!)
    this._machine.cpu.core.write8(segmentSelector(programSegment), 0x0, 0xcd);
    this._machine.cpu.core.write8(segmentSelector(programSegment), 0x1, 0x20);

    // Write environment segment
    this._machine.cpu.core.write16(
      segmentSelector(programSegment),
      0x2c,
      segmentSelector(environmentSegment)
    );

    /* The command line: its length, its characters, and a nought after, as
     * `WinMain` is given it -- **recorded** by `winexec`, with no carriage
     * return. */
    const tail = commandLine.slice(0, 126);

    this._machine.cpu.core.write8(segmentSelector(programSegment), 0x80, tail.length);

    for (let at = 0; at <= tail.length; at++) {
      this._machine.cpu.core.write8(
        segmentSelector(programSegment),
        0x81 + at,
        at < tail.length ? tail.charCodeAt(at) & 0xff : 0
      );
    }

    task.programSegment = programSegment;
    task.environmentSegment = environmentSegment;

    /* Each through the loader's map: a second program's segments are not
     * at the descriptors its numbers name. */
    this._machine.cpu.core.ds = segmentSelector(task.loader.translate(task.loader.ds));
    this._machine.cpu.core.ss = segmentSelector(task.loader.translate(task.loader.ss));
    this._machine.cpu.core.sp = dataTop(dataSegment) + task.executable.neHeader.initialStackSize;
    this._machine.cpu.core.cs = segmentSelector(task.loader.translate(task.loader.cs));
    this._machine.cpu.core.ip = task.loader.ip;
    this._machine.cpu.core.bx = task.executable.neHeader.initialStackSize;
    this._machine.cpu.core.cx = task.executable.neHeader.initialLocalHeapSize;
    this._machine.cpu.core.di = 0x88; // hModule
    this._machine.cpu.core.si = 0;
    this._machine.cpu.core.es = segmentSelector(programSegment);

    /* The current directory, one for all, as DOS keeps it: Windows', where
     * Windows was started, when the first program starts -- not the
     * program's own -- and a program another starts is in the directory it
     * was in. **Recorded** by `tasks2`. */
    if (first) {
      this.dos.files.drive = 'C';
      this.dos.files.path = 'C:\\WINDOWS';
    }

    // Set initial context
    task.context = this._machine.cpu.state;

    if (running) {
      this.scheduler.restore(running);
    }
  }

  /**
   * Initializes the task. The program calls this function.
   *
   * Specifically, the Kernel.InitTask function calls this function while the
   * task is currently scheduled.
   */
  async initTask() {
    // Get data segment
    const taskHandle = this.scheduler.active;
    const task = this.handles.resolve(taskHandle);

    await this.startLibraries(task);

    const loader = task.loader;
    const dataSegment = loader.segments[loader.ds - 1];

    this._machine.cpu.core.ds = segmentSelector(loader.translate(loader.ds));
    this._machine.cpu.core.bx = 0x81; // Offset to the command line in the PSP
    this._machine.cpu.core.es = segmentSelector(task.programSegment);
    this._machine.cpu.core.cx = dataTop(dataSegment); // The limit for the stack.
    /* The instance is the data segment's handle, one below its selector
     * (**recorded** by `instds`), and both name the task. */
    const dataSelector = segmentSelector(loader.translate(loader.ds));

    this.handles.aliasAt(dataSelector - 1, task);
    this.handles.aliasAt(dataSelector, task);
    this._machine.cpu.core.di = dataSelector - 1; // the HINSTANCE
    this._machine.cpu.core.si = task.previousInstance ?? 0; // the instance before, if any
    this._machine.cpu.core.dx = task.show ?? User.SW_SHOWNORMAL; // Show the main window

    // Set up the base frame
    this._machine.cpu.core.bp = this._machine.cpu.core.sp;

    // Pop the return address
    const retIP = this._machine.cpu.core.pop16();
    const retCS = this._machine.cpu.core.pop16();

    // Push a 0x0 to support frame walks.
    this._machine.cpu.core.push16(0x0);

    // Push the return address again
    this._machine.cpu.core.push16(retCS);
    this._machine.cpu.core.push16(retIP);

    // We then return to the program...
    // And return 1 for success
    return 1;
  }

  /**
   * Runs the entry point of each library a task loaded that has not run yet,
   * in the order they were loaded: with its data segment in DS, its instance
   * in DI and its local heap's size in CX, as the loader calls one. A library
   * whose entry point answers nought failed to start.
   */
  async startLibraries(task) {
    for (const library of task.libraries ?? []) {
      if (library.started) {
        continue;
      }

      library.started = true;

      const loader = library.loader;
      const cs = loader.translate(loader.cs);

      if (!cs) {
        continue;
      }

      const ds = loader.ds ? segmentSelector(loader.translate(loader.ds)) : 0;
      /* As KERNEL calls one (`KRNL386.EXE` seg2 `24a0`): DS and DX the data
       * segment, DI the instance, CX the heap's size, ES:SI no command line,
       * AX 1; on the program's stack, from inside its `InitTask`, a library
       * after the ones it needs. */
      const answer = await this.scheduler.call(User, segmentSelector(cs), loader.ip, [], UINT, {
        ds,
        dx: ds,
        di: library.instance,
        cx: library.executable.neHeader.initialLocalHeapSize,
        es: 0,
        si: 0,
        ax: 1,
      });

      this.debug('library started', library.name, answer);
    }
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
    const currentHandle = this.scheduler.active;
    const currentTask = this.handles.resolve(currentHandle);
    if (currentTask) {
      currentTask.halt();
    }
  }

  /**
   * Resumes execution of the given task.
   */
  resume(handle) {
    const currentHandle = this.scheduler.active;
    const currentTask = this.handles.resolve(currentHandle);

    if (currentTask) {
      currentTask.halt();
    }

    const task = this.handles.resolve(handle);
    if (!task) {
      return;
    }

    this.scheduler.resume(handle);
  }

  /**
   * A window procedure of USER's own, called by a program at the address it
   * was given for it: the function at the index in AX, with the window,
   * message, `wParam` and `lParam` the far call left on the stack, and its
   * answer in DX:AX for the `retf` after the interrupt.
   */
  userProcedureInvoke() {
    const core = this._machine.cpu.core;
    const proc = (this as any)._procTokens?.[core.ax];
    const word = (at: number) => core.read16(core.ss, (core.sp + at) & 0xffff);
    const lParam = ((word(6) << 16) | word(4)) >>> 0;
    const wParam = word(8);
    const message = word(10);
    const hwnd = word(12);

    this.scheduler.task.pushContext(1);
    this.scheduler.task.halt();

    const caller = this.scheduler.active;
    const result = typeof proc === 'function' ? proc(hwnd, message, wParam, lParam) : 0;

    this.scheduler.interpretReturnValue(result, LRESULT, caller);

    return false;
  }

  syscallInvoke() {
    // Get the module from the CS
    const segment = this._machine.cpu.core.cs >> 3;
    const module = this._modules.fromSegment(segment);

    // Preserve context (will just thrown out)
    this.scheduler.task.pushContext(1);

    // Get the ordinal from the step
    let ip = this._machine.cpu.core.ip & ~(module.step - 1);
    ip = ip / module.step;

    // We need to subtract 1 since the first ordinal is the callback thunk
    ip--;

    const callerIP = this._machine.cpu.core.read16(
      this._machine.cpu.core.ss,
      this._machine.cpu.core.sp
    );

    const callerCS = this._machine.cpu.core.read16(
      this._machine.cpu.core.ss,
      this._machine.cpu.core.sp + 2
    );

    if (ip == 0) {
      this.scheduler.interpretReturnValue(0);
      return false;
    }

    const functionDefinition = module.instance.exports[ip];

    const implementation = functionDefinition[0];
    const returnType = functionDefinition[4];

    // Craft the arguments from the stack
    const argList = functionDefinition[3] || [];
    let offset = 4; // Account for CS:IP on stack
    if (argList[argList.length - 1] != VARIADIC) {
      // If it is not a variadic, calling conventions reverse the push
      // order on the stack.
      argList.reverse();
    }

    const args = argList.map((argType) => {
      if (argType == VARIADIC) {
        // Ignore this for now
      } else if (Types.sizeof(argType) <= 2) {
        let read16 = this._machine.cpu.core.read16.bind(this._machine.cpu.core);
        if (Types.signed(argType)) {
          read16 = this._machine.cpu.core.readSigned16.bind(this._machine.cpu.core);
        }

        let ret = read16(this._machine.cpu.core.ss, this._machine.cpu.core.sp + offset);
        offset += 2;

        if (Types.sizeof(argType) == 1) {
          ret = ret & 0xff;
        }
        return ret;
      } else if (Types.sizeof(argType) == 4) {
        const lo = this._machine.cpu.core.read16(
          this._machine.cpu.core.ss,
          this._machine.cpu.core.sp + offset
        );

        const hi = this._machine.cpu.core.read16(
          this._machine.cpu.core.ss,
          this._machine.cpu.core.sp + offset + 2
        );

        offset += 4;

        if (argType instanceof Array) {
          // This is a pointer of the type inside the array
          argType = argType[0];
        }

        if (argType.prototype instanceof Struct) {
          // This is a pointer to a struct
          if (hi == 0 && lo == 0) {
            // null pointer
            return null;
          }

          // Read in the struct data
          const struct = new argType();
          struct.loadFromMemory(this._memory, hi >> 3, lo);
          return struct;
        } else if (argType == Types.LPCSTR) {
          // Read string at [ret-hi]:[ret-lo]
          if (hi == 0 && lo == 0) {
            // null string
            return null;
          } else if (hi == 0) {
            // null segment falls back to a number instead
            return lo;
          } else {
            const ret: any = new String(
              this._memory.readCString(this._machine.cpu.core.translateAddress(hi, lo))
            );
            ret.segment = hi;
            ret.offset = lo;
            return ret;
          }
        }

        return (hi << 16) | (lo & 0xffff);
      }
    });

    if (argList[argList.length - 1] == VARIADIC) {
      // Add a pointer to the stack
      const hi = this._machine.cpu.core.ss;
      const lo = this._machine.cpu.core.sp + offset;
      args[args.length - 1] = (hi << 16) | lo;
    } else {
      args.reverse();
    }

    const called = module.instance.exports[ip][1];

    /* Every call a program makes passes through here, which makes it the one
     * place worth offering to anyone who wants to watch. A trace is how you
     * find out what a program actually needs -- which is a different and much
     * shorter list than what the API contains -- and it is what lets a test
     * assert that a program got as far as it should have.
     */
    this._onCall?.({
      module: module.instance.name,
      name: called,
      ordinal: ip,
      args,
      caller: { segment: callerCS, offset: callerIP - 5 },
      /* Whether the call reaches no implementation: what a program needs
       * that is not there yet. */
      stub: implementation === module.instance.stub,
    });

    this.debug('Calling', module.instance.name, called, args);
    //console.log(this._machine.cpu.core.cs.toString(16), this._machine.cpu.core.ip.toString(16));
    //}

    // Halt the task so it won't continue
    this.scheduler.task.halt();

    /* The task calling, taken before the call: a call that gives the
     * processor up on its way -- sending to another task's window does --
     * has another task running by the time it hands back its promise. */
    const caller = this.scheduler.active;

    //let last = (new Date).getTime();
    let result = implementation.apply(this, args);
    //let now = (new Date).getTime();
    //let elapsed = now - last;
    //console.log(module.instance.exports[ip][1], "in", elapsed);
    //console.log("result", result, typeof result === 'function');

    if (implementation === module.instance.stub) {
      console.log(
        'Stub:',
        module.instance.name,
        module.instance.exports[ip][1],
        callerCS.toString(16),
        ':',
        (callerIP - 5).toString(16),
        args
      );

      /* What an unimplemented function answers: nothing, zero in DX:AX, which
       * a program reads as failure -- a NULL handle, FALSE. It used to leave
       * whatever AX held, so a program went on with a handle it never got:
       * Cardfile drew with a device context that was its own last result. */
      this._machine.cpu.core.ax = 0;
      this._machine.cpu.core.dx = 0;
      result = undefined;
    }

    // Interpret the result; possibly resumes the task
    this.scheduler.interpretReturnValue(result, returnType, caller);
    return false;
  }

  /**
   * `int 21h` from a task, taken as an API call is: the task halted, DOS
   * called, `FileCdr`'s procedure told, and the task resumed with the
   * registers DOS left. See `kernel/FileCdr.ts`.
   */
  dosInvoke() {
    if (!this.scheduler?.task) {
      return this.dos.syscallInvoke();
    }

    this.scheduler.task.pushContext(1);
    this.scheduler.task.halt();

    /* Taken first: a program that ends here leaves another task running. */
    const caller = this.scheduler.active;

    this.scheduler.interpretReturnValue(dosCall(this), undefined, caller);

    return false;
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

/** Where a task's data ends and its stack begins: the data segment's length, on a word boundary. */
function dataTop(dataSegment: any) {
  return (dataSegment.length + 1) & ~1;
}

export default Win16;
