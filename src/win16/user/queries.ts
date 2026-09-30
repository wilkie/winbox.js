'use strict';

import { keyStates } from './accelerators.js';
import { MenuData } from './menu-data.js';

/**
 * Small questions a program asks USER. **Recorded** by `queries`.
 */

/**
 * Which of the 256 characters each `IsChar...` answers yes for, as
 * `queries` recorded them: 64 hexadecimal digits, character 0 in the top bit
 * of the first. The ANSI letters with accents count, and the multiplication
 * and division signs, D7h and F7h, do not.
 */
const CHARACTERS = {
  alpha: '00000000000000007fffffe07fffffe00028002900000000fffffefffffffeff',
  alphanumeric: '000000000000ffc07fffffe07fffffe00028002900000000fffffefffffffeff',
  upper: '00000000000000007fffffe0000000000028000100000000fffffefe00000000',
  lower: '0000000000000000000000007fffffe0000000280000000000000001fffffeff',
};

function isCharacter(table: string, char: number) {
  const code = char & 0xff;

  return (parseInt(table[code >> 2], 16) >> (3 - (code & 3))) & 1;
}

export function IsCharAlpha(this: any, cChar: number) {
  return isCharacter(CHARACTERS.alpha, cChar);
}

export function IsCharAlphaNumeric(this: any, cChar: number) {
  return isCharacter(CHARACTERS.alphanumeric, cChar);
}

export function IsCharUpper(this: any, cChar: number) {
  return isCharacter(CHARACTERS.upper, cChar);
}

export function IsCharLower(this: any, cChar: number) {
  return isCharacter(CHARACTERS.lower, cChar);
}

/** A far pointer's segment and offset. */
function far(pointer: number) {
  return { segment: (pointer >>> 16) & 0xffff, offset: pointer & 0xffff };
}

/** The key-state table's 256 bytes, copied out: what `GetKeyState` reads. */
export function GetKeyboardState(this: any, lpbKeyState: number) {
  const core = this.machine.cpu.core;
  const { segment, offset } = far(lpbKeyState);
  const table = keyStates(this);

  for (let vk = 0; vk < 256; vk++) {
    core.write8(segment, (offset + vk) & 0xffff, table[vk]);
  }
}

/** The key-state table set from 256 bytes, as `GetKeyState` then answers. */
export function SetKeyboardState(this: any, lpbKeyState: number) {
  const core = this.machine.cpu.core;
  const { segment, offset } = far(lpbKeyState);
  const table = keyStates(this);

  for (let vk = 0; vk < 256; vk++) {
    table[vk] = core.read8(segment, (offset + vk) & 0xffff);
  }
}

/** Where a window's client area starts on the screen; the screen's for none. */
function originOf(system: any, hwnd: number) {
  const window = hwnd ? system.handles.resolve(hwnd) : null;

  return window?.clientOrigin ?? { x: 0, y: 0 };
}

/**
 * Points in one window's client area moved into another's, either being
 * the screen when nought. Answers nothing.
 */
export function MapWindowPoints(
  this: any,
  hwndFrom: number,
  hwndTo: number,
  lppt: number,
  cPoints: number
) {
  const core = this.machine.cpu.core;
  const { segment, offset } = far(lppt);
  const from = originOf(this, hwndFrom);
  const to = originOf(this, hwndTo);
  const dx = from.x - to.x;
  const dy = from.y - to.y;

  for (let index = 0; index < (cPoints & 0xffff); index++) {
    const at = (offset + index * 4) & 0xffff;
    const x = core.read16(segment, at);
    const y = core.read16(segment, (at + 2) & 0xffff);

    core.write16(segment, at, (x + dx) & 0xffff);
    core.write16(segment, (at + 2) & 0xffff, (y + dy) & 0xffff);
  }
}

/** Whether a handle is a menu's: not a window's, and not one destroyed. */
export function IsMenu(this: any, hMenu: number) {
  return hMenu && this.handles.resolve(hMenu) instanceof MenuData ? 1 : 0;
}

/**
 * Whether the message being handled was sent by another task. Nought for one
 * the program sent itself, one posted, and outside any message (`queries`);
 * one from another task is not recorded, and winbox.js answers nought for it
 * too.
 */
export function InSendMessage(this: any) {
  return 0;
}

/** The last message a task took from its queue: its time and point. */
export function noteTaken(system: any, msg: any) {
  const task = system.scheduler?.task;

  if (task) {
    task.lastTaken = { time: msg.time >>> 0, x: msg.pt?.x ?? 0, y: msg.pt?.y ?? 0 };
  }
}

/** The time of the message `GetMessage` last took (`queries`). */
export function GetMessageTime(this: any) {
  return this.scheduler?.task?.lastTaken?.time ?? 0;
}

/** Where the cursor was for the message `GetMessage` last took (`queries`). */
export function GetMessagePos(this: any) {
  const taken = this.scheduler?.task?.lastTaken;

  return taken ? ((taken.x & 0xffff) | ((taken.y & 0xffff) << 16)) >>> 0 : 0;
}

/**
 * Whether a pop-up shows: a visible top-level window that has an owner. A
 * program's own unowned overlapped window does not count, and an owned
 * pop-up does (`queries`); an unowned pop-up is not recorded.
 */
export function AnyPopup(this: any) {
  const desktop = this.rasterDesktop;

  if (!desktop) {
    return 0;
  }

  return desktop.windows.some(
    (window: any) => !window.parent && !window.titleOf && window.visible && window.owner
  )
    ? 1
    : 0;
}
