'use strict';

import { W, D, buffer, stringOf, text } from '../commdlg/api.js';
import { directoryOf, filePart } from './items.js';
import { D_FRAME, D_INSTANCE, D_SHELL, type Pm, bytesOf, dos, dosPath, latin } from './main.js';

/**
 * What Program Manager's start-up does once its groups are loaded
 * (`PROGMAN.EXE` seg3 `0e15`-`0ee3`): as the shell, the programs `WIN.INI`'s
 * `load=` and `run=` name (`0221`, `0142`); then its command line, the program
 * Windows was started with (`0e23`-`0ec5`); each started by `ShellExecute` in
 * its own directory (seg5 `01b3`). As `crates/winbox-win16/src/progman/shell.rs`.
 *
 * Not yet done: the box for a program that could not be started (seg1 `00ec`,
 * with strings of `PROGMAN.EXE`'s own), `MinOnRun`'s minimizing of the frame,
 * which is never shown, and the StartUp group (`00a6`).
 */

/**
 * The directory current as it started (seg3 `0b31`-`0b37`), the Windows
 * directory (`0b3c`-`0b43`), the command line copied (`0e2f`-`0e35`), and a
 * program's directory as it is started (seg6 `0398`).
 */
export const D_STARTED_IN = 0x4d6;
export const D_WINDOWS = 0x822;
const D_COMMAND = 0x668;
const D_DIRECTORY = 0x79a;
/**
 * Set while `ShellExecute` starts a program, and what it answered (seg5
 * `0226`-`025b`); the window of a program it started, nought before (`01c5`).
 */
const D_STARTING = 0x26;
const D_STARTED = 0x128;
const D_STARTED_WINDOW = 0x12c;

/**
 * `ShellExecute`'s answers below 32 as the errors seg5 `0309`'s table makes of
 * them: a string's number, the answer itself where the table sends it to
 * `02d7`, or nought for 15 (`02f5`).
 */
const ERRORS = [
  0x3e, 1, 0x3f, 0x35, 0x40, 0x85, 6, 7, 0x3e, 9, 0x75, 11, 0x74, 13, 14, 0, 0x42, 17, 0x76, 0x96,
  0x97, 21, 22, 23, 24, 25, 0x98, 0x43, 0x41, 0x41, 0x41, 0x41,
];

/** A string kept in its data, up to its nought. */
export function dataString(pm: Pm, offset: number, size: number): string {
  const bytes = pm.readFar(pm.at(offset), size);
  const end = bytes.indexOf(0);

  return latin(end < 0 ? bytes : bytes.slice(0, end));
}

/** A string written into its data with its nought. */
function setDataString(pm: Pm, offset: number, value: string) {
  pm.writeFar(pm.at(offset), [...bytesOf(value), 0]);
}

/**
 * seg5 `0b93` for drive nought: the current drive (DOS 19h, seg5 `0b5a`) and
 * its directory (DOS 47h), `C:\` and the folders after it.
 */
export async function currentDirectory(pm: Pm): Promise<string> {
  const { ax } = await dos(pm, 0x1900, 0, []);
  const drive = ((ax & 0xff) + 1) & 0xff;
  const { carry, bytes } = await dos(pm, 0x4700, drive, new Array(0x40).fill(0));
  let path = `${String.fromCharCode((drive + 0x40) & 0xff)}:\\`;

  if (!carry) {
    const end = bytes.indexOf(0);

    path += latin(end < 0 ? bytes : bytes.slice(0, end));
  }

  return path;
}

/**
 * seg5 `0bdc`: a path's drive made current where it names one (DOS 0Eh, its
 * letter less `A`, seg5 `0b74`), and the rest, where there is any, made its
 * current directory (DOS 3Bh). Nought, or DOS's error where 3Bh fails
 * (`0c0e`-`0c12`).
 */
export async function changeTo(pm: Pm, path: string) {
  let rest = path;

  if (path[1] === ':') {
    await dos(pm, 0x0e00, ((path.charCodeAt(0) & 0xff) - 0x41) & 0xff, []);
    rest = path.slice(2);
  }

  if (rest) {
    const { carry, ax } = await dosPath(pm, 0x3b00, rest);

    if (carry) {
      return ax;
    }
  }

  return 0;
}

/**
 * seg5 `01b3`: a command started -- the hourglass shown, its first word the
 * file and the rest after a space its parameters, by `ShellExecute` from the
 * frame with the directory given, minimized (7) or shown normally (1); the
 * cursor as it was after. Nought where it started, else the error, as
 * `ERRORS` makes it.
 */
export async function execute(pm: Pm, given: string, directory: string, minimized: boolean) {
  pm.sd16(D_STARTED_WINDOW, 0);

  const wait = await pm.user('LoadCursor', [W(0), D(0x7f02)]);
  const cursor = (await pm.user('SetCursor', [W(wait & 0xffff)])) & 0xffff;

  if (((await pm.user('GetSystemMetrics', [W(0x13)])) & 0xffff) === 0) {
    await pm.user('ShowCursor', [W(1)]);
  }

  const command = given.replace(/^ +/, '');
  const space = command.indexOf(' ');
  const file = space < 0 ? command : command.slice(0, space);
  const parameters = space < 0 ? '' : command.slice(space + 1);

  pm.sd16(D_STARTING, 1);

  const answer =
    (
      await pm.call('SHELL', 'ShellExecute', [
        W(pm.d16(D_FRAME)),
        D(0),
        text(bytesOf(file)),
        text(bytesOf(parameters)),
        text(bytesOf(directory)),
        W(minimized ? 7 : 1),
      ])
    ).value & 0xffff;

  pm.sd16(D_STARTED, answer);
  pm.sd16(D_STARTING, 0);

  /* Started, `MinOnRun` would minimize the frame (`02dd`-`02f0`), which is
   * never shown. */
  const error = answer < 32 ? ERRORS[answer] : 0;

  /* `0389`-`03a7`: with no mouse, the cursor's count put back; then the
   * cursor as it was. */
  if (
    ((await pm.user('GetSystemMetrics', [W(0x13)])) & 0xffff) === 0 &&
    ((await pm.user('ShowCursor', [W(0)])) & 0xffff) !== 0xffff
  ) {
    await pm.user('ShowCursor', [W(1)]);
  }

  await pm.user('SetCursor', [W(cursor)]);

  return error;
}

/**
 * seg3 `0142`: each program of a `load=` or `run=` list -- names apart by a
 * space or a comma -- started from the Windows directory, in its own
 * directory, while there is memory for it (`GetFreeSpace(1000h)` 0FFFFh or
 * more).
 */
async function startList(pm: Pm, list: string, minimized: boolean) {
  if (!list) {
    return;
  }

  /* The box's caption, string 90h (`0156`-`0166`). */
  await pm.call('USER', 'LoadString', [W(pm.d16(D_INSTANCE)), W(0x90), buffer(0x101), W(0x101)]);

  let at = 0;

  for (;;) {
    let end = at;

    while (end < list.length && list[end] !== ' ' && list[end] !== ',') {
      end++;
    }

    const name = list.slice(at, end);

    if ((await pm.kernel('GetFreeSpace', [W(0x1000)])) >>> 0 < 0xffff) {
      return;
    }

    const directory = directoryOf(name);

    setDataString(pm, D_DIRECTORY, directory);
    await changeTo(pm, dataString(pm, D_WINDOWS, 0x81));
    /* A program not started is told in a box (`01d4`-`0207`): not yet. */
    await execute(pm, filePart(name), directory, minimized);

    if (end >= list.length) {
      return;
    }

    at = end + 1;
  }
}

/** `[windows]`' `key=` of `WIN.INI`, read into a buffer of 80h. */
async function winIni(pm: Pm, key: string): Promise<string> {
  return latin(
    stringOf(
      await pm.call('KERNEL', 'GetProfileString', [
        text(bytesOf('Windows')),
        text(bytesOf(key)),
        text([]),
        buffer(0x80),
        W(0x80),
      ]),
      3
    )
  );
}

/**
 * The end of the start-up (seg3 `0e15`-`0ee3`): as the shell, `load=`'s
 * programs minimized and `run=`'s shown normally (`0221`); then the command
 * line, if there is one, started from the directory current as Program
 * Manager started, in its own directory, and the Windows directory made
 * current after (`0e23`-`0ecd`).
 */
export async function startPrograms(pm: Pm, commandLine: string) {
  if (pm.d16(D_SHELL)) {
    await startList(pm, await winIni(pm, 'Load'), true);
    await startList(pm, await winIni(pm, 'Run'), false);
  }

  if (!commandLine) {
    return;
  }

  setDataString(pm, D_COMMAND, commandLine);
  await changeTo(pm, dataString(pm, D_STARTED_IN, 0x81));

  const directory = directoryOf(commandLine);

  setDataString(pm, D_DIRECTORY, directory);
  /* A command line not started is told in a box (`0e6b`-`0eb9`): not yet. */
  await execute(pm, filePart(commandLine), directory, false);
  await changeTo(pm, dataString(pm, D_WINDOWS, 0x81));
}
