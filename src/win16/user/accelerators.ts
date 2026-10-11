'use strict';

import { NULL } from '../consts.js';
import { Executable } from '../../executable.js';

import { User } from '../user.js';

import { resourceBytes } from './resources.js';
import { menuOf } from './menu-api.js';
import { MenuData, MF_DISABLED, MF_GRAYED, handleOf } from './menu-data.js';

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

const WS_CHILD = 0x40000000;
const WS_DISABLED = 0x08000000;

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
 * The place in the bar of the pop-up a command found in `found` is under, and
 * that pop-up; null where the command is the bar's own (`USER.EXE` seg19
 * `05ee`: the bar's items from the last, each pop-up searched through).
 */
function topPlace(bar: MenuData, found: MenuData) {
  const holds = (menu: MenuData, depth: number): boolean =>
    menu === found ||
    (depth < 64 && menu.items.some((item) => item.popup && holds(item.popup, depth + 1)));

  if (found === bar) {
    return null;
  }

  for (let at = bar.items.length - 1; at >= 0; at--) {
    const popup = bar.items[at].popup;

    if (popup && holds(popup, 0)) {
      return { position: at, popup };
    }
  }

  return null;
}

/**
 * A key message that is one of a table's accelerators, sent on as the
 * command, as `USER.EXE` sends it (seg19 `0792`): the first entry for the
 * key, and the answer TRUE whatever becomes of it. Where the window -- not a
 * child -- has a menu with the command, the window is told first, as a menu
 * about to be used is: `WM_INITMENU` with the menu, and where the command is
 * in a pop-up, `WM_INITMENUPOPUP` with the pop-up of the bar it is under and
 * its place there (`06d2`). The item is looked at after that, as the window
 * has left it -- Paintbrush enables Paste only as its Edit pop-up is told --
 * and grayed or disabled, or under a grayed pop-up, or the window disabled or
 * minimized, nothing is sent (`08f5`). Else `WM_COMMAND` with 1 in the high
 * word of `lParam`, straight to the window's procedure; a command no menu has
 * is sent whatever the window is. **Recorded** by `accinit`.
 *
 * Not yet done: a command in the window's system menu, which Windows sends as
 * `WM_SYSCOMMAND` (`08c2`), and the menu bar item Windows flashes.
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
  const entry = table.entries.find((entry) => {
    if (!!(entry.flags & FVIRTKEY) !== virtual || entry.key !== (lpmsg.wParam & 0xffff)) {
      return false;
    }

    if (virtual) {
      return (
        !!(entry.flags & FSHIFT) === down(User.VK_SHIFT) &&
        !!(entry.flags & FCONTROL) === down(User.VK_CONTROL) &&
        !!(entry.flags & FALT) === alt
      );
    }

    return !!(entry.flags & FALT) === alt;
  });

  if (!entry) {
    return 0;
  }

  const window = this.handles.resolve(hwnd);
  const send = async (message: number, wParam: number, lParam: number) => {
    const resolved = this.handles.resolve(hwnd);
    const windowClass = resolved && this.handles.retrieve(resolved.options.windowClass);

    if (windowClass) {
      await this.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam);
    }
  };
  const hmenu = window?.window?.style & WS_CHILD ? 0 : (window?.options?.menu ?? 0);
  const bar = menuOf(this, hmenu);
  let sendCommand = true;

  if (bar && bar.find(entry.command, 0)) {
    const top = topPlace(bar, bar.find(entry.command, 0)!.menu);

    await send(User.WM_INITMENU, hmenu, 0);

    if (menuOf(this, hmenu) === bar) {
      if (top) {
        await send(User.WM_INITMENUPOPUP, handleOf(this, top.popup), top.position);
      }

      /* As the window left the menu: gone, the command is sent as one no
       * menu has (`0716`). */
      if (menuOf(this, hmenu) === bar) {
        const found = bar.find(entry.command, 0);
        const under = !!top && !!(bar.items[top.position].flags & (MF_GRAYED | MF_DISABLED));
        const grayed = !!found && !!(found.item.flags & (MF_GRAYED | MF_DISABLED));
        const now = this.handles.resolve(hwnd)?.window;
        const held = !!now && (!!(now.style & WS_DISABLED) || now.state === 'minimized');

        sendCommand = !found || !(grayed || under || held);
      }
    }
  }

  if (sendCommand) {
    await send(User.WM_COMMAND, entry.command, 1 << 16);
  }

  return 1;
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
  const vk = msg.wParam & 0xff;

  if (msg.message === User.WM_KEYDOWN || msg.message === User.WM_SYSKEYDOWN) {
    noteState(system, vk, true);
  } else if (msg.message === User.WM_KEYUP || msg.message === User.WM_SYSKEYUP) {
    noteState(system, vk, false);
  }
}

/**
 * A mouse button's message taken from the queue, as the system queue had it,
 * into the key-state table as a key's is (`USER.EXE` seg1 `4ecc`): the left
 * button `VK_LBUTTON`, the right `VK_RBUTTON` and the middle `VK_MBUTTON`,
 * down for a press or a double click and up for a release. Write's selection
 * follows the mouse while `GetKeyState` says the left button is down.
 */
export function noteButton(system: any, kind: number) {
  const button: Record<number, [number, boolean]> = {
    0x201: [0x01, true],
    0x203: [0x01, true],
    0x202: [0x01, false],
    0x204: [0x02, true],
    0x206: [0x02, true],
    0x205: [0x02, false],
    0x207: [0x04, true],
    0x209: [0x04, true],
    0x208: [0x04, false],
  };
  const found = button[kind];

  if (found) {
    noteState(system, found[0], found[1]);
  }
}

/** A key's byte moved with its message (seg1 `4f07`): down sets 80h, toggling bit 1 where it was up; up clears 80h. */
function noteState(system: any, vk: number, down: boolean) {
  const table = keyStates(system);

  if (down) {
    if (!(table[vk] & 0x80)) {
      table[vk] ^= 0x01;
    }

    table[vk] |= 0x80;
  } else {
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
