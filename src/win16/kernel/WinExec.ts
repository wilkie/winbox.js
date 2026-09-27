'use strict';

import { Executable } from '../../executable.js';
import { streamOf } from '../library.js';
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

  await scheduler.waitReleased(Promise.resolve());

  for (;;) {
    await scheduler.takeSent(me);

    if (!child || child.ended || child.waitingForMessage) {
      break;
    }

    await scheduler.waitReleased(Promise.resolve());
  }

  return task;
}

/**
 * Lets the other tasks run, and goes on when they wait.
 */
export async function Yield(this: any) {
  await this.scheduler.yieldTurn?.();
}

/**
 * Lets the other tasks run, a given one first in Windows; `KRNL386.EXE`
 * takes no arguments from the stack for it. Not followed: the order; the
 * others run in turn, as `Yield` lets them.
 */
export async function DirectedYield(this: any) {
  await this.scheduler.yieldTurn?.();
}
