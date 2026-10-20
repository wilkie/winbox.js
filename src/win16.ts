'use strict';

// File System
import { CALL_INSTRUCTIONS } from './emulator/clock.js';
import { UNRECORDED, callInstructions } from './win16/call-costs.js';
import { applicationFault } from './win16/kernel/fault.js';
import { segmentSelector } from './win16/selectors.js';

// Task
import { Task } from './win16/task.js';

// Subsystems
import { GlobalAllocator } from './win16/global-allocator.js';
import { Allocator } from './win16/allocator.js';
import { Loader } from './win16/loader.js';
import { loadLibrariesFor, patchPrologues, releaseLibraries, streamOf } from './win16/library.js';
import { Executable } from './executable.js';
import { DEFAULT_DISPLAY_MODE, displayMode } from './win16/display-modes.js';
import { sentMessageHook } from './win16/user/hooks.js';
import { systemQueue } from './win16/user/system-queue.js';
import { desktopProc } from './win16/user/task-list.js';
import { pollTimeEvents } from './win16/mmsystem/time.js';
import { readArguments } from './win16/read-arguments.js';
import { GdiHeap, loadBitmaps, syncBitmaps } from './win16/gdi/gdi-heap.js';
import { quickCalls } from './win16/quick-calls.js';
import { type SegmentHandler } from './emulator/split-block.js';
import { rasterDesktop } from './win16/user/raster-desktop.js';
import { driverResources } from './win16/user/driver-resources.js';
import { oembinValues } from './win16/user/oembin.js';
import { displayResourceNumber } from './win16/display-resource-id.js';
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
import {
  fontLineFile,
  profileSection,
  trueTypeFileOf,
  trueTypeSettings,
} from './win16/font-directory.js';

// The various OS modules
import { Kernel } from './win16/kernel.js';
import { Gdi } from './win16/gdi.js';
import { User } from './win16/user.js';
import { MMSystem } from './win16/mmsystem.js';
import { WinG } from './win16/wing.js';
import { SystemPalette } from './win16/gdi/system-palette.js';
import { Sound } from './win16/sound.js';
import { Win87EM } from './win16/win87em.js';
import { CommDlg } from './win16/commdlg/index.js';
import { Ver } from './win16/ver/index.js';
import { LzExpand } from './win16/lzexpand/index.js';
import { Ddeml } from './win16/ddeml/index.js';
import { SystemDriver } from './win16/system-driver.js';
import { displayDriverFor } from './win16/display-driver.js';
import { Keyboard } from './win16/keyboard.js';
import { ToolHelp } from './win16/toolhelp.js';
import { Timer } from './win16/timer.js';
import { MciSeq, MciWave } from './win16/mmsystem/mci-drivers.js';
import { dosCall } from './win16/kernel/FileCdr.js';
import { floatingInterrupt } from './win16/win87em/emulator.js';
import { taskEnvironment } from './win16/task-environment.js';
import { Shell } from './win16/shell.js';

// Other useful types
import { UINT, LRESULT, HDC } from './win16/types.js';
import { MetafileDC, recordCall } from './win16/gdi/metafile.js';
import { bandingCall } from './win16/gdi/printer-bands.js';
import { MoveTo } from './win16/gdi/MoveTo.js';

// Kernel calls
import { LocalInit } from './win16/kernel/LocalInit.js';

import { Surface } from './raster/surface.js';
import { DeviceBitmap } from './raster/device-bitmap.js';
import { DevicePalette } from './raster/device-palette.js';

/**
 * This represents the Windows 16-bit Operating System emulation.
 */
/**
 * A module's export table, made once: a module winbox.js keeps itself
 * builds its table afresh each time it is asked, several hundred entries,
 * and every call to Windows asked three times -- a tenth of the time a
 * program that polls took, and much of the garbage. A module loaded from
 * its file keeps its own.
 */
const exportTables = new WeakMap<object, any[]>();

function exportsOf(instance: any): any[] {
  if (typeof instance !== 'function') {
    return instance.exports;
  }

  let table = exportTables.get(instance);

  if (!table) {
    table = instance.exports as any[];
    exportTables.set(instance, table);
  }

  return table;
}

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
  declare _systemPalette: SystemPalette | undefined;
  declare _onCall: any;
  declare _options: any;
  declare _startTime: any;
  declare _moduleData: Record<string, number>;
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
    /* A copy, as USER's start-up read of the driver's `OEMBIN` 1 writes its
     * metrics and colours into it (`displayResources`). */
    this._display = { ...displayMode((options as any).display ?? DEFAULT_DISPLAY_MODE) };

    /* A 256-colour display's palette as its driver sets it up, whatever an
     * earlier machine realized into it. */
    void this.systemPalette;

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
    /* Each module winbox.js keeps has a module handle and an instance, as
     * Windows' own do: see `keep`. */
    this.keep(Kernel, 'fixed');
    this.keep(Gdi, 'moveable', new GdiHeap(this));
    this.keep(User, 'moveable');
    this.keep(MMSystem, 'moveable');
    this.keep(Sound, 'fixed');
    this.keep(Win87EM, 'moveable');
    this.keep(WinG, 'moveable');
    this.keep(CommDlg, 'moveable');
    this.keep(Shell, 'moveable');
    this.keep(Keyboard, 'fixed');
    this.keep(SystemDriver, 'fixed');
    this.keep(displayDriverFor(this._display), 'fixed');
    this.keep(ToolHelp, 'moveable');
    this.keep(Timer, 'fixed');
    this.keep(MciWave, 'fixed');
    this.keep(MciSeq, 'fixed');
    this.keep(Ver, 'moveable');
    this.keep(LzExpand, 'moveable');
    this.keep(Ddeml, 'moveable');

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
    this._scheduler.files = this._dos.files;
    this._scheduler.onSlice = () => pollTimeEvents(this);

    /* The calls a program polls with, answered by the Rust core where it
     * runs beside this one (`quick-calls.ts`). */
    machine.cpu.quickCalls = quickCalls(this);
    this._scheduler.sentHook = (hwnd, message, wParam, lParam) =>
      sentMessageHook(this, hwnd, message, wParam, lParam);

    // Keep track of all window instances.
    // The '0' index window is the desktop.
    this._windows = new WindowManager(this._scheduler, this._handles, this._startTime);

    /* The desktop window: the first window there is. */
    this._desktopWindow = new DesktopHandle(this);
    this._desktopWindow.wndProc = (
      _hwnd: number,
      message: number,
      wParam: number,
      lParam: number
    ) => desktopProc(this, message, wParam, lParam);
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

    /* GDI's three boot fonts from the system directory, and then each line
     * of `WIN.INI` `[fonts]` as USER adds it (`fontLineFile`), in that
     * order -- the order GDI's font directory holds them, which the mapper's
     * ties go to the earliest of. One at a time, too: loading them together
     * left the order to whichever read finished first. A file the profiles
     * do not name is not GDI's (**recorded** by `fontboot`). As the Rust
     * engine's `boot`.
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

    const systemProfile = await profile('SYSTEM.INI');
    const windowsProfile = await profile('WIN.INI');
    const trueType = trueTypeSettings(windowsProfile);

    this._fonts.trueTypeOff = !trueType.enabled;
    this._fonts.trueTypeOnly = trueType.only;

    const nameOf = (file: any) => String(file.name ?? '').toUpperCase();
    const loaded = new Set<string>();
    const listings = new Map<string, any[]>();

    /* A file in a folder, found without regard to case. */
    const find = async (folder: string, name: string) => {
      const key = folder.toUpperCase();

      if (!listings.has(key)) {
        listings.set(key, await this.files.list(folder).catch(() => []));
      }

      return listings.get(key)!.find((file: any) => nameOf(file) === name.toUpperCase()) ?? null;
    };

    const load = async (folders: string[], name: string) => {
      for (const folder of folders) {
        const file = await find(folder, name);

        if (!file) {
          continue;
        }

        const path = `${folder}\\${nameOf(file)}`.toUpperCase();

        if (loaded.has(path)) {
          return null;
        }

        loaded.add(path);
        await this._fonts.load(file);

        return file;
      }

      return null;
    };

    for (const font of ['fonts.fon', 'fixedfon.fon', 'oemfonts.fon']) {
      for (const [key, value] of profileSection(systemProfile, 'boot')) {
        if (key.toLowerCase() === font) {
          await load(['C:\\WINDOWS\\SYSTEM'], value);
        }
      }
    }

    /* A TrueType face is installed as a `.FOT` stub, which goes to the
     * manager first -- its pitch and family are read from it -- and then the
     * `.TTF` it names; with TrueType off, GDI has no TrueType table and a
     * stub's add fails (seg2 `0f38`). */
    for (const [, value] of profileSection(windowsProfile, 'fonts')) {
      const { folders, name } = fontLineFile(value);
      const stub = name.toUpperCase().endsWith('.FOT');

      if (stub && !trueType.enabled) {
        continue;
      }

      const file: any = await load(folders, name);

      if (file && stub) {
        await load(
          ['C:\\WINDOWS\\SYSTEM'],
          trueTypeFileOf(new Uint8Array(await file.read(0, file.size)), name.toUpperCase())
        );
      }
    }

    await this.displayResources(files);
  }

  /**
   * The display driver's resource table, as the module winbox.js keeps for
   * it: `FindResource` on `GetModuleHandle("DISPLAY")` finds the driver's
   * own resources, its `OEMBIN` among them, as on Windows (`drvres`).
   * Control Panel's Color builds its "Windows Default" scheme from
   * `OEMBIN` 1, and its custom colours' palette from 2 (`MAIN.CPL` seg6
   * `2922`, `24ef`). See `kb/topics/display-driver-resources.md`.
   */
  async displayResources(files: any[]) {
    const display: any = this._modules.fromName('DISPLAY');
    const name = display ? String(display.path).split('\\').pop()!.toUpperCase() : '';
    const file: any = display
      ? files.find((one: any) => String(one.name ?? '').toUpperCase() === name)
      : null;
    /* The installation's file, else the asset bundle's (`options.assets`). */
    const bytes = file
      ? new Uint8Array(await file.read(0, file.size))
      : display
        ? this.assetModule(name)
        : undefined;

    if (!bytes || display.executable) {
      return;
    }

    const executable: any = new Executable('DISPLAY', display.path, streamOf(bytes));

    try {
      await executable.parse();
      display.executable = executable;
    } catch {
      /* Not a driver winbox.js can read: no resources, as before. */
      return;
    }

    /* USER's start-up read of the driver's `OEMBIN` 1, its metrics and
     * default colours (`USER.EXE` seg3 `0c9f`-`0e11`; `oembin.ts`): the
     * resource the driver's `GetDriverResourceID` answers 1 with, where it
     * has one, and else the one numbered 1 -- 2001 at the 8514/a's small
     * fonts and the XGA's 640x480 (`display-resource-id.ts`). Without it the
     * recorded tables stand, which agree with it on every display. */
    const number = displayResourceNumber(this._display, 1);
    const named = (entry: any) =>
      [entry.name, entry.id].some((name) => String(name ?? '').toUpperCase() === 'OEMBIN');
    const entry = (executable as any).resources
      ?.find(named)
      ?.entries?.find((one: any) => one.id === number);
    const data = entry ? new Uint8Array(await (executable as any).readResource(entry)) : null;
    const taken = data && oembinValues(data);

    if (taken) {
      this._display.metricsByIndex = { ...this._display.metricsByIndex, ...taken.metrics };
      this._display.sysColors = taken.colors;
    }
  }

  /**
   * A module's file from the asset bundle's store, `options.assets`, by its
   * name -- `USER.EXE`, `SHELL.DLL`, a display driver, their code taken out:
   * what the kept modules' resources are read from where C: has no file of
   * theirs. None without a store, or one without it.
   * See `kb/topics/asset-bundle.md`.
   */
  assetModule(name: string): Uint8Array | undefined {
    return (this._options as any).assets?.module(name) ?? undefined;
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

    /* The libraries its program brought, let go with it (`search`). */
    releaseLibraries(this, task.brought ?? []);
    task.brought = [];
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
   * The system palette a 256-colour display's programs realize their palettes
   * into, or null on a display of fixed colours. See `system-palette.ts`.
   */
  get systemPalette() {
    if (this._display?.bitsPerPixel !== 8) {
      return null;
    }

    this._systemPalette ??= new SystemPalette(DevicePalette.forDisplay(this._display));

    return this._systemPalette;
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
      this._screen.bitmap.context.display = this._display;
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

    /* The keyboard's and the mouse's input is USER's system queue, one for
     * every task, which each looks at in turn (`system-queue.ts`). */
    task._input = systemQueue(this);

    /* The libraries it needs from the disk, placed and linked now; their
     * entry points run when it starts. See `library.ts`. */
    const beside = String(executable.path ?? '').replace(/\\[^\\]*$/, '') || null;

    const brought: any[] = [];

    (task as any).libraries = await loadLibrariesFor(this, loader, beside, [], brought);
    /* Those it counted, let go as it ends (`exitTask`). */
    (task as any).brought = brought;

    console.log('WE NEED:', this._linker.requirementsFor(task));

    /* Its local heap is made as it calls `InitTask`, at the end of its data
     * segment (`initTask`). */

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
      directory?: string;
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
      directory = undefined as string | undefined,
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

    /* The task's own current drive and directory (`Scheduler.keepDirectory`):
     * where its starter asks for one, as Program Manager starts a program in
     * its item's working directory; else, the first program, Windows', where
     * Windows was started -- not the program's own (`tasks2`); else the one
     * the program starting it is in (`curdir`). The first runs at once, in
     * it. */
    const files = this.dos.files;

    task.directory = directory
      ? { drive: directory[0].toUpperCase(), path: directory }
      : first
        ? { drive: 'C', path: 'C:\\WINDOWS' }
        : { drive: files.drive, path: files.path };

    if (first) {
      this.scheduler.putDirectory(task);
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
    const loader = task.loader;

    /* The task's local heap, made as KERNEL's `InitTask` makes it, before
     * the libraries start (`KRNL386.EXE` seg2 `26b2`-`26c5`): `LocalInit`
     * of DS with a start of nought and the size in CX, the heap's size the
     * task started with, unless that is nought. So the heap is at the end of
     * the data segment, ending a byte short of its size -- after the
     * program's own start-up has grown the segment, as a Visual Basic
     * program's does. Where it cannot be made, `InitTask` fails, answering
     * nought. */
    const heapSize = this._machine.cpu.core.cx & 0xffff;

    if (heapSize) {
      if (!LocalInit.call(this, segmentSelector(loader.translate(loader.ds)), 0, heapSize)) {
        return 0;
      }
    }

    await this.startLibraries(task);

    /* The stack's three words in the data segment's header, as KRNL386.EXE
     * seg2 `268d` writes them: its bottom and the lowest it has reached are
     * where the stack pointer is with the return address taken off, and its
     * limit that less the stack's size, in BX as the task started, and 96h
     * more (**recorded** by `stackpos`). The limit is answered in CX. */
    const core = this._machine.cpu.core;
    const bottom = (core.sp + 4) & 0xffff;
    const limit = (bottom - core.bx + 0x96) & 0xffff;

    core.write16(core.ss, 0x0a, limit);
    core.write16(core.ss, 0x0c, bottom);
    core.write16(core.ss, 0x0e, bottom);

    this._machine.cpu.core.ds = segmentSelector(loader.translate(loader.ds));
    this._machine.cpu.core.bx = 0x81; // Offset to the command line in the PSP
    this._machine.cpu.core.es = segmentSelector(task.programSegment);
    this._machine.cpu.core.cx = limit;
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
    /* A procedure of more arguments -- GDI's for a printer driver's fonts
     * (`printer-driver.ts`) -- is given the doubleword above them too. */
    const above = ((word(16) << 16) | word(14)) >>> 0;
    const result = typeof proc === 'function' ? proc(hwnd, message, wParam, lParam, above) : 0;

    this.scheduler.interpretReturnValue(result, LRESULT, caller);

    return false;
  }

  syscallInvoke() {
    /* A call takes a virtual clock's time as well as the program's own
     * instructions do (`clock.ts`): `CALL_INSTRUCTIONS`, or, charged as
     * recorded, the instructions Windows runs for it, once its arguments
     * are known (`call-costs.ts`). */
    const clock = this._machine.clock;
    const measured = !!clock?.virtual && clock.measuredCalls;

    if (!measured) {
      clock?.charge(CALL_INSTRUCTIONS);
    }

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
      if (measured) {
        clock.charge(UNRECORDED);
      }

      this.scheduler.interpretReturnValue(0);
      return false;
    }

    const table = exportsOf(module.instance);
    /* An entry where the module exports nothing: MMSYSTEM's own I/O
     * procedures, whose addresses it hands out (`mmio.ts`). */
    const functionDefinition = table[ip] ?? module.instance.hiddenExports?.[ip];

    const implementation = functionDefinition[0];
    const returnType = functionDefinition[4];

    /* The arguments from the stack, as the function's plan reads them
     * (`read-arguments.ts`). */
    const core = this._machine.cpu.core;
    const { args, rejected } = readArguments(this, functionDefinition, core.ss, core.sp);

    const called = functionDefinition[1];

    if (measured) {
      clock.charge(callInstructions(this, module.instance.name, called, args));
    }

    /* Every call a program makes passes through here, which makes it the one
     * place worth offering to anyone who wants to watch. A trace is how you
     * find out what a program actually needs -- which is a different and much
     * shorter list than what the API contains -- and it is what lets a test
     * assert that a program got as far as it should have.
     */
    const watched: any = this._onCall && {
      module: module.instance.name,
      name: called,
      ordinal: ip,
      args,
      caller: { segment: callerCS, offset: callerIP - 5 },
      /* Whether the call reaches no implementation: what a program needs
       * that is not there yet. */
      stub: implementation === module.instance.stub,
      /* Turned away for an argument that points nowhere. */
      rejected,
    };

    if (watched) {
      this._onCall(watched);
    }

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
    /* A GDI call into a metafile's device context is kept as a record, not
     * drawn: its arguments, and its stack less the device context, which is
     * what most records hold (`metafile.ts`). */
    const firstType = module.instance.name === 'GDI' ? (table[ip][3] ?? [])[0] : null;
    const metafile =
      firstType === HDC && !rejected && called !== 'CloseMetafile'
        ? this.handles.resolve(args[0])
        : null;

    if (metafile instanceof MetafileDC) {
      const pop = functionDefinition[2] || 0;
      const core = this._machine.cpu.core;
      const stack = Array.from({ length: Math.max(pop - 2, 0) }, (_, at) =>
        core.read8(core.ss, (core.sp + 4 + at) & 0xffff)
      );

      this.scheduler.interpretReturnValue(
        recordCall(this, metafile, ip, called, args, stack),
        returnType,
        caller
      );
      return false;
    }

    /* A context of a printer's driver that bands, while GDI keeps its page
     * in a metafile: a call that draws kept there, one that sets the
     * context's state kept and made, `LineTo` kept and the position moved
     * (`printer-bands.ts`). */
    const banding = metafile?.band?.recording ? bandingCall(called) : null;

    if (banding) {
      const pop = functionDefinition[2] || 0;
      const core = this._machine.cpu.core;
      const stack = Array.from({ length: Math.max(pop - 2, 0) }, (_, at) =>
        core.read8(core.ss, (core.sp + 4 + at) & 0xffff)
      );
      const kept = recordCall(
        this,
        this.handles.resolve(metafile.band.meta),
        ip,
        called,
        args,
        stack
      );

      if (banding !== 'both') {
        if (banding === 'position') {
          MoveTo.call(this, args[0], args[1], args[2]);
        }

        this.scheduler.interpretReturnValue(kept, returnType, caller);
        return false;
      }
    }

    /* A bitmap whose bits a program draws into itself is made to agree with
     * them around a call that names it (`gdi-heap.ts`). */
    const named = rejected ? null : loadBitmaps(this, args);
    let result = rejected ? 0 : implementation.apply(this, args);

    if (named) {
      if (result && typeof result.then === 'function') {
        result.then(
          () => syncBitmaps(this, named),
          () => syncBitmaps(this, named)
        );
      } else {
        syncBitmaps(this, named);
      }
    }
    //let now = (new Date).getTime();
    //let elapsed = now - last;
    //console.log(module.instance.exports[ip][1], "in", elapsed);
    //console.log("result", result, typeof result === 'function');

    if (implementation === module.instance.stub) {
      console.log(
        'Stub:',
        module.instance.name,
        table[ip][1],
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

    /* What the call answered, for whoever watches, once it has. */
    if (watched) {
      if (result && typeof result.then === 'function') {
        result.then(
          (value: any) => (watched.result = value),
          () => {}
        );
      } else {
        watched.result = result;
      }
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
   * One of the modules winbox.js keeps, registered with its two handles, as
   * Windows' own modules have them (`modhand`): the module's, which
   * `GetModuleHandle` answers, a selector of its own; and its instance,
   * which `LoadLibrary` answers, its data segment's -- one below the
   * selector for a moveable one, as USER's, GDI's and MMSYSTEM's are, and
   * the selector for a fixed one, as KERNEL's, SOUND's and KEYBOARD's are.
   * Each is 32 or more, where a smaller answer from `LoadLibrary` is an
   * error: CTL3D, which BG of the corpus ships, stopped at USER's 22. Which
   * way the other modules' data is, is not recorded.
   */
  keep(module: any, data: 'fixed' | 'moveable', heap?: SegmentHandler) {
    const database = this._globalAllocator.blank(SYSTEM_FIRST);
    const handle = this._handles.aliasAt(segmentSelector(database), module);

    this._modules.register(module, handle, this.moduleData(module, heap, data === 'fixed'));
  }

  /**
   * A data segment for one of the modules winbox.js keeps, and its handle,
   * the module's instance: one below its selector, as a program's instance
   * is (`sysheap`), or for a fixed one the selector. TOOLHELP's
   * `SystemHeapInfo` hands out USER's and GDI's. winbox.js keeps their
   * objects in itself; GDI's `heap` makes the bytes of those a program goes
   * looking for there (`gdi-heap.ts`), and USER's reads as noughts.
   */
  moduleData(module: any, heap?: SegmentHandler, fixed = false) {
    const index = this._globalAllocator.find(SYSTEM_FIRST);

    this._globalAllocator.map(index, new DataView(new ArrayBuffer(0x10000)));

    if (heap) {
      this._memory.mapHandler(index, heap);
    }

    const selector = segmentSelector(index);

    (this._moduleData ??= {})[module.name] = selector;

    return this._handles.aliasAt(fixed ? selector : selector - 1, module);
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

/**
 * The first descriptor Windows' own modules are given: selector 27h, so
 * that every handle made of one is 32 or more (`modhand`).
 */
const SYSTEM_FIRST = 4;

/**
 * Where a task's data ends and its stack begins: after all the data the
 * segment asks for, the uninitialised past what the file holds too, on a
 * word boundary. `stackpos`'s file holds 172h bytes of the 1730h it asks
 * for, and its stack's bottom is at 3730h: 1730h and its 2000h of stack.
 * Put after the file's bytes, the stack ran over the program's own
 * uninitialised statics.
 */
function dataTop(dataSegment: any) {
  return (Math.max(dataSegment.length, dataSegment.minAllocation || 0) + 1) & ~1;
}

export default Win16;
