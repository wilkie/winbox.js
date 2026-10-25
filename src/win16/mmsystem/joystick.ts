'use strict';

import { KillTimer, SetTimer } from '../user/SetTimer.js';
import { IsWindow } from '../user/window-queries.js';
import { OpenDriver, SendDriverMessage } from '../user/drivers.js';
import { PostMessage } from '../user/PostMessage.js';
import { inFrame } from './devices.js';
import { exportAddress } from './mmio.js';

/**
 * The joystick calls, which MMSYSTEM answers through the driver
 * `SYSTEM.INI`'s `[drivers]` names `joystick`. The twin of
 * `mmsystem/joystick.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg8 `0`-`48e`, seg2 `780`-`8e3`);
 * **recorded** by `mmmisc` on both installations, neither of which has a
 * joystick driver:
 *
 * * As it loads, MMSYSTEM opens `joystick` twice, the second time with an
 *   `lParam` of 1, one for each joystick, and asks the first how many
 *   joysticks there are (`JDD_GETNUMDEVS`, 801h).
 * * With no driver, `joyGetNumDevs` answers 0 and every other call
 *   `MMSYSERR_NODRIVER` (6) -- but `joySetCapture` for no window, or one
 *   that is not, which answers `JOYERR_PARMS` (A5h) first. A joystick past
 *   the count is A5h too.
 * * `joyGetDevCaps` and `joyGetPos` are the driver's `JDD_GETDEVCAPS` (802h)
 *   and `JDD_GETPOS` (901h) to the joystick's driver, and nothing is checked
 *   of their pointers. `joySetCalibration` passes the six words it is given
 *   pointers to as `JDD_SETCALIBRATION` (902h) and writes back the six the
 *   driver gives.
 * * The threshold is MMSYSTEM's own, nought to begin with.
 * * `joySetCapture` refuses a window another capture of the joystick still
 *   has (`JOYERR_NOCANDO`, A6h); asks the capabilities, and the position,
 *   then sets a timer of the period, within the driver's least and most,
 *   whose procedure posts the window `MM_JOY1MOVE` and the like.
 *   `joyReleaseCapture` kills the timer.
 *
 * Not followed: the calibration MMSYSTEM sets as it loads from
 * `[joystick.drv]`'s `JoyCal` keys, read as six hexadecimal words; no
 * installation here has a joystick driver for it to go to.
 */

const MMSYSERR_NODRIVER = 6;
const JOYERR_PARMS = 0xa5;
const JOYERR_NOCANDO = 0xa6;

const JDD_GETNUMDEVS = 0x801;
const JDD_GETDEVCAPS = 0x802;
const JDD_GETPOS = 0x901;
const JDD_SETCALIBRATION = 0x902;

const MM_JOY1MOVE = 0x3a0;
const MM_JOY1ZMOVE = 0x3a2;
const MM_JOY1BUTTONDOWN = 0x3b5;
const MM_JOY1BUTTONUP = 0x3b7;

/** The hidden ordinal of MMSYSTEM's capture timer's procedure (seg8 `30b`). */
export const JOY_TIMER_ORDINAL = 1203;

interface Capture {
  hwnd: number;
  period: number;
  changed: number;
  threshold: number;
  timer: number;
}

interface Joysticks {
  drivers: [number, number];
  count: number;
  captures: [Capture, Capture];
  /** The last position each capture's timer saw: x, y, z and the buttons. */
  last: [number[], number[]];
}

function joysticksOf(system: any): Joysticks {
  const capture = () => ({ hwnd: 0, period: 0, changed: 0, threshold: 0, timer: 0 });

  return (system._mmJoysticks ??= {
    drivers: [0, 0],
    count: 0,
    captures: [capture(), capture()],
    last: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  });
}

function core(system: any) {
  return system.machine.cpu.core;
}

function word(system: any, far: number, offset = 0) {
  return core(system).read16((far >>> 16) & 0xffff, ((far & 0xffff) + offset) & 0xffff);
}

function setWord(system: any, far: number, value: number, offset = 0) {
  core(system).write16((far >>> 16) & 0xffff, ((far & 0xffff) + offset) & 0xffff, value & 0xffff);
}

/** The joystick driver opened as MMSYSTEM loads (seg2 `886`), after it has opened the first. */
export async function openJoysticks(system: any, first: number) {
  const joysticks = joysticksOf(system);

  joysticks.drivers[0] = first & 0xffff;

  if (!first) {
    return;
  }

  joysticks.drivers[1] = (await OpenDriver.call(system, 'joystick', null, 1)) & 0xffff;
  joysticks.captures[0].hwnd = joysticks.captures[1].hwnd = 0;
  joysticks.captures[0].threshold = joysticks.captures[1].threshold = 0;
  joysticks.captures[0].timer = joysticks.captures[1].timer = 0;
  joysticks.count = (await SendDriverMessage.call(system, first, JDD_GETNUMDEVS, 0, 0)) & 0xffff;
}

/** The checks every call but `joyGetNumDevs` makes first: an error, or null. */
function checked(system: any, id: number) {
  const joysticks = joysticksOf(system);

  if (!joysticks.drivers[0]) {
    return MMSYSERR_NODRIVER;
  }

  if ((id & 0xffff) >= joysticks.count) {
    return JOYERR_PARMS;
  }

  return null;
}

function driverOf(system: any, id: number) {
  /* The words after the first driver's: the second's, for joystick 1. */
  return joysticksOf(system).drivers[id & 1];
}

export function joyGetNumDevs(this: any) {
  const joysticks = joysticksOf(this);

  return joysticks.drivers[0] ? joysticks.count : 0;
}

export async function joyGetDevCaps(this: any, uJoyID: number, lpCaps: number, cbCaps: number) {
  const error = checked(this, uJoyID);

  if (error !== null) {
    return error;
  }

  return (
    (await SendDriverMessage.call(
      this,
      driverOf(this, uJoyID),
      JDD_GETDEVCAPS,
      lpCaps >>> 0,
      cbCaps & 0xffff
    )) & 0xffff
  );
}

export async function joyGetPos(this: any, uJoyID: number, lpInfo: number) {
  const error = checked(this, uJoyID);

  if (error !== null) {
    return error;
  }

  return (
    (await SendDriverMessage.call(this, driverOf(this, uJoyID), JDD_GETPOS, lpInfo >>> 0, 0)) &
    0xffff
  );
}

export function joyGetThreshold(this: any, uJoyID: number, lpuThreshold: number) {
  const error = checked(this, uJoyID);

  if (error !== null) {
    return error;
  }

  setWord(this, lpuThreshold >>> 0, joysticksOf(this).captures[uJoyID & 1].threshold);

  return 0;
}

export function joySetThreshold(this: any, uJoyID: number, uThreshold: number) {
  const error = checked(this, uJoyID);

  if (error !== null) {
    return error;
  }

  joysticksOf(this).captures[uJoyID & 1].threshold = uThreshold & 0xffff;

  return 0;
}

export function joyReleaseCapture(this: any, uJoyID: number) {
  const error = checked(this, uJoyID);

  if (error !== null) {
    return error;
  }

  const capture = joysticksOf(this).captures[uJoyID & 1];

  if (capture.hwnd) {
    KillTimer.call(this, 0, capture.timer);
    capture.timer = 0;
    capture.hwnd = 0;
  }

  return 0;
}

export async function joySetCapture(
  this: any,
  hwnd: number,
  uJoyID: number,
  uPeriod: number,
  bChanged: number
) {
  hwnd &= 0xffff;

  if (!hwnd || !IsWindow.call(this, hwnd)) {
    return JOYERR_PARMS;
  }

  const joysticks = joysticksOf(this);

  if (!joysticks.drivers[0]) {
    return MMSYSERR_NODRIVER;
  }

  const id = uJoyID & 0xffff;

  if (id >= joysticks.count) {
    return JOYERR_PARMS;
  }

  const capture = joysticks.captures[id & 1];

  if (capture.hwnd) {
    if (IsWindow.call(this, capture.hwnd)) {
      return JOYERR_NOCANDO;
    }

    joyReleaseCapture.call(this, id);
  }

  /* The capabilities, in MMSYSTEM's frame: the period kept between the
   * driver's least and most. */
  const [caps, [bytes]] = await inFrame(this, [new Uint8Array(0x36)], async ([far]) =>
    joyGetDevCaps.call(this, id, far, 0x36)
  );

  if (caps) {
    return JOYERR_NOCANDO;
  }

  const least = bytes[0x32] | (bytes[0x33] << 8);
  const most = bytes[0x34] | (bytes[0x35] << 8);
  let period = uPeriod & 0xffff;

  if (period < least) {
    period = least;
  }

  if (period > most) {
    period = most;
  }

  const [position] = await inFrame(this, [new Uint8Array(8)], async ([far]) =>
    joyGetPos.call(this, id, far)
  );

  if (position) {
    return position;
  }

  capture.period = period;
  capture.changed = bChanged & 0xffff;
  capture.timer = SetTimer.call(this, 0, 0, period, timerAddress(this)) & 0xffff;

  if (!capture.timer) {
    return JOYERR_NOCANDO;
  }

  capture.hwnd = hwnd;

  return 0;
}

/** The capture timer's procedure: its address, MMSYSTEM's own. */
function timerAddress(system: any) {
  return exportAddress(system, 'MMSYSTEM', JOY_TIMER_ORDINAL);
}

/**
 * The capture timer's procedure (seg8 `30b`): the joystick's position asked,
 * and the window posted a button's change, and its move -- every time, or,
 * asked for only changes, when the position moved past the threshold.
 */
export async function joyTimer(
  this: any,
  _hwnd: number,
  _msg: number,
  idEvent: number,
  _dwTime: number
) {
  const joysticks = joysticksOf(this);
  let id = idEvent & 0xffff;

  if (joysticks.captures[0].timer === id) {
    id = 0;
  } else if (joysticks.captures[1].timer === id) {
    id = 1;
  }

  const capture = joysticks.captures[id & 1];

  if (!capture.hwnd || !IsWindow.call(this, capture.hwnd)) {
    joyReleaseCapture.call(this, id);
  }

  const [answer, [info]] = await inFrame(this, [new Uint8Array(8)], async ([far]) =>
    SendDriverMessage.call(this, driverOf(this, id), JDD_GETPOS, far, 0)
  );

  if (answer & 0xffff) {
    return;
  }

  const x = info[0] | (info[1] << 8);
  const y = info[2] | (info[3] << 8);
  const z = info[4] | (info[5] << 8);
  const buttons = info[6] | (info[7] << 8);
  const last = joysticks.last[id & 1];
  const hwnd = capture.hwnd;
  const position = ((y << 16) | x) >>> 0;

  for (let bit = 0, mask = 1; bit < 4; bit++, mask <<= 1) {
    if ((last[3] ^ buttons) & mask) {
      const message = (mask & buttons ? MM_JOY1BUTTONDOWN : MM_JOY1BUTTONUP) + id;

      PostMessage.call(this, hwnd, message & 0xffff, ((mask << 8) | buttons) & 0xffff, position);
    }
  }

  const beyond = (from: number, to: number) => Math.abs(from - to) > capture.threshold;

  if (!capture.changed || beyond(last[0], x) || beyond(last[1], y)) {
    PostMessage.call(this, hwnd, (MM_JOY1MOVE + id) & 0xffff, buttons, position);
  } else if (beyond(last[2], z)) {
    PostMessage.call(this, hwnd, (MM_JOY1ZMOVE + id) & 0xffff, buttons, z);
  }

  joysticks.last[id & 1] = [x, y, z, buttons];
}

/** `joySetCalibration`: six words passed to the driver and the six it gives written back. */
export async function joySetCalibration(
  this: any,
  uJoyID: number,
  lpwXbase: number,
  lpwXdelta: number,
  lpwYbase: number,
  lpwYdelta: number,
  lpwZbase: number,
  lpwZdelta: number
) {
  const error = checked(this, uJoyID);

  if (error !== null) {
    return error;
  }

  const pointers = [lpwXbase, lpwXdelta, lpwYbase, lpwYdelta, lpwZbase, lpwZdelta].map(
    (far) => far >>> 0
  );
  const given = new Uint8Array(12);

  pointers.forEach((far, i) => {
    const value = word(this, far);

    given[i * 2] = value & 0xff;
    given[i * 2 + 1] = value >> 8;
  });

  const [answer, [, back]] = await inFrame(
    this,
    [given, new Uint8Array(12)],
    async ([lpIn, lpOut]) =>
      SendDriverMessage.call(this, driverOf(this, uJoyID), JDD_SETCALIBRATION, lpIn, lpOut)
  );

  pointers.forEach((far, i) => setWord(this, far, back[i * 2] | (back[i * 2 + 1] << 8)));

  return answer & 0xffff;
}
