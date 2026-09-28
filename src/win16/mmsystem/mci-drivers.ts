'use strict';

import { Module } from '../module.js';
import { DWORD, LPARAM, LRESULT, UINT } from '../types.js';
import { DefDriverProc } from '../user/drivers.js';
import { PostMessage } from '../user/PostMessage.js';
import { midiOutGetNumDevs } from './midiOutGetNumDevs.js';
import { waveInGetNumDevs, waveOutGetNumDevs } from './devices.js';

/**
 * The MCI drivers, kept by winbox.js as TIMER is: `MCIWAVE.DRV`, the
 * waveform audio device, and `MCISEQ.DRV`, the MIDI sequencer. MMSYSTEM
 * opens one as an installable driver when a program opens its device, and
 * sends it the MCI commands. Each is found by its file's name, whether or
 * not the file is there, and its names are its own.
 *
 * **Read out** of `MCIWAVE.DRV` (seg1 `ac`, seg2 `1f08`, seg6 `0`, `240`) and
 * `MCISEQ.DRV` (seg2 `d88`, `0`, `1f3c`, `1fc2`), and **recorded** by
 * `mcidevs`, which opens each device by its type, asks every capability and
 * the product, and closes it:
 *
 * * Opened by type alone, a driver makes no instance and answers nought;
 *   playing, seeking, status and the rest then answer 112h.
 * * `MCI_GETDEVCAPS` answers each item as a pair, the value and a string
 *   resource, with 10000h, whose high half MMSYSTEM clears: the waveform
 *   device can play and record as there are devices out and in, counted as
 *   it loads, has audio, uses files, is compound and can save; the
 *   sequencer plays and has audio, uses files and is compound as there are
 *   MIDI devices out, counted as it is asked. An item past 9 is 112h for the
 *   one and 111h for the other.
 * * `MCI_INFO` with `MCI_INFO_PRODUCT` gives the driver's string: "Sound"
 *   from `MCIWAVE.DRV`, "MIDI Sequencer" from `MCISEQ.DRV`.
 * * A command that succeeds with `MCI_NOTIFY` posts `MM_MCINOTIFY` to the
 *   window in its `dwCallback`.
 *
 * Opening a file, **recorded** by `mcifile` in the same installation:
 *
 * * A waveform or MIDI file opens, and the device is stopped (`MCI_MODE_STOP`,
 *   20Dh). A file that is not there answers 113h.
 * * Its length, `MCI_STATUS_LENGTH`: a waveform file's in milliseconds, its
 *   samples' bytes over its bytes a second, to the nearest; a MIDI file's in
 *   sixteenths, the song pointer's unit, which is the sequencer's time
 *   format (4001h).
 * * Playing answers 146h from the one and 157h from the other, there being
 *   no device to play on; stopping and closing answer nought.
 *
 * Not followed: a file that is not waveform or MIDI inside, and how a MIDI
 * length rounds, which were not recorded; the configuration dialog; the
 * drivers' command tables, which only `mciSendString` reads.
 */

const MCI_NOTIFY = 0x1;
const MCI_WAIT = 0x2;
const MCI_OPEN_SHAREABLE = 0x100;
const MCI_OPEN_ELEMENT = 0x200;
const MCI_OPEN_ELEMENT_ID = 0x800;
const MCI_WAVE_OPEN_BUFFER = 0x10000;
const MCI_GETDEVCAPS_ITEM = 0x100;
const MCI_INFO_PRODUCT = 0x100;
const MCI_INFO_FILE = 0x200;
const MCI_STATUS_ITEM = 0x100;
const MCI_STATUS_LENGTH = 1;
const MCI_STATUS_MODE = 4;
const MCI_STATUS_TIME_FORMAT = 6;
const MCI_MODE_STOP = 0x20d;
const MCI_FORMAT_MILLISECONDS = 0;
const MCI_SEQ_FORMAT_SONGPTR = 0x4001;
const MM_MCINOTIFY = 0x3b9;
const MCI_NOTIFY_SUCCESSFUL = 1;

const MCIERR_UNRECOGNIZED_COMMAND = 0x105;
const MCIERR_HARDWARE = 0x103;
const MCIERR_FILE_NOT_FOUND = 0x113;
const MCIERR_WAVE_OUTPUTSUNSUITABLE = 0x146;
const MCIERR_SEQ_NOMIDIPRESENT = 0x157;
const MCIERR_PARAM_OVERFLOW = 0x10c;
const MCIERR_MISSING_PARAMETER = 0x111;
const MCIERR_UNSUPPORTED_FUNCTION = 0x112;
const MCIERR_BAD_CONSTANT = 0x11a;
const MCIERR_FLAGS_NOT_COMPATIBLE = 0x11c;

/** `TRUE` and `FALSE` as a capability answers them: the value and its string. */
const YES = 0x02140001;
const NO = 0x02130000;
const RESOURCE_RETURNED = 0x10000;

/** Posts `MM_MCINOTIFY` for a command that succeeded, as `mciDriverNotify` does. */
function notify(system: any, id: number, flags: number, parms: number) {
  if (!(flags & MCI_NOTIFY) || !parms) {
    return;
  }

  const hwnd = system.machine.cpu.core.read16(parms >>> 16, parms & 0xffff);

  if (hwnd) {
    PostMessage.call(system, hwnd, MM_MCINOTIFY, MCI_NOTIFY_SUCCESSFUL, id);
  }
}

/** A file a driver has open, by its device's ID: its length, in its own time format. */
interface Opened {
  length: number;
  format: number;
}

function openedOf(system: any): Map<number, Opened> {
  return (system._mciOpened ??= new Map());
}

/** A waveform file's length in milliseconds: its data's bytes over its bytes a second, to the nearest. */
function waveLength(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let perSecond = 0;
  let data = 0;

  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    return 0;
  }

  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);

    if (tag(at) === 'fmt ' && at + 16 <= bytes.length) {
      perSecond = view.getUint32(at + 16, true);
    } else if (tag(at) === 'data') {
      data = size;
    }

    at += 8 + size + (size & 1);
  }

  return perSecond ? Math.round((data * 1000) / perSecond) : 0;
}

/** A MIDI file's length in sixteenths: its longest track's ticks, over a quarter's. */
function midiLength(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

  if (bytes.length < 14 || tag(0) !== 'MThd') {
    return 0;
  }

  const division = view.getInt16(12);
  let longest = 0;

  for (let at = 8 + view.getUint32(4); at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4);

    if (tag(at) === 'MTrk') {
      longest = Math.max(
        longest,
        trackTicks(bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size)))
      );
    }

    at += 8 + size;
  }

  return division > 0 ? Math.round((longest * 4) / division) : 0;
}

/** The ticks a track's events take, to its end. */
function trackTicks(track: Uint8Array) {
  let ticks = 0;
  let status = 0;
  let at = 0;
  const number = () => {
    let value = 0;

    for (let i = 0; i < 4 && at < track.length; i++) {
      const byte = track[at++];

      value = (value << 7) | (byte & 0x7f);

      if (!(byte & 0x80)) {
        break;
      }
    }

    return value;
  };

  while (at < track.length) {
    ticks += number();

    if (at >= track.length) {
      break;
    }

    if (track[at] & 0x80) {
      status = track[at++];
    }

    if (status === 0xff) {
      const type = track[at++];
      const size = number();

      at += size;

      if (type === 0x2f) {
        break;
      }
    } else if (status === 0xf0 || status === 0xf7) {
      at += number();
    } else {
      at += (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
    }
  }

  return ticks;
}

/**
 * Opens the file an `MCI_OPEN_PARMS` names for a device: its length kept by
 * the device's ID. Nought, or 113h for a file that is not there.
 */
async function openFile(system: any, kind: 'wave' | 'seq', id: number, parms: number) {
  const core = system.machine.cpu.core;
  const far =
    core.read16(parms >>> 16, ((parms & 0xffff) + 12) & 0xffff) |
    (core.read16(parms >>> 16, ((parms & 0xffff) + 14) & 0xffff) << 16);
  let name = '';

  for (let at = far & 0xffff; far >>> 16; at = (at + 1) & 0xffff) {
    const byte = core.read8(far >>> 16, at);

    if (!byte) {
      break;
    }

    name += String.fromCharCode(byte);
  }

  const handle = name ? await system.dos.files.open(name) : 0;

  if (!handle) {
    return MCIERR_FILE_NOT_FOUND;
  }

  try {
    const file = system.dos.files.resolve(handle);
    const bytes = file?.size ? new Uint8Array(await file.read(0, file.size)) : new Uint8Array(0);

    openedOf(system).set(id, {
      length: kind === 'wave' ? waveLength(bytes) : midiLength(bytes),
      format: kind === 'wave' ? MCI_FORMAT_MILLISECONDS : MCI_SEQ_FORMAT_SONGPTR,
    });
  } finally {
    system.dos.files.close(handle);
  }

  return 0;
}

/**
 * The commands a device with a file open answers: its status, playing, which
 * there is nothing to play on, and stopping. Null for any other.
 */
function fileCommand(
  system: any,
  kind: 'wave' | 'seq',
  id: number,
  message: number,
  flags: number,
  parms: number
): number | null {
  const opened = openedOf(system).get(id);
  const core = system.machine.cpu.core;

  if (!opened) {
    return null;
  }

  switch (message) {
    case 0x806: // MCI_PLAY
      return kind === 'wave' ? MCIERR_WAVE_OUTPUTSUNSUITABLE : MCIERR_SEQ_NOMIDIPRESENT;

    case 0x808: // MCI_STOP
      notify(system, id, flags, parms);
      return 0;

    case 0x814: {
      // MCI_STATUS
      const item =
        core.read16(parms >>> 16, ((parms & 0xffff) + 8) & 0xffff) |
        (core.read16(parms >>> 16, ((parms & 0xffff) + 10) & 0xffff) << 16);
      const answers: Record<number, number> = {
        [MCI_STATUS_LENGTH]: opened.length,
        [MCI_STATUS_MODE]: MCI_MODE_STOP,
        [MCI_STATUS_TIME_FORMAT]: opened.format,
      };

      if (!(flags & MCI_STATUS_ITEM) || answers[item] === undefined) {
        return null;
      }

      core.write16(parms >>> 16, ((parms & 0xffff) + 4) & 0xffff, answers[item] & 0xffff);
      core.write16(parms >>> 16, ((parms & 0xffff) + 6) & 0xffff, answers[item] >>> 16);
      notify(system, id, flags, parms);
      return 0;
    }

    default:
      return null;
  }
}

/** A driver's answer to USER's messages; MCI's own, 800h to 17FFh, to `mci`. */
async function driverProc(
  system: any,
  kind: 'wave' | 'seq',
  args: [number, number, number, number, number],
  mci: (id: number, message: number, flags: number, parms: number) => Promise<number>
) {
  const [id, hDriver, message, lParam1, lParam2] = args;
  const core = system.machine.cpu.core;

  switch (message) {
    case 1: // DRV_LOAD
      if (kind === 'wave') {
        system._mciWave = { out: waveOutGetNumDevs(), in: waveInGetNumDevs() };
      }
      return 1;

    case 3: {
      // DRV_OPEN, with MCI_OPEN_DRIVER_PARMS
      if (!lParam2) {
        return 10000;
      }

      const segment = lParam2 >>> 16;
      const offset = lParam2 & 0xffff;

      core.write16(segment, (offset + 6) & 0xffff, kind === 'wave' ? 0 : 0xffff);
      core.write16(segment, (offset + 8) & 0xffff, kind === 'wave' ? 0x20a : 0x20b);

      return core.read16(segment, offset);
    }

    case 4: // DRV_CLOSE
    case 6: // DRV_FREE
    case 9: // DRV_INSTALL
    case 10: // DRV_REMOVE
      return 1;

    case 7: // DRV_CONFIGURE
    case 8: // DRV_QUERYCONFIGURE
      return kind === 'wave' && message === 8 ? 1 : 0;

    default:
      if (!(id >>> 16) && message >= 0x800 && message <= 0x17ff) {
        return mci(id & 0xffff, message, lParam1 >>> 0, lParam2 >>> 0);
      }

      return DefDriverProc.call(system, id, hDriver, message, lParam1, lParam2);
  }
}

/** Copies a driver's string into a caller's buffer, as `LoadString` does: at most the size less one, and a null. */
function copyString(system: any, text: string, far: number, size: number) {
  const core = system.machine.cpu.core;
  const count = Math.min(text.length, Math.max(0, size - 1));

  for (let i = 0; i < count; i++) {
    core.write8(far >>> 16, ((far & 0xffff) + i) & 0xffff, text.charCodeAt(i) & 0xff);
  }

  if (size > 0) {
    core.write8(far >>> 16, ((far & 0xffff) + count) & 0xffff, 0);
  }

  return count;
}

const WAVE_PATH = 'C:\\WINDOWS\\SYSTEM\\MCIWAVE.DRV';
const SEQ_PATH = 'C:\\WINDOWS\\SYSTEM\\MCISEQ.DRV';

/** The product each gives `MCI_INFO`, as recorded. */
const WAVE_PRODUCT = 'Sound';
const SEQ_PRODUCT = 'MIDI Sequencer';

/** MCIWAVE's commands (seg2 `1f08`). */
async function waveCommand(system: any, id: number, message: number, flags: number, parms: number) {
  const core = system.machine.cpu.core;
  const segment = parms >>> 16;
  const offset = parms & 0xffff;
  let result: number;
  const answered = fileCommand(system, 'wave', id, message, flags, parms);

  if (answered !== null) {
    return answered;
  }

  /* With no file open, these have nothing to act on. */
  if (
    [
      0x806, 0x807, 0x808, 0x809, 0x80d, 0x80f, 0x813, 0x814, 0x830, 0x852, 0x853, 0x855, 0x856,
    ].includes(message)
  ) {
    return MCIERR_UNSUPPORTED_FUNCTION;
  }

  switch (message) {
    case 0x801: // MCI_OPEN_DRIVER
      if (flags & MCI_WAVE_OPEN_BUFFER) {
        const seconds = core.read16(segment, (offset + 0x14) & 0xffff);

        if (seconds < 2 || seconds > 9) {
          return MCIERR_BAD_CONSTANT;
        }
      }

      if (!(flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID))) {
        result = 0;
        break;
      }

      if (flags & MCI_OPEN_SHAREABLE) {
        return MCIERR_UNSUPPORTED_FUNCTION;
      }

      if (
        (flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID)) ===
        (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID)
      ) {
        return MCIERR_FLAGS_NOT_COMPATIBLE;
      }

      result = await openFile(system, 'wave', id, parms);

      if (result) {
        return result;
      }

      break;

    case 0x802: // MCI_CLOSE_DRIVER
      openedOf(system).delete(id);
      result = 0;
      break;

    case 0x80a: {
      // MCI_INFO
      const far =
        core.read16(segment, (offset + 4) & 0xffff) |
        (core.read16(segment, (offset + 6) & 0xffff) << 16);
      const size = core.read16(segment, (offset + 8) & 0xffff);
      const asked = flags & ~(MCI_NOTIFY | MCI_WAIT);

      if (!far || !size) {
        return MCIERR_PARAM_OVERFLOW;
      }

      if (!asked) {
        return MCIERR_MISSING_PARAMETER;
      }

      if (asked & ~(0x100 | 0x200 | 0x400000 | 0x800000)) {
        return MCIERR_HARDWARE;
      }

      if (asked !== MCI_INFO_PRODUCT) {
        return asked === MCI_INFO_FILE || asked === 0x400000 || asked === 0x800000
          ? MCIERR_UNSUPPORTED_FUNCTION
          : MCIERR_FLAGS_NOT_COMPATIBLE;
      }

      const length = copyString(system, WAVE_PRODUCT, far >>> 0, size);

      core.write16(segment, (offset + 8) & 0xffff, length);
      core.write16(segment, (offset + 10) & 0xffff, 0);
      result = 0;
      break;
    }

    case 0x80b: {
      // MCI_GETDEVCAPS
      const asked = flags & ~(MCI_NOTIFY | MCI_WAIT);
      const item =
        core.read16(segment, (offset + 8) & 0xffff) |
        (core.read16(segment, (offset + 10) & 0xffff) << 16);
      const counts = system._mciWave ?? { out: 0, in: 0 };

      if (!asked || !item) {
        return MCIERR_MISSING_PARAMETER;
      }

      if (asked !== MCI_GETDEVCAPS_ITEM || item & ~0x400f) {
        return MCIERR_HARDWARE;
      }

      const answers: Record<number, [number, number]> = {
        1: [counts.in ? YES : NO, RESOURCE_RETURNED],
        2: [YES, RESOURCE_RETURNED],
        3: [NO, RESOURCE_RETURNED],
        4: [0x020a020a, RESOURCE_RETURNED],
        5: [YES, RESOURCE_RETURNED],
        6: [YES, RESOURCE_RETURNED],
        7: [NO, RESOURCE_RETURNED],
        8: [counts.out ? YES : NO, RESOURCE_RETURNED],
        9: [YES, RESOURCE_RETURNED],
        0x4001: [counts.in, 0],
        0x4002: [counts.out, 0],
      };
      const answer = answers[item];

      if (!answer) {
        return MCIERR_UNSUPPORTED_FUNCTION;
      }

      core.write16(segment, (offset + 4) & 0xffff, answer[0] & 0xffff);
      core.write16(segment, (offset + 6) & 0xffff, answer[0] >>> 16);
      result = answer[1];
      break;
    }

    case 0x850:
      return MCIERR_UNSUPPORTED_FUNCTION;

    default:
      return MCIERR_UNRECOGNIZED_COMMAND;
  }

  if (!(result & 0xffff)) {
    notify(system, id, flags, parms);
  }

  return result;
}

/** MCISEQ's commands (seg2 `0`). */
async function seqCommand(system: any, id: number, message: number, flags: number, parms: number) {
  const core = system.machine.cpu.core;
  const segment = parms >>> 16;
  const offset = parms & 0xffff;
  let result: number;
  const answered = fileCommand(system, 'seq', id, message, flags, parms);

  if (answered !== null) {
    return answered;
  }

  if (![0x801, 0x802, 0x80a, 0x80b].includes(message)) {
    return [0x806, 0x807, 0x808, 0x809, 0x80d, 0x814, 0x80e, 0x80f, 0x812, 0x813, 0x830].includes(
      message
    ) ||
      (message >= 0x840 && message <= 0x845) ||
      (message >= 0x850 && message <= 0x856)
      ? MCIERR_UNSUPPORTED_FUNCTION
      : MCIERR_UNRECOGNIZED_COMMAND;
  }

  switch (message) {
    case 0x801: // MCI_OPEN_DRIVER
      if (
        (flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID)) ===
        (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID)
      ) {
        return MCIERR_FLAGS_NOT_COMPATIBLE;
      }

      if (!(flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID))) {
        result = 0;
        break;
      }

      if (flags & MCI_OPEN_SHAREABLE) {
        return MCIERR_UNSUPPORTED_FUNCTION;
      }

      result = await openFile(system, 'seq', id, parms);

      if (result) {
        return result;
      }

      break;

    case 0x802: // MCI_CLOSE_DRIVER
      openedOf(system).delete(id);
      result = 0;
      break;

    case 0x80a: {
      // MCI_INFO
      const far =
        core.read16(segment, (offset + 4) & 0xffff) |
        (core.read16(segment, (offset + 6) & 0xffff) << 16);
      const size = core.read16(segment, (offset + 8) & 0xffff);
      const asked = flags & ~(MCI_NOTIFY | MCI_WAIT);

      if (!far) {
        return MCIERR_PARAM_OVERFLOW;
      }

      if (asked & ~(MCI_INFO_PRODUCT | MCI_INFO_FILE)) {
        return MCIERR_HARDWARE;
      }

      if (asked === MCI_INFO_FILE) {
        return MCIERR_UNSUPPORTED_FUNCTION;
      }

      if (asked !== MCI_INFO_PRODUCT) {
        return MCIERR_MISSING_PARAMETER;
      }

      copyString(system, SEQ_PRODUCT, far >>> 0, size);
      result = 0;
      break;
    }

    default: {
      // MCI_GETDEVCAPS
      const item =
        core.read16(segment, (offset + 8) & 0xffff) |
        (core.read16(segment, (offset + 10) & 0xffff) << 16);

      if (!(flags & MCI_GETDEVCAPS_ITEM) || item < 1 || item > 9) {
        return MCIERR_MISSING_PARAMETER;
      }

      const midi = midiOutGetNumDevs() !== 0 ? YES : NO;
      const answer = [NO, midi, NO, 0x020b020b, midi, midi, NO, midi, NO][item - 1];

      core.write16(segment, (offset + 4) & 0xffff, answer & 0xffff);
      core.write16(segment, (offset + 6) & 0xffff, answer >>> 16);
      result = RESOURCE_RETURNED;
      break;
    }
  }

  if (!(result & 0xffff)) {
    notify(system, id, flags, parms);
  }

  return result;
}

/** `MCIWAVE.DRV`, the waveform audio device. */
export class MciWave extends Module {
  static get name(): string {
    return 'MCIWAVE';
  }

  static get path() {
    return WAVE_PATH;
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [() => 1, 'WEP', 2, [UINT], UINT];
    exports[2] = [
      function (this: any, ...args: [number, number, number, number, number]) {
        return driverProc(this, 'wave', args, (id, message, flags, parms) =>
          waveCommand(this, id, message, flags, parms)
        );
      },
      'DriverProc',
      16,
      [DWORD, UINT, UINT, LPARAM, LPARAM],
      LRESULT,
    ];

    return exports;
  }
}

/** `MCISEQ.DRV`, the MIDI sequencer. */
export class MciSeq extends Module {
  static get name(): string {
    return 'MCISEQ';
  }

  static get path() {
    return SEQ_PATH;
  }

  static get exports() {
    const exports: any[] = [];

    exports[1] = [() => 1, 'WEP', 2, [UINT], UINT];
    exports[2] = [
      function (this: any, ...args: [number, number, number, number, number]) {
        return driverProc(this, 'seq', args, (id, message, flags, parms) =>
          seqCommand(this, id, message, flags, parms)
        );
      },
      'DriverProc',
      16,
      [DWORD, UINT, UINT, LPARAM, LPARAM],
      LRESULT,
    ];

    return exports;
  }
}
