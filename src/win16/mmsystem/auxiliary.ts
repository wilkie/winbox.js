'use strict';

import { writable } from './checks.js';
import { Kind, MMSYSERR_INVALPARAM, count, sendById } from './devices.js';
import { getDevCaps } from './wave.js';

/**
 * `aux*`: auxiliary devices -- a card's mixer inputs, a CD's audio out --
 * which are never opened, only asked by number. The twin of
 * `mmsystem/auxiliary.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg8 `492`-`5dc`): each call is
 * `auxOutMessage`'s message to the device by its number, numbered across the
 * drivers as the other kinds are, the mapper's number the `auxmapper`'s. A
 * number past them answers `MMSYSERR_BADDEVICEID` (2), a place with no
 * driver `MMSYSERR_NODRIVER` (6). Capabilities with a size of nought answer
 * nought; a buffer that cannot be written, `MMSYSERR_INVALPARAM` (11).
 */

const AUXDM_GETDEVCAPS = 4;
const AUXDM_GETVOLUME = 5;
const AUXDM_SETVOLUME = 6;

export function auxGetNumDevs(this: any) {
  return count(this, Kind.Aux);
}

export function auxGetDevCaps(this: any, uDeviceID: number, lpCaps: number, cbCaps: number) {
  return getDevCaps(this, Kind.Aux, AUXDM_GETDEVCAPS, uDeviceID & 0xffff, lpCaps, cbCaps);
}

export async function auxGetVolume(this: any, uDeviceID: number, lpdwVolume: number) {
  if (!writable(this, lpdwVolume, 4)) {
    return MMSYSERR_INVALPARAM;
  }

  return (
    (await sendById(this, Kind.Aux, uDeviceID & 0xffff, AUXDM_GETVOLUME, lpdwVolume >>> 0, 0)) &
    0xffff
  );
}

export async function auxSetVolume(this: any, uDeviceID: number, dwVolume: number) {
  return (
    (await sendById(this, Kind.Aux, uDeviceID & 0xffff, AUXDM_SETVOLUME, dwVolume >>> 0, 0)) &
    0xffff
  );
}

/** Any message to a device by its number: a doubleword, its errors' high word nought. */
export async function auxOutMessage(
  this: any,
  uDeviceID: number,
  uMsg: number,
  dw1: number,
  dw2: number
) {
  return (
    (await sendById(this, Kind.Aux, uDeviceID & 0xffff, uMsg & 0xffff, dw1 >>> 0, dw2 >>> 0)) >>> 0
  );
}
