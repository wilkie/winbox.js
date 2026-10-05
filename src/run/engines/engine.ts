/**
 * What the page asks of an engine, and what it gives one. The page is the
 * same whichever runs the programs: it reads what is dropped, plans the C:
 * drive (`planDrive`), lists the programs, keeps the trace and the status
 * line. An engine makes a machine from the plan, shows its screen in the
 * page's desktop, takes the mouse and keyboard there, and runs programs.
 *
 * Two engines answer it: the TypeScript engine (`ts.ts`), the default, and
 * the Rust engine built for WebAssembly (`rust.ts`), at `run.html?engine=rust`.
 */

import { type Change } from '../changes.js';
import { type Archive, type Plan, type Program } from '../drive.js';

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

/** How the machine is to be made. */
export interface Setup {
  plan: Plan;

  /** The Windows installation dropped, if any, which the plan put under `C:\WINDOWS`. */
  windows: Archive | null;

  /** The display, as `DISPLAY_MODES` names it. */
  display: string;
  coprocessor: boolean;

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

  /** A program on the drive run. */
  run(program: Program): Promise<void>;

  /**
   * What differs on C: from the drive as planned, as it stands: what
   * programs wrote, and what was put back. Null where there is no machine
   * to ask.
   */
  changes(): Promise<Change[] | null>;

  /**
   * Whether the machine has a sound card, where the engine has one to give
   * it: the Rust engine, WinBox's own (`sound.ts`). Given as Windows starts
   * on a machine made afresh (`rebuild`), with its first program.
   */
  sound?: boolean;

  /** What there is to prod from the browser's console. */
  readonly session: unknown;
}

/** The text shown on the screen's place before there is a screen. */
export function screenNote(desktop: HTMLElement) {
  const note = document.createElement('p');

  note.className = 'screen-note';
  note.textContent =
    'Windows are drawn from a Windows 3.1 installation: drop one to see them. ' +
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
 * page allows (`run.css`), and around it what holds the keyboard and what a
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

  const key = (kind: 'down' | 'up') => (event: KeyboardEvent) => {
    event.preventDefault();
    input.key(kind, {
      code: event.code,
      key: event.key,
      repeat: event.repeat,
      alt: event.altKey,
    });
  };

  host.addEventListener('keydown', key('down'));
  host.addEventListener('keyup', key('up'));
}
