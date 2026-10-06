'use strict';

import { segmentSelector } from '../selectors.js';
import { wholePath } from './FileCdr.js';

/**
 * Where KERNEL looks for a file named without a directory: `OpenFile`'s
 * search, which `LoadModule` -- `WinExec` and `LoadLibrary` too -- opens a
 * program or a library through (`KRNL386.EXE` seg2 `1747`), and so a library
 * a module imports as well. **Recorded** by `search`, which puts a copy in
 * each place and deletes the one found, round after round; **read out** of
 * seg1 `5390`:
 *
 * 1. the current directory -- or, with `OF_SEARCH` and a directory named,
 *    that directory;
 * 2. Windows' directory;
 * 3. the system directory;
 * 4. the directory of a module's file: the task's that looks, or, for the
 *    libraries a program being started imports, that program's (seg1
 *    `55a3`, the task being made at data `22a`);
 * 5. each directory of PATH, in the environment of the task that looks
 *    (seg1 `588e`): the variable written `PATH=` exactly, its value cut at
 *    each `;`, an empty one the root of the current drive.
 *
 * The first four are a list (data `0aed`), and one of them that KERNEL
 * takes for one it has looked in already is passed over: of the same
 * length, and the same in all but its last letter, as `repe cmpsb` leaves
 * nothing to count when only the last letter differs (seg1 `5637`). The
 * `search` probe's C:\ORACLE\OWN is passed over from C:\ORACLE\OWX, and
 * not from C:\ORACLE\XWN.
 *
 * Not followed: while Windows starts, before the shell's `InitTask`, the
 * list is the system directory and then Windows' alone (data `0aea`, chosen
 * at seg1 `542f`). The first program winbox.js runs stands for one started
 * from the shell.
 */

/** Windows' directory and its system directory, as KERNEL gives them. */
export const WINDOWS_DIRECTORY = 'C:\\WINDOWS';
export const SYSTEM_DIRECTORY = 'C:\\WINDOWS\\SYSTEM';

/** Letters made capitals, as DOS makes a name's: a to z alone. */
function upper(text: string) {
  return text.replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

/** A directory as KERNEL keeps it to compare: upper case, no backslash at its end. */
function bare(directory: string) {
  return upper(directory).replace(/[\\/]+$/, '');
}

/** The directory of a module's file, from its path. */
export function directoryOf(path: string | null | undefined) {
  const text = String(path ?? '');
  const slash = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'));

  return slash > 0 ? text.slice(0, slash) : null;
}

/** The running task's module's directory, or null. */
export function taskDirectory(system: any) {
  return directoryOf(system.scheduler?.task?.executable?.path);
}

/**
 * The running task's environment's variables, read from its segment as the
 * program may have changed them: each up to its nought, to the nought that
 * ends them.
 */
export function environmentVariables(system: any): string[] {
  const task = system.handles?.resolve?.(system.scheduler?.active);
  const segment = task?.environmentSegment;

  if (segment === undefined || segment === null) {
    return [];
  }

  const core = system.machine.cpu.core;
  const selector = segmentSelector(segment);
  const variables: string[] = [];
  let at = 0;

  while (at < 0x10000) {
    let text = '';

    for (let byte = core.read8(selector, at); byte; byte = core.read8(selector, at)) {
      text += String.fromCharCode(byte);
      at++;
    }

    at++;

    if (!text) {
      return variables;
    }

    variables.push(text);
  }

  return variables;
}

/**
 * The running task's environment block, as a program started from it is
 * given it: the variables, the nought that ends them, the count and the
 * path after it, read from its segment.
 */
export function environmentBlock(system: any): Uint8Array | undefined {
  const task = system.handles?.resolve?.(system.scheduler?.active);
  const segment = task?.environmentSegment;

  if (segment === undefined || segment === null) {
    return undefined;
  }

  const core = system.machine.cpu.core;
  const selector = segmentSelector(segment);
  const bytes: number[] = [];
  let at = 0;

  /* The variables, to two noughts in a row (or one at the start). */
  while (at < 0x10000) {
    const byte = core.read8(selector, at++);

    bytes.push(byte);

    if (byte === 0 && (bytes.length === 1 || bytes[bytes.length - 2] === 0)) {
      break;
    }
  }

  /* The count, then the path to its nought. */
  bytes.push(core.read8(selector, at), core.read8(selector, at + 1));
  at += 2;

  while (at < 0x10000) {
    const byte = core.read8(selector, at++);

    bytes.push(byte);

    if (!byte) {
      break;
    }
  }

  return new Uint8Array(bytes);
}

/** PATH's directories, from the running task's environment, as KERNEL cuts them. */
export function pathDirectories(system: any): string[] {
  const variable = environmentVariables(system).find((each) => each.startsWith('PATH='));

  if (variable === undefined) {
    return [];
  }

  const directories: string[] = [];
  let rest = variable.slice(5);

  for (;;) {
    const semicolon = rest.indexOf(';');

    directories.push(semicolon < 0 ? rest : rest.slice(0, semicolon));

    if (semicolon < 0) {
      break;
    }

    rest = rest.slice(semicolon + 1);

    if (!rest) {
      break;
    }
  }

  return directories;
}

/**
 * The directories looked in, in order: `first` (the current directory when
 * none is given), Windows', the system directory and `module`'s, less any
 * KERNEL takes for one before it; then PATH's.
 */
export function searchPlaces(system: any, module: string | null, first?: string): string[] {
  const current = first ?? String(system.dos?.files?.path ?? 'C:\\');
  const kept: string[] = [];

  for (const place of [current, WINDOWS_DIRECTORY, SYSTEM_DIRECTORY, module]) {
    if (!place) {
      continue;
    }

    const it = bare(place);
    const seen = kept.some(
      (before) => before.length === it.length && before.slice(0, -1) === it.slice(0, -1)
    );

    if (!seen) {
      kept.push(it);
    }
  }

  /* A directory of PATH is a path given whole or from the current drive's
   * directory; an empty one is `\`, the current drive's root. */
  const onPath = pathDirectories(system).map((directory) =>
    bare(wholePath(system.dos, directory || '\\'))
  );

  return [...kept, ...onPath];
}

/** Whether a file is there, by its whole path. */
async function fileThere(system: any, path: string) {
  const handle = await system.dos.files.open(path);

  if (handle === null || handle === undefined || handle < 0) {
    return false;
  }

  system.dos.files.close(handle);

  return true;
}

/**
 * A file named without a directory found where KERNEL looks: its path, the
 * directory's and the name's, or 2, DOS's error for no file, for none (seg1
 * `5903`).
 */
export async function searchFile(
  system: any,
  name: string,
  module: string | null,
  first?: string
): Promise<{ path: string } | { error: number }> {
  for (const place of searchPlaces(system, module, first)) {
    const path = `${place}\\${upper(name)}`;

    if (await fileThere(system, path)) {
      return { path };
    }
  }

  return { error: 2 };
}

/** Whether a name names a directory too: a backslash, a slash or a drive. */
export function hasDirectory(name: string) {
  return /[\\/:]/.test(name);
}
