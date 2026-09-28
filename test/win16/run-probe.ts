'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOS } from '../../src/dos.js';
import { Disk } from '../../src/emulator/disk.js';
import { FAT16 } from '../../src/file-systems/fat16.js';
import { Executable } from '../../src/executable.js';
import { Machine } from '../../src/emulator/machine.js';
import { Win16 } from '../../src/win16.js';
import { fontDirectoryOrder, inDirectoryOrder } from '../../src/win16/font-directory.js';

/**
 * A probe run whole: its program loaded, linked and run on our processor,
 * through our loader, thunks and scheduler, and what it wrote read back as
 * the recorder reads it. `run_program_test` holds its output to the
 * recording; the conformance suite does too, for the probes whose records
 * only a running program can answer.
 */

/** Where the oracle builds the probes. */
export const PROBES = join(__dirname, '..', '..', 'oracle', 'build', 'probes');

/** The installed Windows the probes were recorded against. */
export const IMAGE = join(__dirname, '..', '..', 'oracle', 'build', 'win31.img');

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

/** Loads the probe and runs it, collecting every API call it makes. */
export async function runProbe(
  name = 'strings',
  frames = 600,
  withFonts = false,
  installation = false,
  seconds = 0,
  { boxKeys = [] as string[][] } = {}
) {
  const machine = new Machine();
  const calls: any[] = [];

  // The program says when it is done by asking Windows to end the session.
  let exited = false;

  /* Give the machine a drive. The probe writes its results to a file, which is
   * the whole point -- without somewhere to write, it runs and says nothing.
   */
  let fileSystem: any;

  /* A probe that loads the installation's own libraries runs on a copy of
   * the drive the recording was made on. */
  if (installation) {
    fileSystem = await machine.mountImage(new Uint8Array(readFileSync(IMAGE)));
  } else {
    fileSystem = new FAT16(machine.disks[0]);
    await fileSystem.format();
  }

  await fileSystem.open(['ORACLE'], true);

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
  const raster = installation
    ? {
        driver: await installed(['WINDOWS', 'SYSTEM', 'VGA.DRV']),
        user: await installed(['WINDOWS', 'SYSTEM', 'USER.EXE']),
      }
    : undefined;

  const win16: any = new Win16(new DOS(machine), machine, {
    ...(raster?.driver && raster.user ? { raster } : {}),
    nextFrame: (callback: any) => {
      pending = callback;
    },
    /* What stops the program, kept: a fault inside a call ends the task
     * without a word otherwise. */
    onError: (error: any) => {
      failure ??= error;
    },
    onCall: (call: any) => {
      calls.push(call);

      if (call.name === 'ExitWindows') {
        exited = true;
      }
    },
  });

  const upper = name.toUpperCase();

  const executable: any = new Executable(
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
  win16.run(handle);

  /* The API can suspend on a promise -- writing a file does -- so driving this
   * means letting the timer and microtask queues drain between slices, not
   * just handing the callback straight back.
   */
  let ran = 0;
  const started = Date.now();

  /* Frames, and at least as many seconds: frames pass quickly while a program
   * waits, and one that waits on a timer needs the time to pass. */
  for (; ran < frames || Date.now() - started < seconds * 1000; ran++) {
    if (pending) {
      const callback = pending;
      pending = null;
      callback();
    }

    await new Promise((resolve) => setImmediate(resolve));

    /* `pending` goes empty whenever the program is suspended on an async call,
     * so it is not a sign of having finished. Asking to end the session is.
     */
    if (exited && !pending) {
      break;
    }
  }

  return { machine, win16, calls, fileSystem, frames: ran, failure, shots };
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
