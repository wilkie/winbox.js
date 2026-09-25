'use strict';

import { NULL } from '../consts.js';
import { Executable } from '../../executable.js';

import { User } from '../user.js';

import { resourceBytes } from './resources.js';
import { menuOf } from './menu-api.js';
import { MF_DISABLED, MF_GRAYED } from './menu-data.js';

/**
 * Accelerator tables: keys that stand for commands.
 *
 * A table is a resource of five-byte entries -- a flag byte, the key and the
 * command -- the last with bit 80h of its flags set. With `FVIRTKEY` the key is
 * a virtual key, pressed with the shift keys the flags name; without it, a
 * character, as `WM_CHAR` carries it.
 */

const FVIRTKEY = 0x01;
const FSHIFT = 0x04;
const FCONTROL = 0x08;
const FALT = 0x10;
const LAST = 0x80;

export interface Accelerator {
  flags: number;
  key: number;
  command: number;
}

export class AcceleratorTable {
  readonly entries: Accelerator[];

  constructor(entries: Accelerator[]) {
    this.entries = entries;
  }
}

/** A table read from its resource. */
export function parseAccelerators(data: Uint8Array) {
  const entries: Accelerator[] = [];

  for (let at = 0; at + 5 <= data.length; at += 5) {
    const flags = data[at];

    entries.push({
      flags,
      key: data[at + 1] | (data[at + 2] << 8),
      command: data[at + 3] | (data[at + 4] << 8),
    });

    if (flags & LAST) {
      break;
    }
  }

  return new AcceleratorTable(entries);
}

export async function LoadAccelerators(this: any, hinst: number, lpszTableName: any) {
  const module = this.handles.resolve(hinst);
  const data = await resourceBytes(
    module?.executable,
    Executable.RESOURCES.Accelerator,
    lpszTableName
  );

  return data ? this.handles.allocate(parseAccelerators(data)) : NULL;
}

/**
 * A key message that is one of a table's accelerators, sent on as the
 * command: `WM_COMMAND` with 1 in the high word of `lParam`, straight to the
 * window's procedure. Not when the command is a grayed or disabled item of the
 * window's menu -- the key is then taken and nothing is sent.
 *
 * Not yet done: the `WM_INITMENU` Windows sends first when the command is in
 * the menu, and the menu bar item it flashes.
 */
export async function TranslateAccelerator(this: any, hwnd: number, haccl: number, lpmsg: any) {
  const table = this.handles.resolve(haccl);

  if (!(table instanceof AcceleratorTable)) {
    return 0;
  }

  const message = lpmsg.message;
  const virtual = message === User.WM_KEYDOWN || message === User.WM_SYSKEYDOWN;
  const character = message === User.WM_CHAR || message === User.WM_SYSCHAR;

  if (!virtual && !character) {
    return 0;
  }

  const alt = message === User.WM_SYSKEYDOWN || message === User.WM_SYSCHAR;
  const down = (vk: number) => (keyState(this, vk) & 0x80) !== 0;

  for (const entry of table.entries) {
    if (!!(entry.flags & FVIRTKEY) !== virtual || entry.key !== (lpmsg.wParam & 0xffff)) {
      continue;
    }

    if (virtual) {
      if (
        !!(entry.flags & FSHIFT) !== down(User.VK_SHIFT) ||
        !!(entry.flags & FCONTROL) !== down(User.VK_CONTROL) ||
        !!(entry.flags & FALT) !== alt
      ) {
        continue;
      }
    } else if (!!(entry.flags & FALT) !== alt) {
      continue;
    }

    const found = menuOf(this, this.handles.resolve(hwnd)?.options?.menu)?.find(entry.command, 0);

    if (found && found.item.flags & (MF_GRAYED | MF_DISABLED)) {
      return 1;
    }

    const window = this.handles.resolve(hwnd);
    const windowClass = window && this.handles.retrieve(window.options.windowClass);

    if (windowClass) {
      await this.scheduler.callWndProc(windowClass, hwnd, User.WM_COMMAND, entry.command, 1 << 16);
    }

    return 1;
  }

  return 0;
}

/** The key-state table, as USER keeps it: bit 80h down, bit 1 toggled. */
export function keyStates(system: any): Uint8Array {
  system._keyStates ??= new Uint8Array(256);

  return system._keyStates;
}

export function keyState(system: any, vk: number) {
  return keyStates(system)[vk & 0xff];
}

/**
 * A key message taken from the queue, into the table: Windows moves the state
 * of the keys along with the messages a program takes, so what `GetKeyState`
 * says matches the message being handled rather than the keyboard now.
 */
export function noteKey(system: any, msg: any) {
  const table = keyStates(system);
  const vk = msg.wParam & 0xff;

  if (msg.message === User.WM_KEYDOWN || msg.message === User.WM_SYSKEYDOWN) {
    if (!(table[vk] & 0x80)) {
      table[vk] ^= 0x01;
    }

    table[vk] |= 0x80;
  } else if (msg.message === User.WM_KEYUP || msg.message === User.WM_SYSKEYUP) {
    table[vk] &= ~0x80;
  }
}

/**
 * Read out of `USER.EXE`: the key's byte from the state table, sign-extended
 * -- `FF80h` for a key down, `1` for one toggled on, `FF81h` for both.
 */
export function GetKeyState(this: any, nVirtKey: number) {
  const byte = keyState(this, nVirtKey);

  return (byte & 0x80 ? 0xff00 | byte : byte) & 0xffff;
}
