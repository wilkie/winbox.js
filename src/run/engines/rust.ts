/**
 * The Rust engine, built for WebAssembly (`crates/winbox-web`), at
 * `run.html?engine=rust`: its machine filled from the same plan of C: as the
 * TypeScript engine's, so a program sees the same 8.3 names, and a program
 * stepped between the page's frames on the page's own clock.
 *
 * Its module is what `pnpm build:web` writes to `target/winbox-web/`, which is
 * not committed. `pnpm dev` serves the repository's root, so the page imports
 * it from there, at run time, only when this engine is asked for; nothing of it
 * is bundled. The page is not part of `pnpm build`, which builds the library
 * alone, so there is no production build of it to place the module in.
 *
 * Programs run beside one another on the one machine, as on the TypeScript
 * engine: running another, or the same again, while any runs starts it as
 * Program Manager would, in its own folder, a task of its own sharing USER,
 * GDI and the drive with the rest, a second instance given the first as its
 * previous one. Windows stays up once the last has ended, as the TypeScript
 * engine's does: its windows are taken away, as Windows takes a task's away
 * as it ends it, and the next runs on the same machine. A machine is made
 * afresh only where the page rebuilds it, or Windows was exited. Its windows
 * are mirrored for a screen reader as the TypeScript engine's are, from the
 * tree the module makes as that engine makes its own. With Sound ticked,
 * the machine has WinBox's own sound card (`wbsound`), and what it plays is
 * sounded through Web Audio (`sound.ts`).
 */

import { AriaMirror } from '../aria-mirror.js';
import { type Change, orderChanges } from '../changes.js';
import { type Program } from '../drive.js';
import {
  attachInput,
  type Engine,
  type Input,
  makeScreen,
  type Page,
  screenNote,
  type Setup,
} from './engine.js';
import { type SoundEvent, Speaker } from './sound.js';

/** Where `pnpm build:web` writes the module, as `pnpm dev` serves it. */
const GLUE = '/target/winbox-web/winbox_web.js';
const WASM = '/target/winbox-web/winbox_web_bg.wasm';

/** How long a frame's step may run, in milliseconds, leaving the rest of it to the page. */
const SLICE = 12;

/** The machine as `crates/winbox-web/src/lib.rs` hands it to JavaScript. */
interface WasmMachine {
  free(): void;
  add_drive(drive: string): void;
  add_file(drive: string, dosPath: string, bytes: Uint8Array, mtimeSecs: number): boolean;
  add_folder(drive: string, dosPath: string, mtimeSecs: number): boolean;
  remove(drive: string, dosPath: string): boolean;
  mark_planned(): void;
  changes(drive: string): WasmChange[];
  start(path: string): void;
  take_exits(): Uint8Array;
  step(deadlineMs: number): number;
  wake_at(): number;
  stop_reason(): string | undefined;
  exit_code(): number | undefined;
  pointer(
    kind: number,
    x: number,
    y: number,
    button: number,
    buttons: number,
    double: boolean
  ): void;
  key(down: boolean, code: string, key: string, repeat: boolean, alt: boolean): void;
  width(): number;
  height(): number;
  present(): number;
  install_sound(): boolean;
  take_sound(): SoundEvent[];
  take_calls(counts: boolean): string;
  accessible_tree(): string;
}

/** A change on a drive, as `crates/winbox-web/src/lib.rs` hands it over (`DriveChange`). */
interface WasmChange {
  readonly kind: Change['kind'];
  readonly path: string;
  readonly modified: number;
  readonly bytes: Uint8Array;
  free(): void;
}

/** The module's instance: its machine's class, and its memory. */
interface Wasm {
  Machine: new (display: string, coprocessor: boolean) => WasmMachine;
  memory: WebAssembly.Memory;
}

/**
 * What `step` says of the run: to be stepped again, idle until `wake_at`,
 * over, or waiting for a program to start -- none having, or every one
 * having ended.
 */
const BUSY = 0;
const IDLE = 1;
const STOPPED = 2;
const WAITING = 3;

/** The module, compiled once; each instance made from it is a machine's world. */
let compiled: Promise<WebAssembly.Module> | null = null;

/** How many instances have been made, which tells the glue's imports apart. */
let instances = 0;

/** What the module's last panic said, which its trap does not. */
let panicked: string | null = null;

/**
 * The module compiled: fetched once, and kept for every instance after,
 * including the one made when a panic has trapped the last.
 */
function compile() {
  compiled ??= (async () => {
    const response = await fetch(WASM);

    /* Where it was never built, the dev server answers that it is not found,
     * or with a page in its place. */
    if (!response.ok || !/wasm|octet-stream/.test(response.headers.get('content-type') ?? '')) {
      throw new Error(`${WASM} is not there: build it with \`pnpm build:web\``);
    }

    return WebAssembly.compile(await response.arrayBuffer());
  })();

  compiled.catch(() => (compiled = null));
  return compiled;
}

/**
 * A fresh instance of the module. The glue wasm-bindgen writes keeps the one
 * instance it was first given, so each instance imports the glue afresh, told
 * apart by its query; each is given the module compiled once.
 */
async function instantiate(): Promise<Wasm> {
  const module = await compile();
  const glue = await import(/* @vite-ignore */ `${GLUE}?instance=${++instances}`);
  const exports = await glue.default({ module_or_path: module });

  return { Machine: glue.Machine, memory: exports.memory };
}

/* A panic is told to the console, as the module's start hook tells it, before
 * the module traps; it is kept here to say why the run stopped. */
const consoleError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('winbox-web: ')) {
    panicked = args[0].slice('winbox-web: '.length);
  }

  consoleError(...args);
};

/** A screen coordinate as the machine takes it, a signed 16-bit word. */
const word = (value: number) => Math.max(-32768, Math.min(32767, value));

export class RustEngine implements Engine {
  readonly name = 'Rust';
  readonly #page: Page;

  #setup: Setup | null = null;
  #wasm: Wasm | null = null;
  #machine: WasmMachine | null = null;

  /** Whether the machine has started a program, and so has run, or runs. */
  #started = false;

  /** Whether its run is over: Windows exited, or the module stopped it. */
  #over = false;

  /** The program run last, while the run goes on. */
  #running: Program | null = null;

  /** The canvas, where there is a screen, and the image over the module's memory it is drawn from. */
  #canvas: HTMLCanvasElement | null = null;
  #image: ImageData | null = null;
  #imageAt = 0;

  /** The mirror of USER's windows for a screen reader, where there is a screen. */
  #mirror: AriaMirror | null = null;

  /** Whether a machine made afresh has a sound card, WinBox's own, given with its first program. */
  sound = false;

  /** Where the card's sound is heard. */
  readonly #speaker = new Speaker(() => new AudioContext());

  /** The mouse and keyboard, kept until the next frame hands them in. */
  #queue: ((machine: WasmMachine) => void)[] = [];

  /** The frame asked for, or the timer that asks for one when an idle run is due. */
  #frame = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(page: Page) {
    this.#page = page;

    /* A browser lets sound begin on a click or a key, and not before. */
    const wake = () => {
      if (this.sound) {
        this.#speaker.wake();
      }
    };

    addEventListener('pointerdown', wake, true);
    addEventListener('keydown', wake, true);
  }

  get session() {
    return {
      machine: this.#machine,
      setup: this.#setup,
      running: this.#running,
      speaker: this.#speaker,
    };
  }

  async rebuild(setup: Setup) {
    this.#halt();
    this.#setup = setup;
    this.#wasm ??= await instantiate();
    this.#machine = this.#make();
    this.#started = false;
    this.#over = false;
    this.#show();
  }

  async run(program: Program) {
    const page = this.#page;

    if (!this.#setup || !this.#wasm) {
      return;
    }

    page.status(`Running ${program.path}…`);

    try {
      /* Another program, or the same again, once one has started and
       * Windows is up: started beside those running, or, every one having
       * ended, on the same machine. The run takes it up at its next step. */
      if (this.#started && !this.#over && this.#machine) {
        this.#launch(program);
        return;
      }

      /* Once the run is over, a machine made afresh, with what the last
       * one's programs wrote. */
      if (this.#started || !this.#machine) {
        await this.changes();
        this.#halt();
        this.#machine = this.#make();
        this.#over = false;
      }

      /* The sound card's driver named in SYSTEM.INI before Windows reads
       * it; and the speaker woken, the Run button's press being a click. */
      const sound = this.sound && this.#machine.install_sound();

      if (this.sound) {
        this.#speaker.wake();
      }

      this.#started = true;
      this.#machine.start(program.path);
      this.#running = program;
      page.status(
        this.sound && !sound
          ? `${program.path} is running, without sound: there is no SYSTEM.INI to name the driver in.`
          : `${program.path} is running.`
      );
      this.#ask();
    } catch (error: any) {
      this.#failed(error, program);
    }
  }

  /**
   * What differs on C: from the drive as planned, as the machine's module
   * tells it; kept as the changes a machine made afresh for this one is
   * given -- once Windows is exited, or a panic has trapped the module.
   */
  async changes() {
    const machine = this.#machine;

    if (!machine || !this.#setup) {
      return null;
    }

    try {
      const changes = machine.changes('C').map((change): Change => {
        const { kind, path, modified } = change;
        const told: Change =
          kind === 'file'
            ? { kind, path, data: change.bytes, modified }
            : kind === 'folder'
              ? { kind, path, modified }
              : { kind: 'removed', path };

        change.free();
        return told;
      });

      this.#setup.changes = changes;
      return changes;
    } catch {
      /* A trapped instance answers nothing. */
      return null;
    }
  }

  /**
   * A program started beside those running. One that cannot be started is
   * told, as on the TypeScript engine, and the others run on; a trap is
   * the module's, and stops them all.
   */
  #launch(program: Program) {
    try {
      this.#machine!.start(program.path);
    } catch (error: any) {
      if (error instanceof WebAssembly.RuntimeError) {
        throw error;
      }

      this.#page.status(`${program.path} stopped: ${error?.message ?? error}`, 'error');
      return;
    }

    this.#running = program;
    this.#page.status(`${program.path} is running.`);

    /* An idle run waiting on its timer takes the program up at once. */
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.#ask();
  }

  /**
   * A machine made, its C: drive filled from the plan, marked as planned,
   * and what programs wrote before put back on it, in the order the
   * TypeScript engine puts it back on its own (`orderChanges`).
   */
  #make() {
    const { plan, display, coprocessor, changes } = this.#setup!;
    const machine = new this.#wasm!.Machine(display, coprocessor);

    machine.add_drive('C');

    for (const placement of plan.placements) {
      machine.add_file('C', placement.parts.join('\\'), placement.data, placement.modified);
    }

    machine.mark_planned();

    for (const change of orderChanges(changes)) {
      switch (change.kind) {
        case 'removed':
          machine.remove('C', change.path);
          break;
        case 'folder':
          machine.add_folder('C', change.path, change.modified);
          break;
        case 'file':
          machine.add_file('C', change.path, change.data, change.modified);
          break;
      }
    }

    return machine;
  }

  /**
   * The screen shown, where there is a Windows installation to draw windows
   * from, as on the TypeScript engine; else the note saying so.
   */
  #show() {
    const page = this.#page;
    const machine = this.#machine!;

    this.#image = null;
    this.#canvas = null;
    this.#mirror = null;

    if (!this.#setup!.plan.windows) {
      screenNote(page.desktop);
      return;
    }

    const screen = makeScreen(page.desktop, machine.width(), machine.height());

    attachInput(screen, this.#input);
    this.#canvas = screen.canvas;
    this.#mirror = new AriaMirror(screen.mirror, screen.host);
    this.#present();
    this.#reflect();
  }

  /** The mouse and keyboard, kept for the next frame while a program runs. */
  #input: Input = {
    pointer: (kind, at) => {
      const code = kind === 'move' ? 0 : kind === 'down' ? 1 : 2;

      this.#hand((machine) =>
        machine.pointer(code, word(at.x), word(at.y), at.button, at.buttons, at.double)
      );
    },
    key: (kind, at) => {
      this.#hand((machine) => machine.key(kind === 'down', at.code, at.key, at.repeat, at.alt));
    },
  };

  #hand(event: (machine: WasmMachine) => void) {
    if (!this.#running) {
      return;
    }

    this.#queue.push(event);

    /* An idle run waiting on its timer wakes for input at once. */
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#ask();
    }
  }

  /** A frame asked for, once. */
  #ask() {
    this.#frame ||= requestAnimationFrame(this.#step);
  }

  /** Nothing more stepped: the frame and the timer forgotten, the input dropped, the machine freed. */
  #halt() {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;

    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.#queue = [];
    this.#running = null;
    this.#speaker.stop();

    try {
      this.#machine?.free();
    } catch {
      /* A trapped instance's machine is gone with it. */
    }

    this.#machine = null;
  }

  /**
   * A frame's run: the input handed in, the program stepped until the frame's
   * slice is spent, the screen shown, the calls traced; then the next frame,
   * or the time an idle run is due, or the run's end told.
   */
  #step = () => {
    this.#frame = 0;

    const machine = this.#machine;
    const program = this.#running;

    if (!machine || !program) {
      return;
    }

    try {
      for (const event of this.#queue.splice(0)) {
        event(machine);
      }

      const state = machine.step(performance.now() + SLICE);

      this.#present();
      this.#reflect();
      this.#trace();

      /* Each program that ended, the last too, told as the TypeScript
       * engine tells it; 255 for one that faulted. */
      for (const code of machine.take_exits()) {
        this.#page.status(`The program has ended, with exit code ${code}.`);
        this.#page.ended();
      }

      this.#speaker.play(machine.take_sound());

      switch (state) {
        case BUSY:
          this.#ask();
          break;
        case IDLE: {
          const wait = machine.wake_at() - performance.now();

          if (wait > SLICE) {
            this.#timer = setTimeout(() => {
              this.#timer = null;
              this.#ask();
            }, wait - SLICE);
          } else {
            this.#ask();
          }
          break;
        }
        case STOPPED:
          this.#running = null;
          this.#over = true;
          this.#stopped(machine, program);
          break;
        /* Every program has ended, each told as it did, and Windows stays
         * up for the next. */
        case WAITING:
          this.#running = null;
          break;
      }
    } catch (error) {
      this.#failed(error, program);
    }
  };

  /**
   * The run's end, told as the TypeScript engine tells it. With Windows
   * staying up, a run ends only where Windows is exited, which the page's
   * trace has told already (`USER.ExitWindows`).
   */
  #stopped(machine: WasmMachine, program: Program) {
    const reason = machine.stop_reason();
    const code = machine.exit_code();

    if (reason === 'Ended' && code === undefined) {
      return;
    }

    if (reason === 'Ended') {
      this.#page.status(`The program has ended, with exit code ${code}.`);
    } else {
      this.#page.status(`${program.path} stopped: ${reason ?? 'for no reason given'}`, 'error');
    }
  }

  /**
   * The screen as it shows now, put on the canvas: the module's RGBA bytes
   * seen through an image, made again where its memory has grown or the
   * bytes have moved.
   */
  #present() {
    const canvas = this.#canvas;
    const machine = this.#machine;

    if (!canvas || !machine) {
      return;
    }

    const at = machine.present();
    const width = machine.width();
    const height = machine.height();
    const buffer = this.#wasm!.memory.buffer;
    let image = this.#image;

    if (
      !image ||
      image.data.buffer !== buffer ||
      this.#imageAt !== at ||
      image.width !== width ||
      image.height !== height
    ) {
      image = new ImageData(new Uint8ClampedArray(buffer, at, width * height * 4), width, height);
      this.#image = image;
      this.#imageAt = at;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    canvas.getContext('2d')?.putImageData(image, 0, 0);
  }

  /**
   * The mirror brought up to date once a frame, as the TypeScript engine's
   * is: the tree comes as JSON, which the mirror reads only when it is not
   * the text it had last.
   */
  #reflect() {
    const machine = this.#machine;

    if (this.#mirror && machine) {
      this.#mirror.updateFrom(machine.accessible_tree());
    }
  }

  /** The calls made since the last frame, to the page's trace. */
  #trace() {
    for (const line of this.#machine!.take_calls(false).split('\n')) {
      const end = line.indexOf(' = ');

      if (end > 0) {
        this.#page.call(line.slice(0, end), / stub @/.test(line), line);
      }
    }
  }

  /**
   * Something went wrong: told in the status line. A panic traps the module's
   * instance, which then answers nothing; a fresh one is made from the module
   * compiled, and a machine on it, ready to run again.
   */
  #failed(error: any, program: Program) {
    const trapped = error instanceof WebAssembly.RuntimeError;
    const why = (trapped && panicked) || (error?.message ?? String(error));

    console.error(error);
    panicked = null;
    this.#page.status(`${program.path} stopped: ${why}`, 'error');

    if (trapped) {
      this.#wasm = null;
      this.#halt();
      this.rebuild(this.#setup!).catch((again) =>
        this.#page.status(
          `The Rust engine could not be made again: ${again?.message ?? again}`,
          'error'
        )
      );
    } else {
      this.#running = null;
      this.#over = true;
    }
  }
}
