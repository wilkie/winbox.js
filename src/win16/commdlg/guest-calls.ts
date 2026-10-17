'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { GlobalLock } from '../kernel/GlobalLock.js';
import { GlobalUnlock } from '../kernel/GlobalUnlock.js';
import { RegisterWindowMessage } from '../user/RegisterWindowMessage.js';
import { procAddressOf } from './proc-address.js';
import { COMMDLG_STRINGS } from './strings.js';
import { callHook, instance, setError } from './state.js';

/**
 * What the Find, Replace and Color dialogs ask of COMMDLG's own and of the
 * program's memory. The twin of `crates/winbox-win16/src/commdlg/guest_calls.rs`.
 */

/** What COMMDLG keeps for its Find, Replace and Color dialogs. */
export function stateOf(system: any) {
  const state = (system._commdlg ??= { error: 0, initialising: false });

  state.next ??= 0;
  state.find ??= { pendingHook: 0, findMessage: 0, structures: new Map<number, number>() };
  state.colour ??= {
    memoryDc: 0,
    spectrum: 0,
    boxes: [] as number[][],
    pitch: [0, 0],
    count: 0,
    tracking: false,
    staticProc: 0,
    hook: 0,
    dialogs: new Map<number, any>(),
  };

  return state;
}

/** A number for a dialog's data, put under its property A000h where COMMDLG puts the handle of its local memory: never nought. */
export function nextNumber(system: any) {
  const state = stateOf(system);

  state.next = (state.next + 1) & 0xffff || 1;
  return state.next;
}

export { callHook, instance, setError };

/** The far address of one of COMMDLG's exports, WinBox's own. */
export const procAddress = procAddressOf;

/** A registered message by its name, registered now if it is not yet. */
export function registered(system: any, name: string): number {
  return RegisterWindowMessage.call(system, name);
}

/** One of COMMDLG's strings, by its resource number: those its Find, Replace and Color dialogs load. */
export function string(id: number): string | null {
  return COMMDLG_STRINGS.get(id) ?? null;
}

/** A far pointer `step` bytes further into its segment. */
export function at(far: number, step: number) {
  return ((far & 0xffff0000) | ((far + step) & 0xffff)) >>> 0;
}

export function word(system: any, far: number, step = 0): number {
  return system.machine.cpu.core.read16(far >>> 16, at(far, step) & 0xffff);
}

export function dword(system: any, far: number, step = 0): number {
  return (word(system, far, step) | (word(system, far, step + 2) << 16)) >>> 0;
}

export function setDword(system: any, far: number, step: number, value: number) {
  const core = system.machine.cpu.core;

  core.write16(far >>> 16, at(far, step) & 0xffff, value & 0xffff);
  core.write16(far >>> 16, at(far, step + 2) & 0xffff, (value >>> 16) & 0xffff);
}

/** A string argument as the dispatcher makes one: null, a number, or the text. */
export function lpcstr(system: any, far: number): any {
  if (!far) {
    return null;
  }

  if (!(far >>> 16)) {
    return far & 0xffff;
  }

  const core = system.machine.cpu.core;
  let text = '';

  for (let step = 0; step < 0x10000; step++) {
    const byte = core.read8(far >>> 16, at(far, step) & 0xffff);

    if (!byte) {
      break;
    }

    text += String.fromCharCode(byte);
  }

  const out: any = new String(text);

  out.segment = far >>> 16;
  out.offset = far & 0xffff;
  return out;
}

/**
 * Bytes laid on the program's stack below where it is, each block a far
 * pointer given to `body`, the stack kept below them while it runs: a call
 * with structures of COMMDLG's, as it passes them from its own stack. Its
 * answer and each block as it was left.
 */
export async function withBlocks<T>(
  system: any,
  blocks: number[][],
  body: (fars: number[]) => Promise<T> | T
): Promise<[T, number[][]]> {
  const core = system.machine.cpu.core;
  const saved = core.sp;
  const ss = core.ss;
  const fars: number[] = [];
  let sp = saved;

  for (const block of blocks) {
    sp = (sp - ((block.length + 1) & ~1)) & 0xffff;
    block.forEach((byte, step) => core.write8(ss, (sp + step) & 0xffff, byte));
    fars.push(((ss << 16) | sp) >>> 0);
  }

  core.sp = (sp - 4) & 0xffff;

  try {
    const answer = await body(fars);
    const left = blocks.map((block, index) =>
      block.map((_, step) => core.read8(ss, ((fars[index] & 0xffff) + step) & 0xffff))
    );

    return [answer, left];
  } finally {
    core.sp = saved;
  }
}

/** One of COMMDLG's templates put in global memory, as its resource is loaded: the handle. */
export async function ownTemplate(system: any, bytes: Uint8Array): Promise<number> {
  const handle = GlobalAlloc.call(system, 0x0002, bytes.length);

  if (!handle) {
    return 0;
  }

  const far = GlobalLock.call(system, handle) >>> 0;
  const core = system.machine.cpu.core;

  bytes.forEach((byte, step) => core.write8(far >>> 16, at(far, step) & 0xffff, byte));
  GlobalUnlock.call(system, handle);
  return handle;
}

/** A template of COMMDLG's let go. */
export function freeTemplate(system: any, handle: number) {
  GlobalFree.call(system, handle);
}

/** A hook called with a window message's four arguments. */
export async function hook(
  system: any,
  procedure: number,
  hwnd: number,
  message: number,
  wParam: number,
  lParam: number
) {
  return callHook(system, procedure, hwnd, message, wParam, lParam);
}
