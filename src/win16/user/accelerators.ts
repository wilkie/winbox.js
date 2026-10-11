'use strict';

import { NULL } from '../consts.js';
import { Executable } from '../../executable.js';

import { User } from '../user.js';

import { resourceBytes } from './resources.js';
import { menuOf } from './menu-api.js';
import { systemMenuBroughtUp, systemMenuHolderOf } from './menu-loop.js';
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
const WS_SYSMENU = 0x00080000;
const VK_MENU = 0x12;

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
 * A menu of the window's told it is about to be used because a key stands for
 * one of its commands, as `USER.EXE` tells it (seg19 `06d2`): nought where
 * the menu does not have the command, else `WM_INITMENU` with the menu and,
 * where the command is under one of its pop-ups, `WM_INITMENUPOPUP` with that
 * pop-up and its place, nought in the high word even for the system menu
 * (`accsys`). Then the item is looked at as the window has left it: 3 where it
 * or the pop-up it is under is grayed or disabled, 2 where it is not, and
 * nought where the window destroyed the menu meanwhile (`0716`, `0750`).
 */
async function tell(
  system: any,
  hmenu: number,
  command: number,
  send: (message: number, wParam: number, lParam: number) => Promise<void>
) {
  const menu = menuOf(system, hmenu);
  const found = menu?.find(command, 0);

  if (!menu || !found) {
    return 0;
  }

  const top = topPlace(menu, found.menu);

  await send(User.WM_INITMENU, hmenu, 0);

  if (menuOf(system, hmenu) !== menu) {
    return 0;
  }

  let under = false;

  if (top) {
    await send(User.WM_INITMENUPOPUP, handleOf(system, top.popup), top.position);

    if (menuOf(system, hmenu) !== menu) {
      return 0;
    }

    under = !!((menu.items[top.position]?.flags ?? 0) & (MF_GRAYED | MF_DISABLED));
  }

  const now = menu.find(command, 0);
  const grayed = !!now && !!(now.item.flags & (MF_GRAYED | MF_DISABLED));

  return grayed || under ? 3 : 2;
}

/**
 * A key message that is one of a table's accelerators, sent on as the
 * command, as `USER.EXE` sends it (seg19 `0792`). The first entry for the key
 * is taken -- a virtual key from `WM_KEYDOWN` or `WM_SYSKEYDOWN`, a character
 * from `WM_CHAR` or `WM_SYSCHAR`, with Shift and Control for a virtual key and
 * Alt for either as `GetKeyState` has them, not as the message says (`0825`-
 * `088c`; `accsys`) -- and the answer is TRUE whatever becomes of it.
 *
 * The window's menu bar, where it is not a child, is told first (see `tell`);
 * where the bar has not the command, the window's system menu is: its own, or
 * where it has none and `WS_SYSMENU`, the one every such window shows,
 * brought up to the window's state first (`08c2`-`08f0`, seg9 `0d8b`). A
 * command found grayed is not sent; nor one found while a window has the
 * mouse captured or this window is disabled, nor one of the bar's while it is
 * minimized (`08f5`-`0922`). Else it is sent straight to the window's
 * procedure, `WM_SYSCOMMAND` for the system menu's and `WM_COMMAND` for any
 * other, a command no menu has among them, with 1 in the high word of
 * `lParam` (`0939`). Nothing on the bar is flashed. **Recorded** by `accinit`
 * and `accsys`.
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

  const down = (vk: number) => (keyState(this, vk) & 0x80) !== 0;
  const entry = table.entries.find((entry) => {
    if (!!(entry.flags & FVIRTKEY) !== virtual || entry.key !== (lpmsg.wParam & 0xffff)) {
      return false;
    }

    if (
      virtual &&
      (!!(entry.flags & FSHIFT) !== down(User.VK_SHIFT) ||
        !!(entry.flags & FCONTROL) !== down(User.VK_CONTROL))
    ) {
      return false;
    }

    return !!(entry.flags & FALT) === down(VK_MENU);
  });

  if (!entry) {
    return 0;
  }

  const send = async (message: number, wParam: number, lParam: number) => {
    const resolved = this.handles.resolve(hwnd);
    const windowClass = resolved && this.handles.retrieve(resolved.options.windowClass);

    if (windowClass) {
      await this.scheduler.callWndProc(windowClass, hwnd, message, wParam, lParam);
    }
  };
  const command = entry.command;
  let told = 0;
  let fromSystemMenu = false;

  if (command) {
    const resolved = this.handles.resolve(hwnd);

    if (resolved?.window && !(resolved.window.style & WS_CHILD)) {
      told = await tell(this, resolved.options?.menu ?? 0, command, send);
    }

    const now = this.handles.resolve(hwnd);
    const window = now?.window;

    if (!told && window && now.desktop) {
      let holder = 0;

      if (window.systemMenu) {
        holder = handleOf(this, systemMenuHolderOf(window, now.desktop.screen));
      } else if (window.style & WS_SYSMENU) {
        systemMenuBroughtUp(window, now.desktop.screen);
        holder = handleOf(this, systemMenuHolderOf(window, now.desktop.screen));
      }

      told = await tell(this, holder, command, send);
      fromSystemMenu = told !== 0;
    }
  }

  const window = this.handles.resolve(hwnd)?.window;
  const held =
    told === 3 ||
    (told !== 0 &&
      ((!fromSystemMenu && window?.state === 'minimized') ||
        !!this.rasterInput?.capture?.hwnd ||
        !!(window && window.style & WS_DISABLED)));

  if (!held) {
    await send(fromSystemMenu ? User.WM_SYSCOMMAND : User.WM_COMMAND, command, 1 << 16);
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
