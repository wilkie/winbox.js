'use strict';

import {
  DONE,
  PREPARED,
  WAVE_INQUEUE,
  callbackOk,
  errorText,
  headerFlags,
  headerOk,
  readable,
  setHeaderFlags,
  writable,
} from './checks.js';
import {
  Keep,
  Kind,
  MAPPER,
  MMSYSERR_BADDEVICEID,
  MMSYSERR_INVALFLAG,
  MMSYSERR_INVALHANDLE,
  MMSYSERR_INVALPARAM,
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

/**
 * `waveOut*` and `waveIn*`: waveform devices, as MMSYSTEM answers for them
 * and passes them to their drivers. The twin of `mmsystem/wave.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg3 `866`-`1506`):
 *
 * * The counts are the sums `devices.ts` keeps. Capabilities and volume are
 *   asked of a device by number; the error texts are MMSYSTEM's own.
 *   Capabilities or a text with a size of nought answer nought, a buffer
 *   that cannot be written for its size `MMSYSERR_INVALPARAM` (11).
 * * `waveOutOpen` and `waveInOpen` check the format can be read for 14
 *   bytes, the callback, and that no flag but `WAVE_FORMAT_QUERY` (1) and
 *   `WAVE_ALLOWSYNC` (2) is in the low word (`MMSYSERR_INVALFLAG`, 10); then,
 *   unless only asking, that the handle can be written, and write it nought.
 *   With no device, or a number past them, `MMSYSERR_BADDEVICEID` (2)
 *   (**recorded** by `mmdevs`). The mapper's number with no mapper installed
 *   opens each device in turn until one opens. Else a handle is made, unless
 *   only asking, and the driver sent `WODM_OPEN` (5) or `WIDM_OPEN` (34h)
 *   with a doubleword for its own, a `WAVEOPENDESC` -- the handle, the
 *   format, the callback and the program's doubleword -- and the flags;
 *   refused, the handle goes.
 * * Preparing a header takes it as `checks.ts` does; one prepared answers
 *   nought. Its flags are cleared -- an output header's keeps its loop flags
 *   -- and the driver sent `WODM_PREPARE`; if the driver does not do it
 *   (`MMSYSERR_NOTSUPPORTED`, 8), MMSYSTEM does. Done, the header is marked
 *   prepared. Unpreparing one still queued is `WAVERR_STILLPLAYING` (33);
 *   one not prepared answers nought.
 * * Writing, or adding an input buffer, needs a header prepared
 *   (`WAVERR_UNPREPARED`, 34) and not queued (33); writing clears the
 *   header's done flag.
 * * Closing sends `WODM_CLOSE`; the handle goes only if the driver agrees.
 *   Every other call on a handle is its message passed on, the handle
 *   checked first, a pointer it gives checked writable first.
 * * `waveOutGetID` answers the number the device was opened by.
 */

const WAVERR_STILLPLAYING = 33;
const WAVERR_UNPREPARED = 34;

const WAVE_FORMAT_QUERY = 1;
const WHDR_BEGINLOOP_ENDLOOP = 0x0c;

interface Side {
  kind: Kind;
  getDevCaps: number;
  open: number;
  close: number;
  prepare: number;
  unprepare: number;
  write: number;
  getPos: number;
}

const OUT: Side = {
  kind: Kind.WaveOut,
  getDevCaps: 4,
  open: 5,
  close: 6,
  prepare: 7,
  unprepare: 8,
  write: 9,
  getPos: 13,
};

const IN: Side = {
  kind: Kind.WaveIn,
  getDevCaps: 0x33,
  open: 0x34,
  close: 0x35,
  prepare: 0x36,
  unprepare: 0x37,
  write: 0x38,
  getPos: 0x3c,
};

const WODM_PAUSE = 10;
const WODM_RESTART = 11;
const WODM_RESET = 12;
const WODM_GETPITCH = 14;
const WODM_SETPITCH = 15;
const WODM_GETVOLUME = 16;
const WODM_SETVOLUME = 17;
const WODM_GETPLAYBACKRATE = 18;
const WODM_SETPLAYBACKRATE = 19;
const WODM_BREAKLOOP = 20;
const WIDM_START = 0x39;
const WIDM_STOP = 0x3a;
const WIDM_RESET = 0x3b;

/** A device's capabilities, asked by its number. */
export async function getDevCaps(
  system: any,
  kind: Kind,
  message: number,
  id: number,
  far: number,
  size: number
) {
  size &= 0xffff;

  if (!size) {
    return MMSYSERR_NOERROR;
  }

  if (!writable(system, far, size)) {
    return MMSYSERR_INVALPARAM;
  }

  return (await sendById(system, kind, id, message, far >>> 0, size)) & 0xffff;
}

interface Open {
  handle: number;
  id: number;
  format: number;
  callback: number;
  instance: number;
  flags: number;
}

/** A waveform device opened, or asked whether it takes a format. */
async function open(system: any, direction: Side, args: Open): Promise<number> {
  const query = (args.flags & WAVE_FORMAT_QUERY) !== 0;

  if (!readable(system, args.format, 14) || !callbackOk(system, args.callback, args.flags >>> 16)) {
    return MMSYSERR_INVALPARAM;
  }

  if (args.flags & 0xfffc) {
    return MMSYSERR_INVALFLAG;
  }

  if (!query) {
    if (!writable(system, args.handle, 2)) {
      return MMSYSERR_INVALPARAM;
    }

    writeBytes(system, args.handle, [0, 0]);
  }

  if (!count(system, direction.kind)) {
    return MMSYSERR_BADDEVICEID;
  }

  const found = placeOf(system, direction.kind, args.id);

  if (!found) {
    return MMSYSERR_BADDEVICEID;
  }

  const [place, device] = found;
  const mapped = tableOf(system, direction.kind).entries[place].procedure !== null;
  const many = count(system, direction.kind);

  /* The mapper's number, and no mapper: each device tried in turn. */
  if (args.id === MAPPER && !mapped) {
    let answer = args.id;

    for (let id = 0; id < many; id++) {
      answer = await open(system, direction, { ...args, id });

      if (answer === MMSYSERR_NOERROR) {
        break;
      }
    }

    return answer;
  }

  const describe = (handle: number) => [
    handle & 0xff,
    (handle >>> 8) & 0xff,
    ...dwordBytes(args.format),
    ...dwordBytes(args.callback),
    ...dwordBytes(args.instance),
  ];
  const [answer, handle] = await openDevice(
    system,
    direction.kind,
    place,
    device,
    args.id,
    direction.open,
    describe,
    args.flags,
    query,
    Keep.Stack
  );

  if (handle !== null) {
    writeBytes(system, args.handle, [handle & 0xff, (handle >>> 8) & 0xff]);
  }

  return answer;
}

/** The checks every header call makes first: the handle, then the header. */
function checked(system: any, handle: number, header: number, size: number, kind: Kind) {
  if (!handleOf(system, handle, kind)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (!headerOk(system, header, size, handleType(kind))) {
    return MMSYSERR_INVALPARAM;
  }

  return null;
}

async function prepareHeader(
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

  if (flags & PREPARED) {
    return MMSYSERR_NOERROR;
  }

  /* An output header keeps its loop flags; an input header's all go. */
  setHeaderFlags(
    system,
    header,
    direction.kind === Kind.WaveOut ? flags & WHDR_BEGINLOOP_ENDLOOP : 0
  );

  let answer =
    ((await sendByHandle(
      system,
      handle,
      direction.kind,
      direction.prepare,
      header,
      size & 0xffff
    )) ?? 0) & 0xffff;

  /* MMSYSTEM's own preparing: the header and its data locked in place,
   * which in WinBox's memory they always are. */
  if (answer === MMSYSERR_NOTSUPPORTED) {
    answer = MMSYSERR_NOERROR;
  }

  if (answer === MMSYSERR_NOERROR) {
    setHeaderFlags(system, header, headerFlags(system, header) | PREPARED);
  }

  return answer;
}

async function unprepareHeader(
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

  if (flags & WAVE_INQUEUE) {
    return WAVERR_STILLPLAYING;
  }

  if (!(flags & PREPARED)) {
    return MMSYSERR_NOERROR;
  }

  let answer =
    ((await sendByHandle(
      system,
      handle,
      direction.kind,
      direction.unprepare,
      header,
      size & 0xffff
    )) ?? 0) & 0xffff;

  if (answer === MMSYSERR_NOTSUPPORTED) {
    answer = MMSYSERR_NOERROR;
  }

  if (answer === MMSYSERR_NOERROR) {
    setHeaderFlags(system, header, headerFlags(system, header) & ~PREPARED);
  }

  return answer;
}

async function writeHeader(
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
    return WAVERR_UNPREPARED;
  }

  if (flags & WAVE_INQUEUE) {
    return WAVERR_STILLPLAYING;
  }

  if (direction.kind === Kind.WaveOut) {
    setHeaderFlags(system, header, flags & ~DONE);
  }

  return (
    ((await sendByHandle(system, handle, direction.kind, direction.write, header, size & 0xffff)) ??
      0) & 0xffff
  );
}

/** A call on a handle that is its message passed on, with nothing. */
export async function plain(system: any, kind: Kind, message: number, handle: number) {
  const answer = await sendByHandle(system, handle, kind, message, 0, 0);

  return answer === null ? MMSYSERR_INVALHANDLE : answer & 0xffff;
}

async function getPosition(
  system: any,
  direction: Side,
  handle: number,
  far: number,
  size: number
) {
  if (!handleOf(system, handle, direction.kind)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (!writable(system, far, size & 0xffff)) {
    return MMSYSERR_INVALPARAM;
  }

  return (
    ((await sendByHandle(
      system,
      handle,
      direction.kind,
      direction.getPos,
      far >>> 0,
      size & 0xffff
    )) ?? 0) & 0xffff
  );
}

/** `waveOutGetPitch` and `waveOutGetPlaybackRate`: a doubleword asked for. */
async function getDword(system: any, message: number, handle: number, far: number) {
  if (!handleOf(system, handle, Kind.WaveOut)) {
    return MMSYSERR_INVALHANDLE;
  }

  if (!writable(system, far, 4)) {
    return MMSYSERR_INVALPARAM;
  }

  return ((await sendByHandle(system, handle, Kind.WaveOut, message, far >>> 0, 0)) ?? 0) & 0xffff;
}

/** `waveOutSetPitch` and `waveOutSetPlaybackRate`. */
async function setDword(system: any, message: number, handle: number, value: number) {
  const answer = await sendByHandle(system, handle, Kind.WaveOut, message, value >>> 0, 0);

  return answer === null ? MMSYSERR_INVALHANDLE : answer & 0xffff;
}

/** The number a device was opened by. */
export function getId(system: any, kind: Kind, handle: number, far: number) {
  const opened = handleOf(system, handle, kind);

  if (!opened) {
    return MMSYSERR_INVALHANDLE;
  }

  if (!writable(system, far, 2)) {
    return MMSYSERR_INVALPARAM;
  }

  writeBytes(system, far, [opened.id & 0xff, (opened.id >>> 8) & 0xff]);

  return MMSYSERR_NOERROR;
}

/** Any message, to an open device: nought for a handle that is none. */
export async function message(
  system: any,
  kind: Kind,
  handle: number,
  msg: number,
  first: number,
  second: number
) {
  return (
    ((await sendByHandle(system, handle, kind, msg & 0xffff, first >>> 0, second >>> 0)) ?? 0) >>> 0
  );
}

export function waveOutGetNumDevs(this: any) {
  return count(this, Kind.WaveOut);
}

export function waveInGetNumDevs(this: any) {
  return count(this, Kind.WaveIn);
}

export function waveOutGetDevCaps(this: any, uDeviceID: number, lpCaps: number, cbCaps: number) {
  return getDevCaps(this, Kind.WaveOut, OUT.getDevCaps, uDeviceID & 0xffff, lpCaps, cbCaps);
}

export function waveInGetDevCaps(this: any, uDeviceID: number, lpCaps: number, cbCaps: number) {
  return getDevCaps(this, Kind.WaveIn, IN.getDevCaps, uDeviceID & 0xffff, lpCaps, cbCaps);
}

export function waveGetErrorText(this: any, uError: number, lpText: number, cchText: number) {
  return errorText(this, uError, lpText >>> 0, cchText, [32, 35]);
}

function openArgs(
  lphWave: number,
  uDeviceID: number,
  lpFormat: number,
  dwCallback: number,
  dwInstance: number,
  dwFlags: number
): Open {
  return {
    handle: lphWave >>> 0,
    id: uDeviceID & 0xffff,
    format: lpFormat >>> 0,
    callback: dwCallback >>> 0,
    instance: dwInstance >>> 0,
    flags: dwFlags >>> 0,
  };
}

export function waveOutOpen(
  this: any,
  lphWave: number,
  uDeviceID: number,
  lpFormat: number,
  dwCallback: number,
  dwInstance: number,
  dwFlags: number
) {
  return open(this, OUT, openArgs(lphWave, uDeviceID, lpFormat, dwCallback, dwInstance, dwFlags));
}

export function waveInOpen(
  this: any,
  lphWave: number,
  uDeviceID: number,
  lpFormat: number,
  dwCallback: number,
  dwInstance: number,
  dwFlags: number
) {
  return open(this, IN, openArgs(lphWave, uDeviceID, lpFormat, dwCallback, dwInstance, dwFlags));
}

export function waveOutClose(this: any, hWave: number) {
  return closeDevice(this, hWave & 0xffff, Kind.WaveOut, OUT.close);
}

export function waveInClose(this: any, hWave: number) {
  return closeDevice(this, hWave & 0xffff, Kind.WaveIn, IN.close);
}

export function waveOutPrepareHeader(this: any, hWave: number, lpHdr: number, cbHdr: number) {
  return prepareHeader(this, OUT, hWave & 0xffff, lpHdr >>> 0, cbHdr);
}

export function waveInPrepareHeader(this: any, hWave: number, lpHdr: number, cbHdr: number) {
  return prepareHeader(this, IN, hWave & 0xffff, lpHdr >>> 0, cbHdr);
}

export function waveOutUnprepareHeader(this: any, hWave: number, lpHdr: number, cbHdr: number) {
  return unprepareHeader(this, OUT, hWave & 0xffff, lpHdr >>> 0, cbHdr);
}

export function waveInUnprepareHeader(this: any, hWave: number, lpHdr: number, cbHdr: number) {
  return unprepareHeader(this, IN, hWave & 0xffff, lpHdr >>> 0, cbHdr);
}

export function waveOutWrite(this: any, hWave: number, lpHdr: number, cbHdr: number) {
  return writeHeader(this, OUT, hWave & 0xffff, lpHdr >>> 0, cbHdr);
}

export function waveInAddBuffer(this: any, hWave: number, lpHdr: number, cbHdr: number) {
  return writeHeader(this, IN, hWave & 0xffff, lpHdr >>> 0, cbHdr);
}

export function waveOutPause(this: any, hWave: number) {
  return plain(this, Kind.WaveOut, WODM_PAUSE, hWave & 0xffff);
}

export function waveOutRestart(this: any, hWave: number) {
  return plain(this, Kind.WaveOut, WODM_RESTART, hWave & 0xffff);
}

export function waveOutReset(this: any, hWave: number) {
  return plain(this, Kind.WaveOut, WODM_RESET, hWave & 0xffff);
}

export function waveOutBreakLoop(this: any, hWave: number) {
  return plain(this, Kind.WaveOut, WODM_BREAKLOOP, hWave & 0xffff);
}

export function waveInStart(this: any, hWave: number) {
  return plain(this, Kind.WaveIn, WIDM_START, hWave & 0xffff);
}

export function waveInStop(this: any, hWave: number) {
  return plain(this, Kind.WaveIn, WIDM_STOP, hWave & 0xffff);
}

export function waveInReset(this: any, hWave: number) {
  return plain(this, Kind.WaveIn, WIDM_RESET, hWave & 0xffff);
}

export function waveOutGetPosition(this: any, hWave: number, lpInfo: number, cbInfo: number) {
  return getPosition(this, OUT, hWave & 0xffff, lpInfo >>> 0, cbInfo);
}

export function waveInGetPosition(this: any, hWave: number, lpInfo: number, cbInfo: number) {
  return getPosition(this, IN, hWave & 0xffff, lpInfo >>> 0, cbInfo);
}

export function waveOutGetPitch(this: any, hWave: number, lpdwPitch: number) {
  return getDword(this, WODM_GETPITCH, hWave & 0xffff, lpdwPitch >>> 0);
}

export function waveOutGetPlaybackRate(this: any, hWave: number, lpdwRate: number) {
  return getDword(this, WODM_GETPLAYBACKRATE, hWave & 0xffff, lpdwRate >>> 0);
}

export function waveOutSetPitch(this: any, hWave: number, dwPitch: number) {
  return setDword(this, WODM_SETPITCH, hWave & 0xffff, dwPitch);
}

export function waveOutSetPlaybackRate(this: any, hWave: number, dwRate: number) {
  return setDword(this, WODM_SETPLAYBACKRATE, hWave & 0xffff, dwRate);
}

/** A device's volume, asked by its number. */
export async function waveOutGetVolume(this: any, uDeviceID: number, lpdwVolume: number) {
  if (!writable(this, lpdwVolume, 4)) {
    return MMSYSERR_INVALPARAM;
  }

  return (
    (await sendById(this, Kind.WaveOut, uDeviceID & 0xffff, WODM_GETVOLUME, lpdwVolume >>> 0, 0)) &
    0xffff
  );
}

export async function waveOutSetVolume(this: any, uDeviceID: number, dwVolume: number) {
  return (
    (await sendById(this, Kind.WaveOut, uDeviceID & 0xffff, WODM_SETVOLUME, dwVolume >>> 0, 0)) &
    0xffff
  );
}

export function waveOutGetID(this: any, hWave: number, lpuDeviceID: number) {
  return getId(this, Kind.WaveOut, hWave & 0xffff, lpuDeviceID >>> 0);
}

export function waveInGetID(this: any, hWave: number, lpuDeviceID: number) {
  return getId(this, Kind.WaveIn, hWave & 0xffff, lpuDeviceID >>> 0);
}

export function waveOutMessage(this: any, hWave: number, uMsg: number, dw1: number, dw2: number) {
  return message(this, Kind.WaveOut, hWave & 0xffff, uMsg, dw1, dw2);
}

export function waveInMessage(this: any, hWave: number, uMsg: number, dw1: number, dw2: number) {
  return message(this, Kind.WaveIn, hWave & 0xffff, uMsg, dw1, dw2);
}
