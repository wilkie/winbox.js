/**
 * What the page asks of an engine, and what it gives one. The page is the
 * same whichever runs the programs: it reads what is dropped, plans the C:
 * drive (`planDrive`), lists the programs, keeps the trace and the status
 * line. An engine makes a machine from the plan, shows its screen in the
 * page's desktop, takes the mouse and keyboard there, and runs programs.
 *
 * Two engines answer it: the Rust engine built for WebAssembly (`rust.ts`),
 * the default, and the TypeScript engine (`ts.ts`), at `run.html?engine=ts`.
 */

import { type Assets } from '../../assets/bundle.js';
import { type Change } from '../changes.js';
import { type Archive, type Plan, type Program } from '../drive.js';
import { type DriveSet } from '../drives.js';
import { type WindowsMode } from '../../emulator/machine.js';

/** What the page gives an engine. */
export interface Page {
  /** Where the screen goes. */
  desktop: HTMLElement;

  /** The status line. */
  status(message: string, kind?: 'info' | 'error'): void;

  /**
   * A call a program made: its function, `KERNEL.lstrlen`; whether it is
   * answered by nothing yet; and the line the most recent calls show.
   */
  call(name: string, stub: boolean, line: string): void;

  /** A program has ended: what it wrote is to be kept. */
  ended(): void;
}

/** What a group's item gives the program it starts (`Engine.run`). */
export interface ItemStart {
  /** Its parameters: what follows the program's name on the command line `WinExec` is given. */
  commandLine: string;

  /** Its current directory, as DOS names it: `C:\ORACLE\PMDIR`. */
  directory: string;

  /** `nCmdShow`: 1 shown normally, 7 minimized. */
  show: number;
}

/** How the machine is to be made. */
export interface Setup {
  plan: Plan;

  /** The Windows installation dropped, if any, which the plan put under `C:\WINDOWS`. */
  windows: Archive | null;

  /**
   * The asset bundle, where one is had in place of an installation: the plan
   * put its base for the display under `C:\WINDOWS`, and its modules --
   * `USER.EXE`, `SHELL.DLL`, the display drivers -- are the store behind C:
   * the kept modules' resources are read from (`kb/topics/asset-bundle.md`).
   */
  assets: Assets | null;

  /**
   * The disk and disc images on drives other than C:, each drive's set
   * (`drives.ts`): mounted as the machine is made, the disk in each drive
   * put in, or the drive left empty. The page's own objects, which the
   * engine brings up to date as it is told to (`carry`).
   */
  drives: DriveSet[];

  /** The display, as `DISPLAY_MODES` names it. */
  display: string;
  coprocessor: boolean;

  /**
   * The mode Windows runs in: standard, or 386 enhanced mode
   * (`kb/guides/enhanced-mode.md`); a kept program's is its install's.
   * Standard where not given.
   */
  mode?: WindowsMode;

  /**
   * What programs wrote on C: before, kept by the page (`changes.ts`), put
   * back once the drive is filled from the plan.
   */
  changes: Change[];
}

export interface Engine {
  /** Its name, as the page's header shows it. */
  readonly name: string;

  /** A machine made afresh, its drive filled from the plan, its screen shown. */
  rebuild(setup: Setup): Promise<void>;

  /**
   * A program on the drive run. An installer (`install`) is run as Windows
   * started as `WIN SETUP.EXE` runs one, on a machine made afresh: Program
   * Manager the shell, started first and given it as its command line,
   * starting it and answering what it asks over DDE -- WinBox's own where
   * the drive has no `PROGMAN.EXE` (`kb/topics/program-manager-dde.md`).
   *
   * A group's item (`item`) is given what `WinExec` gives `LoadModule` --
   * its command line and show command -- and its current directory, the
   * one `ShellExecute` made current as it started it, as the launcher
   * worked them out from the item (`itemRun`, `kb/guides/launcher.md`).
   * Without one, a program is given no arguments, shown normally, in its
   * own folder.
   */
  run(program: Program, options?: { install?: boolean; item?: ItemStart }): Promise<void>;

  /**
   * What differs on C: from the drive as planned, as it stands: what
   * programs wrote, and what was put back. Null where there is no machine
   * to ask.
   */
  changes(): Promise<Change[] | null>;

  /**
   * Whether no program is running: every one started has ended, or none has
   * -- an installer's shell apart, which runs on as the installer ends.
   */
  idle(): boolean;

  /**
   * A drive's set of images mounted on the machine as it is, as the Drives
   * strip adds one (it is in `Setup.drives` already): at once where a
   * program runs. Why not, where it could not be; null where it was.
   */
  mount(set: DriveSet): Promise<string | null>;

  /** A disk added to a drive's set on the machine as it is (it is in the set already). */
  addDisk(set: DriveSet, disk: number): Promise<string | null>;

  /**
   * A drive's disk, from nought, put in it, the disk that was in kept with
   * what was written to it; its current folder kept, as DOSBox's drive
   * manager keeps it (`Files::swap`, `FileManager.swap`).
   */
  insert(letter: string, disk: number): string | null;

  /** A drive's disk taken out, the drive left empty (`Files::eject`, `FileManager.eject`). */
  eject(letter: string): string | null;

  /** A drive's images let go of, and the drive with them. */
  unmount(letter: string): void;

  /** A disk of a drive's set as programs have written it, for "Save image…"; null for a disc. */
  diskImage(letter: string, disk: number): Uint8Array | null;

  /** Whether programs have written to a disk of a drive's set. */
  diskChanged(letter: string, disk: number): boolean;

  /**
   * Each disk programs have written to kept as written in the page's set
   * (`Disk.written`), for the machine made next to be given: what was
   * written is kept for the visit, across the machine made afresh.
   */
  carry(): void;

  /**
   * Whether the machine has a sound card, where the engine has one to give
   * it: the Rust engine, WinBox's own (`sound.ts`). Given as Windows starts
   * on a machine made afresh (`rebuild`), with its first program.
   */
  sound?: boolean;

  /**
   * Whether what the machine's sound card plays is heard: the page's
   * machine shown alone is, as only its screen is seen; what the others
   * play is let go of as it is made. Their programs run on.
   */
  heard?: boolean;

  /**
   * The machine ended, as its tab is closed: nothing more run, its screen
   * let go of, what it listened for on the page no longer listened for,
   * and what it held given back for the next machine to use.
   */
  dispose(): void;

  /** What there is to prod from the browser's console. */
  readonly session: unknown;
}

/** The text shown on the screen's place before there is a screen. */
export function screenNote(desktop: HTMLElement) {
  const note = document.createElement('p');

  note.className = 'screen-note';
  note.textContent =
    'Windows are drawn from a Windows 3.1 installation, or from your Windows 3.1 ' +
    'setup disks: drop either to see them. ' +
    'Without it, programs still run, but they make no windows.';
  desktop.replaceChildren(note);
}

/** The screen as the page shows it: its canvas, and the host around it. */
export interface Screen {
  canvas: HTMLCanvasElement;

  /** What holds the keyboard, the canvas and the mirror within it. */
  host: HTMLElement;

  /** What a screen reader reads in place of the pixels. */
  mirror: HTMLElement;
}

/**
 * The screen put in the desktop: a canvas its size, drawn as large as the
 * page sizes it (`../ui/desktop.tsx`), and around it what holds the keyboard and what a
 * screen reader reads in place of the pixels: the mirror of USER's windows.
 */
export function makeScreen(desktop: HTMLElement, width: number, height: number): Screen {
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;
  canvas.className = 'screen';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The Windows screen');

  const host = document.createElement('div');
  const mirror = document.createElement('div');

  host.className = 'screen-host';
  host.setAttribute('role', 'application');
  host.setAttribute('aria-label', 'Windows desktop');
  mirror.className = 'aria-mirror';
  host.append(canvas, mirror);
  desktop.replaceChildren(host);

  return { canvas, host, mirror };
}

/** A pointer's event, in the screen's pixels, as the raster desktop's input takes it. */
export interface PointerAt {
  x: number;
  y: number;

  /** The button changed, as a page numbers it: 0 left, 1 middle, 2 right. */
  button: number;

  /** Those down: left 1, right 2, middle 4. */
  buttons: number;
  double: boolean;
  shift: boolean;
  control: boolean;
}

/** A key's event, as the raster desktop's input takes it. */
export interface KeyAt {
  code: string;
  key: string;
  repeat: boolean;
  alt: boolean;
}

/** Where the screen's mouse and keyboard go. */
export interface Input {
  pointer(kind: 'down' | 'up' | 'move', at: PointerAt): void;
  key(kind: 'down' | 'up', at: KeyAt): void;
}

/**
 * The screen's canvas as Windows' mouse and keyboard: a pointer's place, in
 * the screen's pixels however large the canvas is drawn, and each key, handed
 * to the engine's input. The host around the canvas takes the keyboard when
 * the canvas is clicked, and keeps the keys it is given from the page.
 */
export function attachInput({ canvas, host }: Screen, input: Input) {
  host.tabIndex = 0;

  const at = (event: MouseEvent): PointerAt => {
    const box = canvas.getBoundingClientRect();

    return {
      x: Math.floor(((event.clientX - box.left) * canvas.width) / box.width),
      y: Math.floor(((event.clientY - box.top) * canvas.height) / box.height),
      button: event.button,
      buttons: event.buttons,
      double: event.detail === 2,
      shift: event.shiftKey,
      control: event.ctrlKey,
    };
  };

  canvas.addEventListener('mousedown', (event) => {
    host.focus();
    event.preventDefault();
    input.pointer('down', at(event));
  });
  canvas.addEventListener('mouseup', (event) => input.pointer('up', at(event)));
  canvas.addEventListener('mousemove', (event) => input.pointer('move', at(event)));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  /* The keys the page has given Windows as down and not yet up. */
  const held = new Map<string, KeyAt>();

  const key = (kind: 'down' | 'up') => (event: KeyboardEvent) => {
    event.preventDefault();

    const at = {
      code: event.code,
      key: event.key,
      repeat: event.repeat,
      alt: event.altKey,
    };

    if (kind === 'down') {
      held.set(event.code, at);
    } else {
      held.delete(event.code);
    }

    input.key(kind, at);
  };

  host.addEventListener('keydown', key('down'));
  host.addEventListener('keyup', key('up'));

  /* The keyboard taken away from the page -- the host's own Alt and Tab, or
   * a click elsewhere -- with keys still down: their releases go to another
   * program of the host's, and never come here. Each is let go, as the
   * keyboard would have it once the keys are up: Windows' Alt and Tab loop
   * ends, and no key is left held. */
  host.addEventListener('blur', () => {
    for (const at of [...held.values()].reverse()) {
      input.key('up', { ...at, repeat: false, alt: false });
    }

    held.clear();
  });
}
