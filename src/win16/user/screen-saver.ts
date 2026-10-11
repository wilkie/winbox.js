'use strict';

import { clockOf } from '../../emulator/clock.js';
import { WinExec } from '../kernel/WinExec.js';
import { readProfile } from '../kernel/profiles.js';
import { WM_SYSTIMER } from './caret.js';
import { GetSysModalWindow } from './userwin.js';
import { tickCount } from './GetTickCount.js';
import { postMessage, setTimer } from './queue.js';

/**
 * The screen saver, as USER starts it. **Read out** of `USER.EXE`, and
 * **recorded** by `spiidle`; the Rust engine's `screen_saver.rs` is the
 * same.
 *
 * * USER notes when input last came, `SYSTEM`'s millisecond count
 *   (`[0FAh]`): as a look reads each event of the system's queue, the
 *   event's time (seg1 `2b7f`, `3090`, `317b`); as `SPI_SETSCREENSAVETIMEOUT`
 *   or `SPI_SETSCREENSAVEACTIVE` sets the delay, now (seg41 `1297`,
 *   `12f8`); and as a window is made active, now, where nothing is noted
 *   (seg1 `37f2`-`3803`).
 * * The first `InitApp` gives the task list's window, USER's own of class
 *   8003h, a system timer of ten seconds, -3 (seg5 `0470`-`047f`), whose
 *   procedure (seg1 `3400`, `334e`) looks: with no mouse button down, no
 *   window system-modal, the screen saver active with a delay, input
 *   noted, more than the delay's seconds gone since it, and a window
 *   active, it posts that window `WM_SYSCOMMAND` with `SC_SCREENSAVE`, and
 *   notes nothing (`3364`-`33f7`). So it comes again only after more input.
 *   In 386 enhanced mode it also passes over a DOS program's window.
 * * `DefWindowProc` given `SC_SCREENSAVE` (seg1 `05f9`-`0688`), unless a
 *   menu is up or a window is system-modal, runs the program `SYSTEM.INI`'s
 *   `[boot] SCRNSAVE.EXE` names -- `SCRNSAVE.EXE` where it names none --
 *   with ` /s` after it, shown normally, with `WinExec`.
 */

export const SC_SCREENSAVE = 0xf140;

const WM_SYSCOMMAND = 0x0112;

/** The timer's identifier, -3, and its interval. */
const SCREEN_SAVE_TIMER = 0xfffd;
const EVERY = 10000;

const VK_LBUTTON = 0x01;
const VK_RBUTTON = 0x02;
const VK_MBUTTON = 0x04;

/** `SYSTEM`'s millisecond count, as `GetTickCount` answers it. */
function now(system: any) {
  return tickCount(clockOf(system).now());
}

/** Input noted at a time: an event's, or now. */
export function noteInput(system: any, time: number | null = null) {
  system._lastInput = (time ?? now(system)) >>> 0;
}

/** A window made active: now noted, where nothing is. */
export function noteActivation(system: any) {
  if (!system._lastInput) {
    noteInput(system);
  }
}

/** The system timer of ten seconds, given USER's task list's window. */
export function startScreenSaveTimer(system: any, hwnd: number) {
  setTimer(system, hwnd, SCREEN_SAVE_TIMER, EVERY, () => {
    look(system);
    return 0;
  });

  system._timers.get(`${hwnd}:${SCREEN_SAVE_TIMER}`).message = WM_SYSTIMER;
}

/** The timer's look: `SC_SCREENSAVE` posted where it is due. */
function look(system: any) {
  const buttons: Uint8Array = system._asyncKeys ?? new Uint8Array(256);

  if (
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].some((vk) => buttons[vk] & 0x80) ||
    GetSysModalWindow.call(system)
  ) {
    return;
  }

  const delay = ((system._parameters?.screenSave ?? 0) << 16) >> 16;
  const since = system._lastInput ?? 0;

  if (delay <= 0 || !since) {
    return;
  }

  const gone = (now(system) - since) >>> 0;
  const active = system.rasterDesktop?.active?.hwnd ?? 0;

  if (gone <= delay * 1000 || !active) {
    return;
  }

  postMessage(system, active, WM_SYSCOMMAND, SC_SCREENSAVE, 0);
  system._lastInput = 0;
}

/**
 * `DefWindowProc`'s `SC_SCREENSAVE`: the screen saver started. Not
 * followed: USER passes over it while a menu is up (`[1CAh]`) and while
 * its flag at `[0E0h]` is set.
 */
export async function screenSave(system: any) {
  if (GetSysModalWindow.call(system)) {
    return;
  }

  const profile = await readProfile(system, 'SYSTEM.INI');
  const name = profile.get('boot', 'SCRNSAVE.EXE', true) ?? 'SCRNSAVE.EXE';

  await WinExec.call(system, `${name.slice(0, 0x92)} /s`, 1);
}
