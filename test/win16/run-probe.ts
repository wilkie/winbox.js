'use strict';

import { installPrinter } from '../../src/win16/printer.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOS } from '../../src/dos.js';
import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { Executable } from '../../src/executable.js';
import { Machine } from '../../src/emulator/machine.js';
import { FAITHFUL_INSTRUCTIONS_PER_MS } from '../../src/emulator/clock.js';
import { Win16 } from '../../src/win16.js';
import { fontDirectoryOrder, inDirectoryOrder } from '../../src/win16/font-directory.js';
import { accessibleTree, type AccessibleTree } from '../../src/win16/user/accessible-tree.js';

/**
 * A probe run whole: its program loaded, linked and run on our processor,
 * through our loader, thunks and scheduler, and what it wrote read back as
 * the recorder reads it. `run_program_test` holds its output to the
 * recording; the conformance suite does too, for the probes whose records
 * only a running program can answer.
 */

/** The X keysyms `record.mjs --then` names keys by, as the key codes the desktop takes. */
const KEYSYMS: Record<string, string> = {
  Return: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  space: 'Space',
  Shift_L: 'ShiftLeft',
  Alt_L: 'AltLeft',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

/** Where the oracle builds the probes. */
export const PROBES = join(__dirname, '..', '..', 'oracle', 'build', 'probes');

/** The installed Windows the probes were recorded against. */
export const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

/** Another display's installation, as `build-drive.mjs --display` makes it. */
export function imageFor(display: string) {
  return display === 'vga'
    ? IMAGE
    : join(__dirname, '..', '..', 'oracle', 'build', `win31-${display}.img`);
}

/** A file-like over bytes, offering what a loader asks a file for. */
export class MemoryFile {
  constructor(private bytes: Uint8Array) {}

  get size() {
    return this.bytes.byteLength;
  }

  async read(offset: number, length: number) {
    return this.bytes.slice(offset, offset + length).buffer;
  }

  async read8(offset: number) {
    return this.bytes[offset];
  }

  async read16(offset: number, littleEndian = true) {
    return littleEndian
      ? this.bytes[offset] | (this.bytes[offset + 1] << 8)
      : (this.bytes[offset] << 8) | this.bytes[offset + 1];
  }

  async read32(offset: number, littleEndian = true) {
    return new DataView(this.bytes.buffer, this.bytes.byteOffset).getUint32(offset, littleEndian);
  }

  async readCString(offset: number, max: number) {
    let text = '';

    for (let index = 0; index < max; index++) {
      const byte = this.bytes[offset + index];

      if (!byte) {
        break;
      }

      text += String.fromCharCode(byte);
    }

    return text;
  }
}

/** Probes recorded with a printer installed (`--display vgaprint`). */
const PRINTING = new Set(['printing']);

/** Loads the probe and runs it, collecting every API call it makes. */
export async function runProbe(
  name = 'strings',
  frames = 600,
  withFonts = false,
  installation = false,
  seconds = 0,
  {
    boxKeys = [] as string[][],
    program = null as { directory: string; file: string; folder: string } | null,
    virtual = false,
    keepCalls = Infinity,
    display = 'vga',
    steps = [] as { keys: string[]; seconds: number }[],
    /* The accessibility tree kept with each screen a step keeps, and as the
     * program makes each call `treeAt` picks -- before the call is made --
     * each noted as a screen's place is, for another engine to keep its own
     * at the same place (`accessible_parity_test.ts`). */
    trees = false,
    treeAt = null as ((call: any, count: number) => boolean) | null,
  } = {}
) {
  /* On a virtual clock, time is the instructions run (`clock.ts`), from a
   * morning of winbox.js's choosing, so a run is the same however long the
   * host takes over it. */
  const faithful = process.env.WINBOX_CLOCK === 'faithful';
  const machine = new Machine(
    virtual
      ? {
          clock: {
            virtual: true,
            epoch: new Date(1992, 3, 6, 9, 0, 0).getTime(),
            /* The faithful clock, `WINBOX_CLOCK=faithful`: Windows' rate under
             * the recorder's DOSBox and calls charged as recorded; or either
             * set apart (`topics/timing`). None set, the survey's clock. */
            rate:
              Number(process.env.WINBOX_CLOCK_RATE) ||
              (faithful ? FAITHFUL_INSTRUCTIONS_PER_MS : undefined),
            measuredCalls: faithful || process.env.WINBOX_CLOCK_CALLS === 'measured',
          },
        }
      : {}
  );
  const clock = machine.clock;
  const calls: any[] = [];
  /* The last thousand calls, in a ring: shifted off an array's front, each
   * of millions of calls moved the thousand along. */
  const tail: any[] = [];
  let tailAt = 0;
  const functions = new Set<string>();
  const stubs: Record<string, number> = {};
  let callCount = 0;

  // The program says when it is done by asking Windows to end the session.
  let exited = false;

  /* Where in the run each step's key went in and each step's screen was
   * taken: the calls made by then and the clock's time, for another engine
   * to do the same at the same place (`examples/corpus.rs`): the
   * instructions run name it exactly, between two of the program's calls. */
  const stepMarks: {
    calls: number;
    instructions: number;
    time: number;
    key?: string;
    code?: string;
    kind?: string;
    alt?: boolean;
  }[] = [];

  /* The trees kept, one at each place without a key in `stepMarks`. */
  const keptTrees: AccessibleTree[] = [];

  /* Give the machine a drive. The probe writes its results to a file, which is
   * the whole point -- without somewhere to write, it runs and says nothing.
   */
  let fileSystem: any;

  /* A probe that loads the installation's own libraries runs on a copy of
   * the drive the recording was made on. */
  if (installation) {
    fileSystem = await machine.mountImage(new Uint8Array(readFileSync(imageFor(display))));
  } else {
    fileSystem = new FAT16(machine.disks[0]);
    await fileSystem.format();
  }

  await fileSystem.open(['ORACLE'], true);

  /* A probe that prints, recorded with a printer installed: winbox.js's own
   * is installed into the copy, as Control Panel would write it into WIN.INI
   * (`printer.ts`). */
  if (installation && PRINTING.has(name)) {
    const ini = await fileSystem.open(['WINDOWS', 'WIN.INI']);
    const bytes = new Uint8Array(await ini.read(0, ini.info.size));
    const text = installPrinter(String.fromCharCode(...bytes));

    await fileSystem.map(
      ['WINDOWS', 'WIN.INI'],
      new DataView(Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff).buffer)
    );
  }

  /* And the library a probe brings, where the recorder puts it: beside
   * Windows. See `build-probes.mjs`. */
  const library = join(PROBES, `${name.toUpperCase()}D.DLL`);

  if (installation && existsSync(library)) {
    await fileSystem.map(
      ['WINDOWS', `${name.toUpperCase()}D.DLL`],
      new DataView(new Uint8Array(readFileSync(library)).buffer)
    );
  }

  /* And the program it starts. */
  const child = join(PROBES, `${name.toUpperCase()}C.EXE`);

  if (installation && existsSync(child)) {
    await fileSystem.map(
      ['WINDOWS', `${name.toUpperCase()}C.EXE`],
      new DataView(new Uint8Array(readFileSync(child)).buffer)
    );
  }

  /* The scheduler hands the next slice of execution to a frame driver, which
   * in a browser is the animation frame. Here it is a trampoline: the callback
   * has to return before the next slice starts, and calling it inline just
   * recurses until the stack runs out.
   */
  let pending: any = null;
  let failure: any = null;

  /* On the installation's drive, the desktop too, from its display driver and
   * USER: without one, a window is not made. */
  const installed = async (parts: string[]) => {
    const file = await fileSystem.open(parts);

    return file ? new Uint8Array(await file.read(0, file.info.size)) : null;
  };
  /* The display driver `SYSTEM.INI` names: `SVGA256.DRV` on the 256-colour
   * installation. */
  const ini = installation ? await installed(['WINDOWS', 'SYSTEM.INI']) : null;
  const driverName =
    (ini && /^display\.drv\s*=\s*(\S+)/im.exec(String.fromCharCode(...ini))?.[1]) || 'VGA.DRV';
  const raster = installation
    ? {
        driver: await installed(['WINDOWS', 'SYSTEM', driverName.toUpperCase()]),
        user: await installed(['WINDOWS', 'SYSTEM', 'USER.EXE']),
      }
    : undefined;

  const win16: any = new Win16(new DOS(machine), machine, {
    ...(display === 'vga' ? {} : { display }),
    ...(raster?.driver && raster.user ? { raster } : {}),
    nextFrame: (callback: any) => {
      pending = callback;
    },
    /* What stops the program, kept: a fault inside a call ends the task
     * without a word otherwise. */
    onError: (error: any) => {
      failure ??= error;
    },
    /* Every call counted, by name, stubs apart; the first `keepCalls` kept
     * whole and the last thousand after them: a program that polls makes
     * millions, more than the host has memory for. */
    onCall: (call: any) => {
      const name = `${call.module}.${call.name}`;

      callCount++;
      functions.add(name);

      if (call.stub) {
        stubs[name] = (stubs[name] ?? 0) + 1;
      }

      if (calls.length < keepCalls) {
        calls.push(call);
      } else {
        if (tail.length < 1000) {
          tail.push(call);
        } else {
          tail[tailAt] = call;
          tailAt = (tailAt + 1) % 1000;
        }
      }

      if (call.name === 'ExitWindows') {
        exited = true;
      }

      /* Kept before the call is made: the calls before it answered. Its
       * place is the instructions alone, the time left at nought, as the
       * other engine's clock may stand a call's charge apart. */
      if (treeAt?.(call, callCount)) {
        stepMarks.push({
          calls: callCount - 1,
          instructions: machine.cpu._cycleCount,
          time: 0,
        });
        keptTrees.push(accessibleTree(win16.rasterDesktop));
      }
    },
  });

  const upper = name.toUpperCase();

  /* A program of the corpus: its folder on the drive as `C:\CORPUS\<id>`,
   * every file of it, and the program run from there. */
  const home = program ? `C:\\CORPUS\\${program.folder}` : null;

  if (program) {
    await mapFolder(fileSystem, program.directory, ['CORPUS', program.folder]);
  }

  const executable: any = program
    ? new Executable(
        program.file.replace(/\.[^.]*$/, '').toUpperCase(),
        `${home}\\${program.file.toUpperCase()}`,
        new MemoryFile(new Uint8Array(readFileSync(join(program.directory, program.file))))
      )
    : new Executable(
        upper,
        `C:\\${upper}.EXE`,
        new MemoryFile(new Uint8Array(readFileSync(join(PROBES, `${upper}.EXE`))))
      );

  await executable.parse();

  /* The fonts a running system would already have loaded. `boot` reads them
   * off `C:\WINDOWS\SYSTEM`, which on this scratch drive holds nothing, so
   * they come from the installed Windows the recording was made against --
   * the same files, by the same reader.
   */
  if (installation) {
    await win16.boot();
  } else if (withFonts) {
    await loadInstalledFonts(win16);
  }

  /* A box of USER's own that lets no program run is answered as a person
   * would: each time one comes up, the next list of keys, pressed and
   * released in turn; `shoot` takes the screen instead, as the recorder
   * took Windows' (`record.mjs --shoot`). */
  const shots: Uint8Array[] = [];
  const keysLeft = [...boxKeys];
  const shoot = () => shots.push(Uint8Array.from(win16.rasterDesktop.screen.indices));

  win16.sysErrorBoxShown = () => {
    const keys = keysLeft.shift() ?? [];

    shoot();
    setTimeout(async () => {
      for (const code of keys) {
        if (code === 'shoot') {
          shoot();
          continue;
        }

        for (const kind of ['down', 'up'] as const) {
          win16.rasterInput.key(kind, { code, key: code, repeat: false, alt: false });
          await new Promise((next) => setTimeout(next, 0));
        }
      }
    }, 0);
  };

  const handle = await win16.load(executable);
  win16.link(handle);
  /* Started in its own folder, as Program Manager starts a program whose
   * item's working directory is where the program is: the directory
   * Program Manager gives a new item. */
  win16.run(handle, home ? { directory: home } : {});

  /* The API can suspend on a promise -- writing a file does -- so driving this
   * means letting the timer and microtask queues drain between slices, not
   * just handing the callback straight back.
   */
  let ran = 0;
  const started = clock.now();

  /* Frames, and at least as many seconds: frames pass quickly while a program
   * waits, and one that waits on a timer needs the time to pass. On a virtual
   * clock a frame is a length of time, so the seconds alone. */
  let until = seconds * 1000;
  const going = () =>
    clock.virtual ? clock.now() - started < until : ran < frames || clock.now() - started < until;
  const stepShots: Uint8Array[] = [];

  /* A key pressed or let go, noted where it was. */
  const press = async (keysym: string, kind: 'down' | 'up', alt: boolean) => {
    const code =
      KEYSYMS[keysym] ?? (/^[a-z]$/i.test(keysym) ? `Key${keysym.toUpperCase()}` : keysym);
    /* What it types, as a page's event names it: the keysym, but for space. */
    const key = keysym === 'space' ? ' ' : keysym;

    stepMarks.push({
      calls: callCount,
      instructions: machine.cpu._cycleCount,
      time: clock.now(),
      key,
      code,
      kind,
      ...(alt ? { alt } : {}),
    });
    win16.rasterInput.key(kind, { code, key, repeat: false, alt });
    await new Promise((next) => setImmediate(next));
  };

  /* Then each step, as `record.mjs --then keys:seconds` takes them: keys
   * pressed in turn, the program run on for the seconds, and the screen
   * kept. Keys are X keysyms, as the recorder presses them; `Alt_L+space`
   * is space pressed and let go while Alt is held. */
  for (let step = 0; step <= steps.length; step++) {
    if (step > 0) {
      for (const keysym of steps[step - 1].keys) {
        const [first, held] = keysym.length > 1 ? keysym.split('+') : [keysym];

        if (held !== undefined && first === 'Alt_L') {
          await press(first, 'down', false);
          await press(held, 'down', true);
          await press(held, 'up', true);
          await press(first, 'up', false);
          continue;
        }

        for (const kind of ['down', 'up'] as const) {
          await press(keysym, kind, false);
        }
      }

      until = clock.now() - started + steps[step - 1].seconds * 1000;
    }

    await runFor();

    /* The screen at the end of the main run, then after each step. */
    if (steps.length) {
      stepMarks.push({
        calls: callCount,
        instructions: machine.cpu._cycleCount,
        time: clock.now(),
      });
      stepShots.push(Uint8Array.from(win16.rasterDesktop.screen.indices));

      if (trees) {
        keptTrees.push(accessibleTree(win16.rasterDesktop));
      }
    }

    if (exited) {
      break;
    }
  }

  async function runFor() {
    for (; going(); ran++) {
      if (pending) {
        const callback = pending;
        pending = null;
        callback();
      }

      await new Promise((resolve) => setImmediate(resolve));

      /* Nothing ran and nothing will until a time comes: a virtual clock goes
       * straight to it, or on by a frame when nothing waits for one. */
      if (clock.virtual && !pending && !clock.idle()) {
        clock.advance(1000 / 30);
      }

      /* `pending` goes empty whenever the program is suspended on an async call,
       * so it is not a sign of having finished. Asking to end the session is.
       */
      if (exited && !pending) {
        break;
      }
    }
  }

  return {
    machine,
    win16,
    calls,
    tail: [...tail.slice(tailAt), ...tail.slice(0, tailAt)],
    callCount,
    functions,
    stubs,
    fileSystem,
    frames: ran,
    failure,
    shots,
    stepShots,
    stepMarks,
    trees: keptTrees,
  };
}

/** A folder of the host's, and every folder in it, put on the drive under `parts`. */
async function mapFolder(fileSystem: any, directory: string, parts: string[]) {
  await fileSystem.open(parts, true);

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = entry.name.toUpperCase();

    if (entry.isDirectory()) {
      await mapFolder(fileSystem, join(directory, entry.name), [...parts, name]);
    } else {
      await fileSystem.map(
        [...parts, name],
        new DataView(new Uint8Array(readFileSync(join(directory, entry.name))).buffer)
      );
    }
  }
}

/**
 * Puts the installed fonts on a system, the way starting up would.
 *
 * Nothing can be asked about text without them: a device context with no font
 * in it is not a state Windows hands out, and every answer the text probe
 * records is a property of a particular installed file at a particular size.
 */
export async function loadInstalledFonts(win16: any) {
  const bytes = new Uint8Array(readFileSync(IMAGE));
  const disk = new Disk(bytes.byteLength, 512, 32768);

  disk.load(bytes);

  const installed: any = new FAT16(disk);
  await installed.mount();

  /* In GDI's own order, which is the two profiles and not the directory
   * listing: the mapper's ties go to the earliest entry, and this system has
   * `DOSAPP.FON` on it, whose five faces called Terminal GDI never has in its
   * directory at all. See `font-directory.ts`.
   */
  const text = async (name: string) => {
    const file = await installed.open(['WINDOWS', name]);

    if (!file) {
      return null;
    }

    const bytes = new Uint8Array(await file.read(0, file.size));

    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  };

  const order = fontDirectoryOrder(await text('SYSTEM.INI'), await text('WIN.INI'));

  const names = (await installed.list(['WINDOWS', 'SYSTEM']))
    .map((entry: any) => String(entry.info.name))
    .filter((name: string) => name.toUpperCase().endsWith('.FON'));

  for (const name of inDirectoryOrder(names, order, (one: string) => one)) {
    await win16.fonts.load(await installed.open(['WINDOWS', 'SYSTEM', name]));
  }
}

/** Reads what the probe wrote, as the recorder would read it. */
export async function outputOf(fileSystem: any, name = 'strings') {
  const file = await fileSystem.open(['ORACLE', `${name.toUpperCase()}.OUT`]);

  if (!file) {
    return null;
  }

  return Buffer.from(await file.read(0, file.info.size)).toString('latin1');
}

/**
 * Turns a probe's output into the same shape the fixture records it in.
 *
 * The probe escapes tabs, newlines and backslashes on the way out, since those
 * are what separate the fields; the recorder undoes that, so this has to too.
 */
export function recordsFrom(text: string) {
  const unescape = (field: string) =>
    field.replace(
      /\\([\\trn])/g,
      (_, code) => ({ '\\': '\\', t: '\t', r: '\r', n: '\n' })[code] as string
    );

  return text
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => line.split('\t').map(unescape))
    .filter(([name]) => name !== '#')
    .map(([name, args, value]) => `${name}(${args}) = ${value}`);
}
