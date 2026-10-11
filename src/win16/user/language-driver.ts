'use strict';

import { freeLibrary } from '../library.js';
import { GetProcAddress } from '../kernel/GetProcAddress.js';
import { LoadLibrary } from '../kernel/LoadLibrary.js';
import { User } from '../user.js';
import { LONG, LPARAM, UINT } from '../types.js';
import { AnsiLower, AnsiLowerBuff } from './AnsiLower.js';
import { AnsiUpper, AnsiUpperBuff } from './AnsiUpper.js';
import { lstrcmp } from './lstrcmp.js';
import { lstrcmpi } from './lstrcmpi.js';
import { IsCharAlpha, IsCharAlphaNumeric, IsCharLower, IsCharUpper } from './queries.js';

/**
 * The language driver: a library whose ordinal 1 USER hands its string
 * functions to while it is loaded. **Read out** of `USER.EXE`, and
 * **recorded** by `langdrv`; the Rust engine's `language_driver.rs` is the
 * same.
 *
 * * As USER starts, `SYSTEM.INI`'s `[boot] LANGUAGE.DLL` is loaded where it
 *   names one (seg3 `1ff5`-`2065`); the installation the recordings are
 *   made on names none.
 * * `SPI_LANGDRIVER` (seg41 `116f`) loads the file its `lpvParam` names
 *   (seg3 `1f34`): the driver loaded lets go of with `FreeLibrary`, its
 *   file's name kept; no name, or an empty one, is done, and answers TRUE;
 *   else the file is loaded with `LoadLibrary` and its ordinal 1 found with
 *   `GetProcAddress`, and TRUE. Where either fails, the library loaded is
 *   let go of and the driver before loaded again by its file's name, and the
 *   call answers FALSE.
 * * With `SPIF_UPDATEINIFILE`, and only where it answers TRUE, `SYSTEM.INI`'s
 *   `[boot] LANGUAGE.DLL` is written with `WritePrivateProfileString`: the
 *   name given where a driver is loaded, else an empty one (`118a`-`11e5`).
 *   No `WM_WININICHANGE` is sent.
 * * While one is loaded, ten functions of seg11 call its procedure, Pascal,
 *   with a number, a word and a far pointer, in place of their own:
 *   `lstrcmp` 1 and `lstrcmpi` 1 with the word 1, the pointer the caller's
 *   two pointers on its stack, and the answer negated; `AnsiUpper` 2 and
 *   `AnsiLower` 3, the pointer their argument, the answer theirs;
 *   `AnsiUpperBuff` 4 and `AnsiLowerBuff` 5, the word the length; and
 *   `IsCharAlpha` 6, `IsCharAlphaNumeric` 7, `IsCharUpper` 8 and
 *   `IsCharLower` 9, the word the character and the pointer null.
 */

interface Driver {
  module: number;
  proc: number;
}

/** The driver's procedure, or nought for none loaded. */
export function languageDriver(system: any): number {
  return (system._languageDriver as Driver | undefined)?.proc ?? 0;
}

/** Its procedure called: its answer, DX:AX. */
export async function callLanguageDriver(
  system: any,
  number: number,
  word: number,
  pointer: number
): Promise<number> {
  const proc = languageDriver(system);

  return (
    (await system.scheduler.call(
      User,
      (proc >>> 16) & 0xffff,
      proc & 0xffff,
      [
        [number, UINT],
        [word & 0xffff, UINT],
        [pointer >>> 0, LPARAM],
      ],
      LONG,
      system.scheduler.stackRegisters()
    )) >>> 0
  );
}

/** A library loaded as a driver: whether its ordinal 1 was found. */
async function load(system: any, name: string) {
  const module = await LoadLibrary.call(system, name);

  if ((module & 0xffff) < 32) {
    return false;
  }

  const proc = GetProcAddress.call(system, module, 1) >>> 0;

  if (!proc) {
    await freeLibrary(system, module);
    return false;
  }

  system._languageDriver = { module, proc } satisfies Driver;
  return true;
}

/** `SPI_LANGDRIVER`'s work (seg3 `1f34`): whether a driver was loaded, or none asked for. */
export async function setLanguageDriver(system: any, name: string | null) {
  const before: Driver | undefined = system._languageDriver;
  let path: string | null = null;

  if (before) {
    const item = system.handles.resolve(before.module);

    path = String(item?.loader?.path ?? item?.path ?? '');
    system._languageDriver = undefined;
    await freeLibrary(system, before.module);
  }

  if (!name) {
    return true;
  }

  if (await load(system, name)) {
    return true;
  }

  if (path) {
    await load(system, path);
  }

  return false;
}

/**
 * Where the caller's arguments are on its stack, as USER hands them to the
 * driver for `lstrcmp`: above the return address, the second string's
 * pointer first.
 */
function callersArguments(system: any) {
  const core = system.machine.cpu.core;

  return (((core.ss & 0xffff) << 16) | ((core.sp + 4) & 0xffff)) >>> 0;
}

/** A comparison: the driver's answer negated, as a signed word (seg11 `0048`-`0055`). */
async function compared(system: any, word: number) {
  const pointer = callersArguments(system);
  const answer = await callLanguageDriver(system, 1, word, pointer);

  return ((-answer & 0xffff) << 16) >> 16;
}

export async function lstrcmpDriven(this: any, a: any, b: any) {
  return languageDriver(this) ? compared(this, 0) : lstrcmp.call(this, a, b);
}

export async function lstrcmpiDriven(this: any, a: any, b: any) {
  return languageDriver(this) ? compared(this, 1) : lstrcmpi.call(this, a, b);
}

export async function AnsiUpperDriven(this: any, lpsz: number) {
  return languageDriver(this) ? callLanguageDriver(this, 2, 0, lpsz) : AnsiUpper.call(this, lpsz);
}

export async function AnsiLowerDriven(this: any, lpsz: number) {
  return languageDriver(this) ? callLanguageDriver(this, 3, 0, lpsz) : AnsiLower.call(this, lpsz);
}

export async function AnsiUpperBuffDriven(this: any, lpsz: number, cbLen: number) {
  return languageDriver(this)
    ? (await callLanguageDriver(this, 4, cbLen, lpsz)) & 0xffff
    : AnsiUpperBuff.call(this, lpsz, cbLen);
}

export async function AnsiLowerBuffDriven(this: any, lpsz: number, cbLen: number) {
  return languageDriver(this)
    ? (await callLanguageDriver(this, 5, cbLen, lpsz)) & 0xffff
    : AnsiLowerBuff.call(this, lpsz, cbLen);
}

/** An `IsChar` function: the driver's answer, the character in the word (seg11 `0235`-`0240`). */
function isChar(number: number, own: (this: any, cChar: number) => number) {
  return async function (this: any, cChar: number) {
    return languageDriver(this)
      ? (await callLanguageDriver(this, number, cChar & 0xff, 0)) & 0xffff
      : own.call(this, cChar);
  };
}

export const IsCharAlphaDriven = isChar(6, IsCharAlpha);
export const IsCharAlphaNumericDriven = isChar(7, IsCharAlphaNumeric);
export const IsCharUpperDriven = isChar(8, IsCharUpper);
export const IsCharLowerDriven = isChar(9, IsCharLower);
