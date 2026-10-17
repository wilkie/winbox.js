'use strict';

import { D, W, api, text } from './api.js';
import { procAddressOf } from './proc-address.js';
import { COMMDLG_STRINGS } from './strings.js';
import { callHook, instance, message, setError } from './state.js';

/**
 * What the Find, Replace and Color dialogs ask of COMMDLG's own and of the
 * program's memory, and their calls into USER, GDI and KERNEL in the shape
 * they make them: each made through `api.ts`, which calls an export as a
 * program's call reaches it, the arguments and structures laid below the
 * stack. The twin of `crates/winbox-win16/src/commdlg/guest_calls.rs`.
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
  return message(system, name);
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

/** A window's text set from bytes of COMMDLG's own. */
export async function setWindowText(system: any, hwnd: number, bytes: number[]) {
  await api(system, 'USER', 'SetWindowText', [W(hwnd), text(bytes)]);
}

/** One of COMMDLG's templates put in global memory, as its resource is loaded: the handle. */
export async function ownTemplate(system: any, bytes: Uint8Array): Promise<number> {
  const handle = (await api(system, 'KERNEL', 'GlobalAlloc', [W(0x0002), D(bytes.length)])).value;

  if (!handle) {
    return 0;
  }

  const far = (await api(system, 'KERNEL', 'GlobalLock', [W(handle)])).value >>> 0;
  const core = system.machine.cpu.core;

  bytes.forEach((byte, step) => core.write8(far >>> 16, at(far, step) & 0xffff, byte));
  await api(system, 'KERNEL', 'GlobalUnlock', [W(handle)]);
  return handle;
}

/** A template of COMMDLG's let go. */
export async function freeTemplate(system: any, handle: number) {
  await api(system, 'KERNEL', 'GlobalFree', [W(handle)]);
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
