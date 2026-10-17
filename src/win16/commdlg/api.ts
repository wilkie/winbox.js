'use strict';

import { readArguments } from '../read-arguments.js';
import { Types } from '../types.js';

/**
 * `COMMDLG`'s calls into KERNEL, USER and GDI, made as `COMMDLG.DLL` makes
 * them: each through the function that answers a program's call, its
 * arguments pushed below the stack, its structures and strings laid out
 * below them and read back after, and read off as a program's are
 * (`read-arguments.ts`). So WinBox's `COMMDLG` asks USER for what the file
 * would have asked, and is answered the same. As `api.rs`.
 *
 * Not logged, and not charged to the clock, as a call of the program's
 * is: they are `COMMDLG`'s own.
 */

/** An argument as `COMMDLG` pushes it: a word, a doubleword, or bytes laid out and given as a far pointer. */
export type Arg = { w: number } | { d: number } | { b: number[] };

export const W = (w: number): Arg => ({ w: w & 0xffff });
export const D = (d: number): Arg => ({ d: d >>> 0 });
export const B = (b: number[]): Arg => ({ b });

/** A string as an argument: its bytes and a nought. */
export const text = (bytes: number[]): Arg => ({ b: [...bytes, 0] });

/** A buffer of `size` noughts as an argument, to be written to. */
export const buffer = (size: number): Arg => ({ b: new Array(size).fill(0) });

/** What a call answered: DX:AX, nought for nothing; and each buffer as the function left it, in order. */
export type Called = { value: number; buffers: number[][] };

/** A buffer's string, up to its nought. */
export function stringOf(called: Called, index = 0): number[] {
  const bytes = called.buffers[index] ?? [];
  const end = bytes.indexOf(0);

  return end < 0 ? bytes.slice() : bytes.slice(0, end);
}

const DEFINITIONS = new WeakMap<object, Map<string, any[]>>();

/** A kept module's definition of an export, by its name. */
function definitionOf(system: any, module: string, name: string): any[] {
  const kept = system._modules._loaded?.[module]?.instance ?? system._modules.fromName(module);

  if (!kept) {
    throw new Error(`COMMDLG's call: no module ${module}`);
  }

  let byName = DEFINITIONS.get(kept);

  if (!byName) {
    byName = new Map();

    for (const entry of kept.exports as any[]) {
      if (entry && !byName.has(entry[1])) {
        byName.set(entry[1], entry);
      }
    }

    DEFINITIONS.set(kept, byName);
  }

  const definition = byName.get(name);

  if (!definition || definition[0] === kept.stub) {
    throw new Error(`COMMDLG's call: ${module}.${name} not answered`);
  }

  return definition;
}

/** An export of a module WinBox keeps, called as `COMMDLG` calls it. */
export async function api(system: any, module: string, name: string, args: Arg[]): Promise<Called> {
  const definition = definitionOf(system, module, name);
  const core = system.machine.cpu.core;
  const saved = core.sp;
  const ss = core.ss;
  let at = saved;
  const places: [number, number][] = [];
  const words: number[] = [];

  for (const arg of args) {
    if ('w' in arg) {
      words.push(arg.w);
    } else if ('d' in arg) {
      words.push((arg.d >>> 16) & 0xffff, arg.d & 0xffff);
    } else {
      at = (at - ((arg.b.length + 1) & ~1)) & 0xffff;
      arg.b.forEach((byte, i) => core.write8(ss, (at + i) & 0xffff, byte & 0xff));
      places.push([at, arg.b.length]);
      words.push(ss, at);
    }
  }

  for (const word of words) {
    at = (at - 2) & 0xffff;
    core.write16(ss, at, word);
  }

  /* Below them, a return address. */
  const sp = (at - 4) & 0xffff;

  core.sp = sp;

  let result: any;

  try {
    const { args: read, rejected } = readArguments(system, definition, ss, sp);

    result = rejected ? 0 : await definition[0].apply(system, read);
  } finally {
    core.sp = saved;
  }

  const buffers = places.map(([place, length]) =>
    Array.from({ length }, (_, i) => core.read8(ss, (place + i) & 0xffff))
  );
  const returnType = definition[4];
  let value = typeof result === 'boolean' ? (result ? 1 : 0) : Number(result ?? 0) || 0;

  value = returnType !== undefined && Types.sizeof(returnType) <= 2 ? value & 0xffff : value >>> 0;

  return { value, buffers };
}

/** A call's answer, AX, where nothing else is wanted of it. */
export async function word(system: any, module: string, name: string, args: Arg[]) {
  return (await api(system, module, name, args)).value & 0xffff;
}

/** `SendMessage` with a value for `lParam`: its answer. */
export async function send(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return (await api(system, 'USER', 'SendMessage', [W(hwnd), W(message), W(wParam), D(lParam)]))
    .value;
}

/** `SendDlgItemMessage` with a value for `lParam`: its answer. */
export async function sendItem(
  system: any,
  dialog: number,
  id: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return (
    await api(system, 'USER', 'SendDlgItemMessage', [
      W(dialog),
      W(id),
      W(message),
      W(wParam),
      D(lParam),
    ])
  ).value;
}

/** `SendDlgItemMessage` with a string, or a buffer, for `lParam`. */
export async function sendItemBytes(
  system: any,
  dialog: number,
  id: number,
  message: number,
  wParam: number,
  lParam: Arg
) {
  return await api(system, 'USER', 'SendDlgItemMessage', [
    W(dialog),
    W(id),
    W(message),
    W(wParam),
    lParam,
  ]);
}

/** `SendMessage` with a string, or a buffer, for `lParam`. */
export async function sendBytes(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: Arg
) {
  return await api(system, 'USER', 'SendMessage', [W(hwnd), W(message), W(wParam), lParam]);
}

/** `GetDlgItem`. */
export async function item(system: any, dialog: number, id: number) {
  return await word(system, 'USER', 'GetDlgItem', [W(dialog), W(id)]);
}

/** `GetDlgItemText`, of at most `size` bytes with its nought. */
export async function itemText(system: any, dialog: number, id: number, size: number) {
  return stringOf(
    await api(system, 'USER', 'GetDlgItemText', [W(dialog), W(id), buffer(size), W(size)])
  );
}

/** `SetDlgItemText`. */
export async function setItemText(system: any, dialog: number, id: number, value: number[]) {
  await api(system, 'USER', 'SetDlgItemText', [W(dialog), W(id), text(value)]);
}

/** `PostMessage`. */
export async function post(
  system: any,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  await api(system, 'USER', 'PostMessage', [W(hwnd), W(message), W(wParam), D(lParam)]);
}

/** A list box's or combo box's item's text, by `LB_GETTEXT` or `CB_GETLBTEXT`. */
export async function listText(
  system: any,
  dialog: number,
  id: number,
  message: number,
  index: number
) {
  return stringOf(await sendItemBytes(system, dialog, id, message, index, buffer(256)));
}

/** A string's bytes, a character to a byte. */
export const bytesOf = (value: string) => Array.from(value, (c) => c.charCodeAt(0) & 0xff);

/** Bytes as a string, a byte to a character. */
export const textOf = (bytes: number[]) => String.fromCharCode(...bytes);
