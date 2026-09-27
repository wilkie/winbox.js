'use strict';

import { GlobalAlloc } from './GlobalAlloc.js';
import { GlobalFree } from './GlobalFree.js';
import { GlobalLock } from './GlobalLock.js';
import { FARPTR, UINT } from '../types.js';

/**
 * `FileCdr`: the one procedure KERNEL tells when a file changes, which File
 * Manager sets so that its windows follow what other programs do to the
 * disk.
 *
 * **Read out** of `KRNL386.EXE` (seg3 `888`, seg1 `7f19`) and **recorded** by
 * `filecdr`:
 *
 * * Given a pointer whose segment is FFFFh, it answers the procedure set,
 *   nought for none. Given any other, it sets it -- nought clears it -- and
 *   answers 1, unless another task set the one there, when it answers
 *   nought and leaves it.
 * * After a create (3Ch, 5Bh), a delete (41h), a rename (56h), a directory
 *   made or taken away (39h, 3Ah) or attributes set (4301h) succeeds, the
 *   procedure is called with the function's AX -- the function in AH, and in
 *   AL whatever the caller had there -- and the whole path: the drive, the
 *   current directory unless the path begins at the root, and the path as it
 *   was given. A rename's new name follows the old one's null, as given.
 *   A write, a close, an open of a file that is there, and a call that
 *   fails, tell it nothing.
 * * KERNEL's own calls tell it too: `_lcreat` and `OpenFile` creating as 3Ch,
 *   `OpenFile` deleting as 41h -- with AL 00h, 01h and 00h in a first
 *   recording, which the probe no longer keeps, AL being the caller's.
 *
 * Not followed: what KERNEL does with the procedure when the task that set
 * it ends.
 */

const QUERY = 0xffff;

/** The functions that tell it, by AH; 43h only setting. */
const TELLING = new Set([0x39, 0x3a, 0x3c, 0x41, 0x56, 0x5b]);

interface Hook {
  proc: number;
  owner: number;
}

function hookOf(system: any): Hook {
  return (system._fileCdr ??= { proc: 0, owner: 0 });
}

/**
 * Sets the procedure told of changes, or asks for it.
 *
 * @param {Types.FARPTR} lpfnNotify - The procedure; nought to clear; a
 *   segment of FFFFh to ask.
 *
 * @returns {Types.DWORD} Asked, the procedure; set, 1, or nought when another
 *   task's is there.
 */
export function FileCdr(this: any, lpfnNotify: number) {
  const hook = hookOf(this);
  const task = this.scheduler?.active ?? 0;

  if (((lpfnNotify >>> 16) & 0xffff) === QUERY) {
    return hook.proc >>> 0;
  }

  if ((hook.proc >>> 16) & 0xffff && hook.owner !== task) {
    return 0;
  }

  hook.proc = lpfnNotify >>> 0;
  hook.owner = task;

  return 1;
}

/** Whether a DOS call, by its AX, is one that tells the procedure. */
export function tells(ax: number) {
  const ah = (ax >> 8) & 0xff;

  return TELLING.has(ah) || (ah === 0x43 && (ax & 0xff) === 1);
}

/** A path made whole as KERNEL makes it (seg1 `7f6d`). */
export function wholePath(dos: any, path: string) {
  let rest = path;
  let drive = dos.files.drive;

  if (rest[1] === ':') {
    drive = rest[0].toUpperCase();
    rest = rest.slice(2);
  }

  let whole = `${drive}:`;

  if (rest[0] !== '\\' && rest[0] !== '/') {
    const current = String(dos.files._pwd?.[drive] ?? `${drive}:\\`).slice(2);

    whole += current;

    if (!current.endsWith('\\') && !current.endsWith('/')) {
      whole += '\\';
    }
  }

  return whole + rest;
}

/**
 * Tells the procedure of a change, if one is set: `ax` the DOS function,
 * `path` as the program gave it, `second` a rename's new name.
 */
export async function tellFileChange(system: any, ax: number, path: string, second?: string) {
  const hook = hookOf(system);

  if (!((hook.proc >>> 16) & 0xffff)) {
    return;
  }

  const text = wholePath(system.dos, path) + (second === undefined ? '' : `\0${second}`);
  const block = GlobalAlloc.call(system, 0x42, text.length + 1);
  const far = GlobalLock.call(system, block) >>> 0;
  const core = system.machine.cpu.core;

  Array.from(text).forEach((character, i) =>
    core.write8(far >>> 16, (far & 0xffff) + i, character.charCodeAt(0) & 0xff)
  );
  core.write8(far >>> 16, (far & 0xffff) + text.length, 0);

  await system.scheduler.callProc(hook.proc, [
    [ax & 0xffff, UINT],
    [far, FARPTR],
  ]);

  GlobalFree.call(system, block);
}

/**
 * A DOS call made for a program, and its procedure told if it changed a file:
 * what `int 21h` and `Dos3Call` both come to.
 */
export async function dosCall(system: any) {
  const core = system.machine.cpu.core;
  const ax = core.ax;
  const memory = system.machine.memory;
  const path = tells(ax) ? memory.readCString(core.translateAddress(core.ds, core.dx)) : null;
  const second =
    path !== null && ((ax >> 8) & 0xff) === 0x56
      ? memory.readCString(core.translateAddress(core.es, core.di))
      : undefined;

  await system.dos.syscallInvoke();

  if (path !== null && !core.flags.carry) {
    await tellFileChange(system, ax, path, second);
  }
}
