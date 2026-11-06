'use strict';

import { Executable } from '../../executable.js';
import { loadError, missingLibrary, streamOf } from '../library.js';
import { directoryOf, environmentBlock } from './search.js';
import { segmentSelector } from '../selectors.js';
import { locate } from '../shell/programs.js';
import { startProgman, wanted } from '../progman/main.js';
import { startMmtask, wantedMmtask } from '../mmsystem/mmtask.js';

/**
 * Starts a program. **Recorded** by `winexec`, a program of the probe's own
 * started twice:
 *
 * * The command line is the program's name, and after a space what the
 *   program is given: `WINEXECC.EXE alpha  beta` gives it `alpha  beta`,
 *   its spaces kept. A name with no extension is given `.EXE`.
 * * The program is found as `OpenFile` finds it; not found, WinExec answers
 *   the DOS error, 2 for no file and 3 for no path, and 2 for no name.
 * * **The new program runs before WinExec answers**, to the first time it
 *   gives the processor up: through its `WinMain`, its window made and
 *   shown, and its first message taken, to where it waits for a message
 *   with none waiting -- or to its first `PeekMessage` with nothing there
 *   or `Yield` (`execpk`). WinExec answers its instance.
 * * A second start of a program that runs is another instance, given the
 *   first as its previous one; its `WinMain` has the way to show it asked.
 *
 * Not followed: a file that is no Windows program, which Windows starts in a
 * DOS session.
 *
 * @param {Types.LPCSTR} lpszCmdLine - The program's name and what it is given.
 * @param {Types.UINT} fuCmdShow - How its window is to be shown.
 *
 * @returns {Types.UINT} Its instance, or an error below 32.
 */
export async function WinExec(this: any, lpszCmdLine: string | null, fuCmdShow: number) {
  const text = String(lpszCmdLine ?? '').replace(/^ +/, '');
  const space = text.indexOf(' ');
  let name = (space < 0 ? text : text.slice(0, space)).toUpperCase();
  const commandLine = space < 0 ? '' : text.slice(space + 1);

  if (!name) {
    return 2;
  }

  const part = name.slice(Math.max(name.lastIndexOf('\\'), name.lastIndexOf(':')) + 1);

  if (!part.includes('.')) {
    name += '.EXE';
  }

  const found = await locate(this, name, '');

  /* `PROGMAN.EXE` found nowhere: WinBox's own (`progman/`). */
  if ('error' in found && found.error === 2 && wanted(name)) {
    return startProgman(this, commandLine, fuCmdShow & 0xffff);
  }

  if ('error' in found) {
    return found.error;
  }

  return startProgram(this, found.path, commandLine, fuCmdShow & 0xffff);
}

/**
 * The instance of the program at `path` already running, if any, which a
 * second start of it is given as its previous one; else 0.
 */
export function previousInstance(system: any, path: string) {
  const found = Object.entries(system.scheduler._tasks ?? {}).find(
    ([, task]: [string, any]) =>
      !task.ended && String(task.executable?.path ?? '').toUpperCase() === path.toUpperCase()
  );

  return Number(found?.[0] ?? 0);
}

/**
 * A program started from its file: loaded, linked and set going, and run
 * until it first gives the processor up; its instance.
 */
export async function startProgram(
  system: any,
  path: string,
  commandLine: string,
  show: number,
  environment?: Uint8Array,
  out?: { task?: number }
) {
  const handle = await system.dos.files.open(path);

  if (!handle) {
    return 2;
  }

  let bytes: Uint8Array;

  try {
    const file = system.dos.files.resolve(handle);

    bytes = new Uint8Array(await file.read(0, file.size));
  } finally {
    system.dos.files.close(handle);
  }

  /* No Windows program: what `LoadModule` answers of it (`loadError`). */
  const failed = loadError(bytes);

  if (failed !== null) {
    return failed;
  }

  const module = path.slice(path.lastIndexOf('\\') + 1).replace(/\.[^.]*$/, '');
  const executable: any = new Executable(module, path, streamOf(bytes));

  await executable.parse();

  return startExecutable(system, executable, path, commandLine, show, environment, undefined, out);
}

/**
 * A program started, as `startProgram` starts one, from its executable as
 * read: from its file, or made in memory (`progman/`), `loaded` told of its
 * task once it is made and before it runs. Its instance.
 */
export async function startExecutable(
  system: any,
  executable: any,
  path: string,
  commandLine: string,
  show: number,
  environment?: Uint8Array,
  loaded?: (task: any) => void,
  out?: { task?: number }
) {
  if (await missingLibrary(system, executable, directoryOf(path))) {
    return 2;
  }

  /* The parent's environment, as its segment holds it -- changed, it may
   * be, by the parent (`search`) -- unless one is given. */
  const inherited = environment ?? environmentBlock(system);
  const previous = previousInstance(system, path);
  const task = await system.load(executable);

  if (out) {
    out.task = task;
  }

  system.link(task);
  system.run(task, { commandLine, show, previous, environment: inherited });
  loaded?.(system.handles.resolve(task));

  /* The new program has the processor first: KERNEL gives it up once, by
   * `Yield`, as the task is made (`KRNL386.EXE` seg2 `13a1`-`13a8`, seg1
   * `7d21`), and this one has it back the first time the new one gives it
   * up -- by `PeekMessage` or `Yield` as much as by waiting for a message
   * -- or ends (**recorded** by `execpk`). */
  const scheduler = system.scheduler;

  /* The new program's instance: its data segment's handle (`instds`), as
   * the task was made -- a program that has ended by the time this has the
   * processor back has given its segments back (`exitTask`). */
  const loader = scheduler._tasks[task]?.loader;
  const instance = loader ? segmentSelector(loader.translate(loader.ds)) - 1 : task;

  await scheduler.yieldTurn();

  return instance;
}

/**
 * Lets the other tasks run, and goes on when they wait: **recorded** by
 * `tasks2`, every task waiting runs, in the order it was woken, before this
 * one goes on.
 */
export async function Yield(this: any) {
  await this.scheduler.yieldTurn?.();
}

/**
 * The processor given up as KERNEL gives it up itself, with no look at
 * USER's queue (`KRNL386.EXE` seg1 `7d3e`-`7d6f`): an event given the task
 * and taken back around the switch, and FFFFh answered -- nought, with no
 * switch, while KERNEL's word at 24Bh says it may not. `Yield` comes here
 * for a task with no queue. `MMTASK.TSK` calls it.
 */
export async function OldYield(this: any) {
  await this.scheduler.yieldTurn?.();

  return 0xffff;
}

/**
 * Lets the other tasks run, a given one first: **recorded** by `tasks2`, the
 * one named, then the rest in the order they were woken, then this one.
 * `KRNL386.EXE` takes its argument by moving its return address over it
 * (seg1 `7cff`).
 *
 * @param {Types.HANDLE} hTask - The task to run first.
 */
export async function DirectedYield(this: any, hTask: number) {
  await this.scheduler.yieldTurn?.(hTask & 0xffff);
}

/**
 * Starts a program with a parameter block, as `WinExec` does with a command
 * line: **recorded** by `tasks2`. The block is an environment's segment, a
 * far pointer to the command's tail -- its length in a byte, then its
 * characters -- and a far pointer to two words, 2 and the way to show the
 * window. A block of -1 loads a library instead.
 *
 * An environment of the block's own is given as its strings alone, then a
 * count of nought and no path; with none, the parent's is given whole, its
 * path too: **recorded** by `loadenv`.
 *
 * @param {Types.LPCSTR} lpszModuleName - The program's file.
 * @param {Types.FARPTR} lpvParameterBlock - The parameter block.
 *
 * @returns {Types.HINSTANCE} Its instance, or an error below 32.
 */
export async function LoadModule(
  this: any,
  lpszModuleName: string | null,
  lpvParameterBlock: number
) {
  const block = lpvParameterBlock >>> 0;

  if (block === 0xffffffff) {
    const { LoadLibrary } = await import('./LoadLibrary.js');

    return LoadLibrary.call(this, lpszModuleName);
  }

  let name = String(lpszModuleName ?? '').toUpperCase();

  if (!name) {
    return 2;
  }

  const part = name.slice(Math.max(name.lastIndexOf('\\'), name.lastIndexOf(':')) + 1);

  if (!part.includes('.')) {
    name += '.EXE';
  }

  const core = this.machine.cpu.core;
  const word = (far: number, at: number) => core.read16(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  const far = (at: number) => ((word(block, at + 2) << 16) | word(block, at)) >>> 0;
  let commandLine = '';
  let show = 1;
  let environment: Uint8Array | undefined;

  if (block && word(block, 0)) {
    environment = environmentStrings(core, word(block, 0));
  }

  if (block) {
    const tail = far(2);
    const shows = far(6);

    if (tail) {
      const length = core.read8(tail >>> 16, tail & 0xffff);

      for (let at = 1; at <= length; at++) {
        commandLine += String.fromCharCode(
          core.read8(tail >>> 16, ((tail & 0xffff) + at) & 0xffff)
        );
      }
    }

    if (shows && word(shows, 0) >= 2) {
      show = word(shows, 2);
    }
  }

  return startNamed(this, name, commandLine, show, environment);
}

/**
 * A program named started, as `LoadModule` starts it once its block is
 * read: found as KERNEL looks for it, or, for `PROGMAN.EXE` and
 * `MMTASK.TSK` found nowhere, WinBox's own (`progman/`,
 * `mmsystem/mmtask.ts`). The instance in AX, or an error below 32; the new
 * task in DX: `KRNL386.EXE` seg2 `1d4f`, the task `1321` made (`1374`,
 * `1b59`, `1c30`), nought where none was (**recorded** by `mmtaskc`).
 */
export async function startNamed(
  system: any,
  name: string,
  commandLine: string,
  show: number,
  environment?: Uint8Array
) {
  const found = await locate(system, name, '');
  const progman = 'error' in found && found.error === 2 && wanted(name);
  const mmtask = 'error' in found && found.error === 2 && wantedMmtask(name);

  if ('error' in found && !progman && !mmtask) {
    return found.error;
  }

  const out: { task?: number } = {};
  const instance = mmtask
    ? await startMmtask(system, commandLine, show, environment, out)
    : 'error' in found
      ? await startProgman(system, commandLine, show, environment, out)
      : await startProgram(system, found.path, commandLine, show, environment, out);
  const task = (instance & 0xffff) >= 32 ? (out.task ?? 0) : 0;

  return (((task & 0xffff) << 16) | (instance & 0xffff)) >>> 0;
}

/** An environment's strings from a segment, to the nought that ends them, then a count of nought and no path. */
function environmentStrings(core: any, segment: number) {
  const bytes: number[] = [];

  for (let at = 0; at < 0x8000; at++) {
    const byte = core.read8(segment, at);

    if (byte === 0 && (at === 0 || bytes[bytes.length - 1] === 0)) {
      break;
    }

    bytes.push(byte);
  }

  bytes.push(0, 0, 0, 0);

  return new Uint8Array(bytes);
}
