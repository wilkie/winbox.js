'use strict';

import { Executable } from '../../executable.js';
import { streamOf } from '../library.js';
import { segmentSelector } from '../selectors.js';
import { locate } from '../shell/programs.js';

/**
 * Starts a program. **Recorded** by `winexec`, a program of the probe's own
 * started twice:
 *
 * * The command line is the program's name, and after a space what the
 *   program is given: `WINEXECC.EXE alpha  beta` gives it `alpha  beta`,
 *   its spaces kept. A name with no extension is given `.EXE`.
 * * The program is found as `OpenFile` finds it; not found, WinExec answers
 *   the DOS error, 2 for no file and 3 for no path, and 2 for no name.
 * * **The new program runs before WinExec answers**: through its `WinMain`,
 *   its window made and shown, and its first message taken, to the point it
 *   waits for a message with none waiting. WinExec answers its instance.
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

  if ('error' in found) {
    return found.error;
  }

  return startProgram(this, found.path, commandLine, fuCmdShow & 0xffff);
}

/**
 * A program started from its file: loaded, linked and set going, and run
 * until it waits for a message; its instance.
 */
export async function startProgram(system: any, path: string, commandLine: string, show: number) {
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

  const module = path.slice(path.lastIndexOf('\\') + 1).replace(/\.[^.]*$/, '');
  const executable: any = new Executable(module, path, streamOf(bytes));

  await executable.parse();

  /* The instance of the same program already running, if any. */
  const previous =
    Object.entries(system.scheduler._tasks ?? {}).find(
      ([, task]: [string, any]) =>
        !task.ended && String(task.executable?.path ?? '').toUpperCase() === path.toUpperCase()
    )?.[0] ?? 0;

  const task = await system.load(executable);

  system.link(task);
  system.run(task, { commandLine, show, previous: Number(previous) });

  /* The new program has the processor first; this one has it back when the
   * new one waits for a message, answering what it sends meanwhile. */
  const scheduler = system.scheduler;
  const me = scheduler.task;
  const child = scheduler._tasks[task];

  await scheduler.yieldTurn();

  while (child && !child.ended && !child.waitingForMessage) {
    await scheduler.yieldTurn();
  }

  void me;

  /* The new program's instance: its data segment's handle (`instds`). */
  const loader = scheduler._tasks[task]?.loader;

  return loader ? segmentSelector(loader.translate(loader.ds)) - 1 : task;
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
 * Not followed: an environment of the block's own; the parent's is given.
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

  const found = await locate(this, name, '');

  if ('error' in found) {
    return found.error;
  }

  const core = this.machine.cpu.core;
  const word = (far: number, at: number) => core.read16(far >>> 16, ((far & 0xffff) + at) & 0xffff);
  const far = (at: number) => ((word(block, at + 2) << 16) | word(block, at)) >>> 0;
  let commandLine = '';
  let show = 1;

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

  return startProgram(this, found.path, commandLine, show);
}
