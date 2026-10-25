'use strict';

import {
  MIDI_INQUEUE,
  PREPARED,
  callbackOk,
  errorText,
  headerFlags,
  headerOk,
  setHeaderFlags,
  writable,
} from './checks.js';
import {
  Keep,
  Kind,
  MMSYSERR_BADDEVICEID,
  MMSYSERR_INVALFLAG,
  MMSYSERR_INVALHANDLE,
  MMSYSERR_INVALPARAM,
  MMSYSERR_NODRIVER,
  MMSYSERR_NOERROR,
  MMSYSERR_NOTSUPPORTED,
  close as closeDevice,
  count,
  dwordBytes,
  handleOf,
  handleType,
  open as openDevice,
  placeOf,
  sendByHandle,
  sendById,
  tableOf,
  writeBytes,
} from './devices.js';
import { getDevCaps, getId, message, plain } from './wave.js';

/**
 * `midiOut*` and `midiIn*`: MIDI devices, as MMSYSTEM answers for them and
 * passes them to their drivers. The twin of `mmsystem/midi.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg6, seg1 `c4`-`1e4`), where it is not as
 * waveform devices are (`wave.ts`):
 *
 * * `midiOutOpen` and `midiInOpen` check the handle can be written, then the
 *   callback, then that the flags' low word is nought (`MMSYSERR_INVALFLAG`,
 *   10), and write the handle nought. There is no asking only. A number past
 *   the devices is `MMSYSERR_BADDEVICEID` (2); the mapper's with no mapper
 *   installed, `MMSYSERR_NODRIVER` (6). The driver is sent `MODM_OPEN` (3) or
 *   `MIDM_OPEN` (37h) with a `MIDIOPENDESC` -- the handle, the callback, the
 *   program's doubleword -- and for its own doubleword a far pointer into
 *   the handle's block, which starts at nought.
 * * Preparing clears the header's flags and sends `MODM_PREPARE`, and the
 *   driver marks it prepared; MMSYSTEM marks it only where it prepares the
 *   header itself, the driver answering `MMSYSERR_NOTSUPPORTED` (8). One
 *   already prepared answers nought. Unpreparing one not prepared answers
 *   nought; one queued is `MIDIERR_STILLPLAYING` (65).
 * * `midiOutLongMsg` and `midiInAddBuffer` need a header prepared
 *   (`MIDIERR_UNPREPARED`, 64) and not queued (65). The long message's header
 *   is not checked as the others are, only that no flag past the three it
 *   has is set (10); the input buffer's is.
 * * `midiOutShortMsg` passes its message as `MODM_DATA` (7);
 *   `midiOutCachePatches` and `midiOutCacheDrumPatches` check 256 bytes of
 *   patches can be written and the flags (10), and pass the bank in the
 *   second parameter's high word, the flags in its low.
 */

const MIDIERR_UNPREPARED = 64;
const MIDIERR_STILLPLAYING = 65;

interface Side {
  kind: Kind;
  getDevCaps: number;
  open: number;
  close: number;
  prepare: number;
  unprepare: number;
}

const OUT: Side = {
  kind: Kind.MidiOut,
  getDevCaps: 2,
  open: 3,
  close: 4,
  prepare: 5,
  unprepare: 6,
};
const IN: Side = {
  kind: Kind.MidiIn,
  getDevCaps: 0x36,
  open: 0x37,
  close: 0x38,
  prepare: 0x39,
  unprepare: 0x3a,
};

const MODM_DATA = 7;
const MODM_LONGDATA = 8;
const MODM_RESET = 9;
const MODM_GETVOLUME = 10;
const MODM_SETVOLUME = 11;
const MODM_CACHEPATCHES = 12;
const MODM_CACHEDRUMPATCHES = 13;
const MIDM_ADDBUFFER = 0x3b;
const MIDM_START = 0x3c;
const MIDM_STOP = 0x3d;
const MIDM_RESET = 0x3e;

async function open(
  system: any,
  direction: Side,
  handle: number,
  id: number,
  callback: number,
  instance: number,
  flags: number
) {
  if (!writable(system, handle, 2) || !callbackOk(system, callback, flags >>> 16)) {
    return MMSYSERR_INVALPARAM;
  }

  if (flags & 0xffff) {
    return MMSYSERR_INVALFLAG;
  }

  writeBytes(system, handle, [0, 0]);

  const found = placeOf(system, direction.kind, id);

  if (!found) {
    return MMSYSERR_BADDEVICEID;
  }

  const [place, device] = found;

  if (tableOf(system, direction.kind).entries[place].procedure === null) {
    return MMSYSERR_NODRIVER;
  }

  const describe = (opened: number) => [
    opened & 0xff,
    (opened >>> 8) & 0xff,
    ...dwordBytes(callback),
    ...dwordBytes(instance),
  ];
  const [answer, opened] = await openDevice(
    system,
    direction.kind,
    place,
    device,
    id,
    direction.open,
    describe,
    flags,
    false,
    Keep.Handle
  );

  if (opened !== null) {
    writeBytes(system, handle, [opened & 0xff, (opened >>> 8) & 0xff]);
  }

  return answer;
}

/** The handle checked, then the header: an error, or null. */
function checked(system: any, handle: number, header: number, size: number, kind: Kind) {
  if (!handleOf(system, handle, kind)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (!headerOk(system, header, size, handleType(kind))) {
    return MMSYSERR_INVALPARAM;
  }

  return null;
}

async function prepare(system: any, direction: Side, handle: number, header: number, size: number) {
  const error = checked(system, handle, header, size, direction.kind);

  if (error !== null) {
    return error;
  }

  if (headerFlags(system, header) & PREPARED) {
    return MMSYSERR_NOERROR;
  }

  setHeaderFlags(system, header, 0);

  const answer =
    ((await sendByHandle(
      system,
      handle,
      direction.kind,
      direction.prepare,
      header,
      size & 0xffff
    )) ?? 0) & 0xffff;

  if (answer !== MMSYSERR_NOTSUPPORTED) {
    return answer;
  }

  /* MMSYSTEM's own preparing: the header and its data locked in place,
   * which in WinBox's memory they always are. */
  setHeaderFlags(system, header, headerFlags(system, header) | PREPARED);

  return MMSYSERR_NOERROR;
}

async function unprepare(
  system: any,
  direction: Side,
  handle: number,
  header: number,
  size: number
) {
  const error = checked(system, handle, header, size, direction.kind);

  if (error !== null) {
    return error;
  }

  const flags = headerFlags(system, header);

  if (!(flags & PREPARED)) {
    return MMSYSERR_NOERROR;
  }

  if (flags & MIDI_INQUEUE) {
    return MIDIERR_STILLPLAYING;
  }

  const answer =
    ((await sendByHandle(
      system,
      handle,
      direction.kind,
      direction.unprepare,
      header,
      size & 0xffff
    )) ?? 0) & 0xffff;

  if (answer !== MMSYSERR_NOTSUPPORTED) {
    return answer;
  }

  setHeaderFlags(system, header, headerFlags(system, header) & ~PREPARED);

  return MMSYSERR_NOERROR;
}

/** A header's flags as a long message or a buffer needs them: an error, or null. */
function ready(flags: number) {
  if (!(flags & PREPARED)) {
    return MIDIERR_UNPREPARED;
  }

  if (flags & MIDI_INQUEUE) {
    return MIDIERR_STILLPLAYING;
  }

  return null;
}

export function midiOutGetNumDevs(this: any) {
  return count(this, Kind.MidiOut);
}

export function midiInGetNumDevs(this: any) {
  return count(this, Kind.MidiIn);
}

export function midiOutGetDevCaps(this: any, uDeviceID: number, lpCaps: number, cbCaps: number) {
  return getDevCaps(this, Kind.MidiOut, OUT.getDevCaps, uDeviceID & 0xffff, lpCaps, cbCaps);
}

export function midiInGetDevCaps(this: any, uDeviceID: number, lpCaps: number, cbCaps: number) {
  return getDevCaps(this, Kind.MidiIn, IN.getDevCaps, uDeviceID & 0xffff, lpCaps, cbCaps);
}

export function midiGetErrorText(this: any, uError: number, lpText: number, cchText: number) {
  return errorText(this, uError, lpText >>> 0, cchText, [64, 69]);
}

export function midiOutOpen(
  this: any,
  lphMidi: number,
  uDeviceID: number,
  dwCallback: number,
  dwInstance: number,
  dwFlags: number
) {
  return open(
    this,
    OUT,
    lphMidi >>> 0,
    uDeviceID & 0xffff,
    dwCallback >>> 0,
    dwInstance >>> 0,
    dwFlags >>> 0
  );
}

export function midiInOpen(
  this: any,
  lphMidi: number,
  uDeviceID: number,
  dwCallback: number,
  dwInstance: number,
  dwFlags: number
) {
  return open(
    this,
    IN,
    lphMidi >>> 0,
    uDeviceID & 0xffff,
    dwCallback >>> 0,
    dwInstance >>> 0,
    dwFlags >>> 0
  );
}

export function midiOutClose(this: any, hMidi: number) {
  return closeDevice(this, hMidi & 0xffff, Kind.MidiOut, OUT.close);
}

export function midiInClose(this: any, hMidi: number) {
  return closeDevice(this, hMidi & 0xffff, Kind.MidiIn, IN.close);
}

export function midiOutPrepareHeader(this: any, hMidi: number, lpHdr: number, cbHdr: number) {
  return prepare(this, OUT, hMidi & 0xffff, lpHdr >>> 0, cbHdr);
}

export function midiInPrepareHeader(this: any, hMidi: number, lpHdr: number, cbHdr: number) {
  return prepare(this, IN, hMidi & 0xffff, lpHdr >>> 0, cbHdr);
}

export function midiOutUnprepareHeader(this: any, hMidi: number, lpHdr: number, cbHdr: number) {
  return unprepare(this, OUT, hMidi & 0xffff, lpHdr >>> 0, cbHdr);
}

export function midiInUnprepareHeader(this: any, hMidi: number, lpHdr: number, cbHdr: number) {
  return unprepare(this, IN, hMidi & 0xffff, lpHdr >>> 0, cbHdr);
}

export async function midiOutShortMsg(this: any, hMidi: number, dwMsg: number) {
  const answer = await sendByHandle(this, hMidi & 0xffff, Kind.MidiOut, MODM_DATA, dwMsg >>> 0, 0);

  return answer === null ? MMSYSERR_INVALHANDLE : answer & 0xffff;
}

export async function midiOutLongMsg(this: any, hMidi: number, lpHdr: number, cbHdr: number) {
  const handle = hMidi & 0xffff;
  const header = lpHdr >>> 0;

  if (!handleOf(this, handle, Kind.MidiOut)) {
    return MMSYSERR_INVALHANDLE;
  }

  const flags = headerFlags(this, header);

  if (flags & 0xfff8) {
    return MMSYSERR_INVALFLAG;
  }

  const error = ready(flags);

  if (error !== null) {
    return error;
  }

  return (
    ((await sendByHandle(this, handle, Kind.MidiOut, MODM_LONGDATA, header, cbHdr & 0xffff)) ?? 0) &
    0xffff
  );
}

export async function midiInAddBuffer(this: any, hMidi: number, lpHdr: number, cbHdr: number) {
  const handle = hMidi & 0xffff;
  const header = lpHdr >>> 0;
  const error =
    checked(this, handle, header, cbHdr, Kind.MidiIn) ?? ready(headerFlags(this, header));

  if (error !== null) {
    return error;
  }

  return (
    ((await sendByHandle(this, handle, Kind.MidiIn, MIDM_ADDBUFFER, header, cbHdr & 0xffff)) ?? 0) &
    0xffff
  );
}

export function midiOutReset(this: any, hMidi: number) {
  return plain(this, Kind.MidiOut, MODM_RESET, hMidi & 0xffff);
}

export function midiInStart(this: any, hMidi: number) {
  return plain(this, Kind.MidiIn, MIDM_START, hMidi & 0xffff);
}

export function midiInStop(this: any, hMidi: number) {
  return plain(this, Kind.MidiIn, MIDM_STOP, hMidi & 0xffff);
}

export function midiInReset(this: any, hMidi: number) {
  return plain(this, Kind.MidiIn, MIDM_RESET, hMidi & 0xffff);
}

export async function midiOutGetVolume(this: any, uDeviceID: number, lpdwVolume: number) {
  if (!writable(this, lpdwVolume, 4)) {
    return MMSYSERR_INVALPARAM;
  }

  return (
    (await sendById(this, Kind.MidiOut, uDeviceID & 0xffff, MODM_GETVOLUME, lpdwVolume >>> 0, 0)) &
    0xffff
  );
}

export async function midiOutSetVolume(this: any, uDeviceID: number, dwVolume: number) {
  return (
    (await sendById(this, Kind.MidiOut, uDeviceID & 0xffff, MODM_SETVOLUME, dwVolume >>> 0, 0)) &
    0xffff
  );
}

async function cachePatches(
  system: any,
  msg: number,
  hMidi: number,
  wBank: number,
  lpPatches: number,
  wFlags: number
) {
  const handle = hMidi & 0xffff;
  const flags = wFlags & 0xffff;

  if (!handleOf(system, handle, Kind.MidiOut)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (!writable(system, lpPatches, 0x100)) {
    return MMSYSERR_INVALPARAM;
  }

  if (flags & 0xfff8) {
    return MMSYSERR_INVALFLAG;
  }

  const second = (((wBank & 0xffff) << 16) | flags) >>> 0;

  return (
    ((await sendByHandle(system, handle, Kind.MidiOut, msg, lpPatches >>> 0, second)) ?? 0) & 0xffff
  );
}

export function midiOutCachePatches(
  this: any,
  hMidi: number,
  wBank: number,
  lpPatches: number,
  wFlags: number
) {
  return cachePatches(this, MODM_CACHEPATCHES, hMidi, wBank, lpPatches, wFlags);
}

export function midiOutCacheDrumPatches(
  this: any,
  hMidi: number,
  wPatch: number,
  lpKeys: number,
  wFlags: number
) {
  return cachePatches(this, MODM_CACHEDRUMPATCHES, hMidi, wPatch, lpKeys, wFlags);
}

export function midiOutGetID(this: any, hMidi: number, lpuDeviceID: number) {
  return getId(this, Kind.MidiOut, hMidi & 0xffff, lpuDeviceID >>> 0);
}

export function midiInGetID(this: any, hMidi: number, lpuDeviceID: number) {
  return getId(this, Kind.MidiIn, hMidi & 0xffff, lpuDeviceID >>> 0);
}

export function midiOutMessage(this: any, hMidi: number, uMsg: number, dw1: number, dw2: number) {
  return message(this, Kind.MidiOut, hMidi & 0xffff, uMsg, dw1, dw2);
}

export function midiInMessage(this: any, hMidi: number, uMsg: number, dw1: number, dw2: number) {
  return message(this, Kind.MidiIn, hMidi & 0xffff, uMsg, dw1, dw2);
}
