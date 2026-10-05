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
 * One program runs at a time, on a machine of its own: running another, or
 * the same again, makes a fresh machine from the plan. Its windows are
 * mirrored for a screen reader as the TypeScript engine's are, from the tree
 * the module makes as that engine makes its own. With Sound ticked, the machine
 * has WinBox's own sound card (`wbsound`), and what it plays is sounded
 * through Web Audio (`sound.ts`).
 */

import { AriaMirror } from '../aria-mirror.js';
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
  start(path: string): void;
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

/** The module's instance: its machine's class, and its memory. */
interface Wasm {
  Machine: new (display: string, coprocessor: boolean) => WasmMachine;
  memory: WebAssembly.Memory;
}

/** What `step` says of the run: to be stepped again, idle until `wake_at`, over, or not started. */
const BUSY = 0;
const IDLE = 1;
const STOPPED = 2;

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

  /** Whether the machine has started a program, which it does once. */
  #started = false;

  /** The program running, while it runs. */
  #running: Program | null = null;

  /** The canvas, where there is a screen, and the image over the module's memory it is drawn from. */
  #canvas: HTMLCanvasElement | null = null;
  #image: ImageData | null = null;
  #imageAt = 0;

  /** The mirror of USER's windows for a screen reader, where there is a screen. */
  #mirror: AriaMirror | null = null;

  /** Whether the next run's machine has a sound card, WinBox's own. */
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
    this.#show();
  }

  async run(program: Program) {
    const page = this.#page;

    if (!this.#setup || !this.#wasm) {
      return;
    }

    page.status(`Running ${program.path}…`);

    try {
      /* A machine starts one program: another, or the same again, starts on
       * a machine of its own. */
      if (this.#started || !this.#machine) {
        this.#halt();
        this.#machine = this.#make();
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

  /** A machine made, its C: drive filled from the plan. */
  #make() {
    const { plan, display, coprocessor } = this.#setup!;
    const machine = new this.#wasm!.Machine(display, coprocessor);

    machine.add_drive('C');

    for (const placement of plan.placements) {
      machine.add_file('C', placement.parts.join('\\'), placement.data, placement.modified);
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
          this.#stopped(machine, program);
          break;
      }
    } catch (error) {
      this.#failed(error, program);
    }
  };

  /** The run's end, told as the TypeScript engine tells it. */
  #stopped(machine: WasmMachine, program: Program) {
    const reason = machine.stop_reason();
    const code = machine.exit_code();

    if (reason === 'Ended' && code !== undefined) {
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
    }
  }
}
