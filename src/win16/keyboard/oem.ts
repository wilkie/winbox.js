'use strict';

/**
 * The translation between the ANSI character set Windows draws in and the
 * OEM one DOS names files in: `AnsiToOem`, `OemToAnsi` and their `Buff`
 * forms.
 *
 * **Read out of `KEYBOARD.DRV`** (seg10 `0843`, `086c`, `08eb`, `0913`).
 * Each byte from 80h up is looked up in a table of 128, and each from 01h to
 * 1Fh in a table of 32 before it; the rest, 00h and 20h to 7Fh, pass as they
 * are. The tables are the driver's own, in its fixed code segment 10: the
 * code page word at `06fc`, then ANSI to OEM at `06fe`, then OEM to ANSI at
 * `079e`, each the 32 and then the 128. winbox.js keeps them itself, as it
 * keeps the driver (`tables.ts`). A byte is read before it is written, so a
 * string may be translated in place.
 *
 * `SYSTEM.INI`'s `oemansi.bin=` can replace the tables when the driver starts
 * (seg3 `00cd`); the installation leaves it empty, and it is not followed.
 */

import { ANSI_TO_OEM, OEM_TO_ANSI } from './tables.js';

/** The driver's two tables: winbox.js's own (see `tables.ts`). */
async function tables(_system: any): Promise<{ toOem: Uint8Array; toAnsi: Uint8Array } | null> {
  return { toOem: ANSI_TO_OEM, toAnsi: OEM_TO_ANSI };
}

/** One byte through a table: 80h up from its last 128, 01h to 1Fh from its first 32. */
function translate(table: Uint8Array | null, byte: number) {
  if (!table) {
    return byte;
  }

  if (byte >= 0x80) {
    return table[byte - 0x80 + 0x20];
  }

  if (byte !== 0 && byte < 0x20) {
    return table[byte];
  }

  return byte;
}

/**
 * A string through a table, up to and with its null. A pointer that runs off
 * the end of its segment carries on in the next, as a huge pointer does
 * (`__AHINCR`, seg10 `08c1`). Answers `0xffff` (seg10 `08dd`).
 */
async function string(system: any, table: 'toOem' | 'toAnsi', source: number, target: number) {
  const cpu = system.machine.cpu.core;
  const map = (await tables(system))?.[table] ?? null;

  let sourceSegment = (source >>> 16) & 0xffff;
  let sourceOffset = source & 0xffff;
  let targetSegment = (target >>> 16) & 0xffff;
  let targetOffset = target & 0xffff;
  let byte: number;

  do {
    byte = translate(map, cpu.read8(sourceSegment, sourceOffset));
    cpu.write8(targetSegment, targetOffset, byte);

    sourceOffset = (sourceOffset + 1) & 0xffff;
    targetOffset = (targetOffset + 1) & 0xffff;

    if (sourceOffset === 0) {
      sourceSegment += 8;
    }

    if (targetOffset === 0) {
      targetSegment += 8;
    }
  } while (byte !== 0);

  return 0xffff;
}

/**
 * `count` bytes through a table, nulls and all, within their segments. A
 * count of 0 is nothing (seg10 `08f7`, `jcxz`). No answer is made: AX is
 * what the loop left.
 */
async function buffer(
  system: any,
  table: 'toOem' | 'toAnsi',
  source: number,
  target: number,
  count: number
) {
  const cpu = system.machine.cpu.core;
  const map = (await tables(system))?.[table] ?? null;

  for (let i = 0; i < (count & 0xffff); i++) {
    cpu.write8(
      (target >>> 16) & 0xffff,
      (target + i) & 0xffff,
      translate(map, cpu.read8((source >>> 16) & 0xffff, (source + i) & 0xffff))
    );
  }
}

export function AnsiToOem(this: any, lpszWindowsStr: number, lpszOemStr: number) {
  return string(this, 'toOem', lpszWindowsStr, lpszOemStr);
}

export function OemToAnsi(this: any, lpszOemStr: number, lpszWindowsStr: number) {
  return string(this, 'toAnsi', lpszOemStr, lpszWindowsStr);
}

export function AnsiToOemBuff(this: any, lpszWindowsStr: number, lpszOemStr: number, cbLen: number) {
  return buffer(this, 'toOem', lpszWindowsStr, lpszOemStr, cbLen);
}

export function OemToAnsiBuff(this: any, lpszOemStr: number, lpszWindowsStr: number, cbLen: number) {
  return buffer(this, 'toAnsi', lpszOemStr, lpszWindowsStr, cbLen);
}

/** A string winbox.js holds, through a table: for USER's own calls to these. */
export async function translateText(system: any, text: string, to: 'oem' | 'ansi') {
  const map = (await tables(system))?.[to === 'oem' ? 'toOem' : 'toAnsi'] ?? null;

  return Array.from(text, (character) =>
    String.fromCharCode(translate(map, character.charCodeAt(0) & 0xff))
  ).join('');
}
