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
 *   no device to play on; stopping, seeking and closing answer nought. The
 *   position is nought, and the sequencer is not ready.
 * * The sequencer set to milliseconds gives its length in them, at the
 *   file's tempo: a quarter at 120 a minute is 500.
 *
 * And a MIDI file's length as the sequencer counts it, **read out** of
 * `MCISEQ.DRV` and **recorded** by `seqlen` on the installation with a sound
 * card (`midiLengths`): to its last event before the end of its longest
 * track, the end's own delta not counted, in song pointers the fraction
 * dropped, and in the SMPTE formats as hours, minutes, seconds and frames.
 *
 * Not followed: a file that is not waveform or MIDI inside, which was not
 * recorded; the configuration dialog; the drivers' command tables, which
 * only `mciSendString` reads.
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
const MCI_STATUS_POSITION = 2;
const MCI_STATUS_READY = 7;
const MCI_SET_TIME_FORMAT = 0x400;
const MCI_MODE_STOP = 0x20d;
const MCI_FORMAT_MILLISECONDS = 0;
const MCI_FORMAT_SMPTE_24 = 4;
const MCI_FORMAT_SMPTE_25 = 5;
const MCI_FORMAT_SMPTE_30 = 6;
const MCI_FORMAT_SMPTE_30DROP = 7;
const SMPTE_FORMATS = [
  MCI_FORMAT_SMPTE_24,
  MCI_FORMAT_SMPTE_25,
  MCI_FORMAT_SMPTE_30,
  MCI_FORMAT_SMPTE_30DROP,
];
const MCI_SEQ_FORMAT_SONGPTR = 0x4001;

/**
 * What the sequencer gives back a status in an SMPTE format as (seg2
 * `1cac`-`1cb1`): hours, minutes, seconds and frames, which
 * `mciSendString` shows as hh:mm:ss:ff.
 */
export const MCI_COLONIZED4_RETURN = 0x40000;
const MM_MCINOTIFY = 0x3b9;
const MCI_NOTIFY_SUCCESSFUL = 1;

const MCIERR_UNRECOGNIZED_COMMAND = 0x105;
const MCIERR_HARDWARE = 0x103;
const MCIERR_FILE_NOT_FOUND = 0x113;
const MCIERR_BAD_TIME_FORMAT = 0x125;
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

/** A file a driver has open, by its device's ID: its length in each time format it has, and the format it is in. */
interface Opened {
  lengths: Record<number, number>;
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

/**
 * `MCISEQ`'s `MulDiv` (seg3 `3a`): `a` times `b` over `c`, each taken as
 * signed, half of `c` added before the division so it rounds to the
 * nearest; the most a long holds, of the sign, where the quotient overflows
 * or `c` is nought. As the Rust engine's `sequencer.rs` has it.
 */
function mulDiv(a: number, b: number, c: number) {
  const [x, y, z] = [BigInt(a | 0), BigInt(b | 0), BigInt(c | 0)];
  const negative = (x < 0n !== y < 0n) !== z < 0n;
  const abs = (value: bigint) => (value < 0n ? -value : value);
  const [p, q, r] = [abs(x), abs(y), abs(z)];
  const product = p * q + r / 2n;

  if (r === 0n || product >> 32n >= r || product / r > 0x7fffffffn) {
    return negative ? 0x80000000 : 0x7fffffff;
  }

  const quotient = Number(product / r);

  return negative ? -quotient >>> 0 : quotient;
}

/** An SMPTE format's frames a second (seg2 `e6a`): 24, 25, or 30 for both of 30's -- none is dropped. */
function framesASecond(format: number) {
  return format === MCI_FORMAT_SMPTE_24 ? 24 : format === MCI_FORMAT_SMPTE_25 ? 25 : 30;
}

/**
 * Milliseconds in an SMPTE format (seg2 `f86`): the frames they make, the
 * fraction dropped, as hours, minutes, seconds and frames, a byte each from
 * the lowest. **Recorded** by `seqlen`: 495 milliseconds are frame 11 at 24
 * a second, 12 at 25, 14 at 30.
 */
function smpte(format: number, ms: number) {
  const rate = framesASecond(format);
  const frames = Math.floor((Math.imul(ms, rate) >>> 0) / 1000);
  const hour = rate * 3600;
  const minute = rate * 60;

  return (
    ((Math.floor(frames / hour) & 0xff) |
      ((Math.floor((frames % hour) / minute) & 0xff) << 8) |
      ((Math.floor((frames % minute) / rate) & 0xff) << 16) |
      (((frames % rate) & 0xff) << 24)) >>>
    0
  );
}

/** A MIDI file as the sequencer measures it (`midiSong`). */
interface Song {
  /** Ticks a quarter. */
  division: number;
  /** Its first track's tempos: from a tick on, microseconds a quarter. */
  tempos: [number, number][];
  /** Its length, as a tick. */
  length: number;
}

/**
 * A MIDI file as `MCISEQ` measures it as it opens it, reading every track
 * through (seg3 `19a2`-`1b78`, `24f3`-`24fb`): its ticks a quarter, its
 * first track's tempos, and its length as a tick. **Read out** of
 * `MCISEQ.DRV`, as the Rust engine's `Song` (`sequencer.rs`) has it: each
 * event's delta is counted once the event is read, but the end of a track's
 * is not (seg3 `17e6`, `1aba`-`1ad6`), and the length is the most any track
 * reached (seg3 `1afc`-`1b1c`). Null where the file is not MIDI.
 */
function midiSong(bytes: Uint8Array): Song | null {
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'MThd') {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const song: Song = { division: view.getUint16(12), tempos: [], length: 0 };
  let first = true;

  for (let at = 8 + view.getUint32(4); at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4);

    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === 'MTrk') {
      midiTrack(song, bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + size)), first);
      first = false;
    }

    at += 8 + size;
  }

  /* Stable, as Rust's `sort_by_key` is. */
  song.tempos.sort((a, b) => a[0] - b[0]);

  return song;
}

/**
 * A track read to its end, and the length it gives: the tick of its last
 * event before its end, the end's own delta not counted; a track that stops
 * without its end, as far as it got. A byte past the track's end reads as
 * nought, and a data byte with no status before it ends the track.
 */
function midiTrack(song: Song, track: Uint8Array, first: boolean) {
  let tick = 0;
  let status = 0;
  let at = 0;
  const byte = (at: number) => (at < track.length ? track[at] : 0);
  const number = () => {
    let value = 0;

    for (let i = 0; i < 4; i++) {
      const each = byte(at++);

      value = ((value << 7) | (each & 0x7f)) >>> 0;

      if (!(each & 0x80)) {
        break;
      }
    }

    return value;
  };

  while (at < track.length) {
    const delta = number();

    tick = (tick + delta) >>> 0;

    if (at >= track.length) {
      break;
    }

    if (byte(at) & 0x80) {
      status = byte(at++);
    }

    if (status === 0xff) {
      const kind = byte(at++);
      const size = number();
      const data = track.subarray(at, Math.min(track.length, at + size));

      if (kind === 0x51 && first && data.length === 3) {
        song.tempos.push([tick, (data[0] << 16) | (data[1] << 8) | data[2]]);
      }

      at += size;

      if (kind === 0x2f) {
        song.length = Math.max(song.length, (tick - delta) >>> 0);
        return;
      }
    } else if (status === 0xf0 || status === 0xf7) {
      at += number();
    } else if (status >= 0x80) {
      at += (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
    } else {
      break;
    }
  }

  song.length = Math.max(song.length, tick);
}

/**
 * Milliseconds from the start to a tick (sequencer message 0Fh, seg3 `79a`),
 * by the file's tempo map as `MCISEQ` keeps it (seg3 `81a`-`8de`): the first
 * part at nought, at 120 a quarter a minute -- 60,000,000 over 120 times the
 * ticks a quarter, the fraction dropped (seg3 `b46`-`b94`); then one for
 * each tempo of the first track, its microseconds a quarter over the ticks a
 * quarter, the fraction dropped (seg3 `180d`-`181e`), starting at the
 * millisecond the part before reaches it, the fraction dropped too (seg3
 * `8ac`-`8d9`). The tick is in the last part starting at or before it, and
 * the ticks past that start go at its microseconds a tick, to the nearest
 * millisecond.
 */
function midiMs(song: Song, tick: number) {
  const division = Math.max(song.division, 1);
  const map: [number, number, number][] = [[0, 0, Math.floor(60000000 / (120 * division))]];

  for (const [at, tempo] of song.tempos) {
    const [ms, from, micro] = map[map.length - 1];

    map.push([
      (ms + Math.floor((Math.imul((at - from) >>> 0, micro) >>> 0) / 1000)) >>> 0,
      at,
      Math.floor(tempo / division),
    ]);
  }

  let part = map[0];

  for (const each of map) {
    if (each[1] > tick) {
      break;
    }

    part = each;
  }

  return (part[0] + mulDiv((tick - part[1]) >>> 0, part[2], 1000)) >>> 0;
}

/**
 * A MIDI file's length in each time format the sequencer takes
 * (`MCI_STATUS_LENGTH`, seg2 `1c6e`-`1c98`; the tick in a format, seg2
 * `1204`): in milliseconds by the tempo map (`midiMs`); in an SMPTE format,
 * those milliseconds as frames (`smpte`); in song pointers, sixteenths, the
 * tick times four over the ticks a quarter, the fraction dropped.
 * **Recorded** by `seqlen`: a note of 96 ticks at 96 a quarter is 4
 * sixteenths and 500 milliseconds whether its track ends 96 ticks after it
 * or with it; one of 95 ticks, its track ending a tick after, is 3 and 495.
 * Nought, in song pointers and milliseconds alone, for a file that is not
 * MIDI or is timed in SMPTE frames, which were not recorded.
 */
export function midiLengths(bytes: Uint8Array): Record<number, number> {
  const song = midiSong(bytes);

  if (!song || !song.division || song.division & 0x8000) {
    return { [MCI_SEQ_FORMAT_SONGPTR]: 0, [MCI_FORMAT_MILLISECONDS]: 0 };
  }

  const ms = midiMs(song, song.length);
  const lengths: Record<number, number> = {
    [MCI_SEQ_FORMAT_SONGPTR]: Math.floor(((song.length << 2) >>> 0) / song.division),
    [MCI_FORMAT_MILLISECONDS]: ms,
  };

  for (const format of SMPTE_FORMATS) {
    lengths[format] = smpte(format, ms);
  }

  return lengths;
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
      lengths:
        kind === 'wave' ? { [MCI_FORMAT_MILLISECONDS]: waveLength(bytes) } : midiLengths(bytes),
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

    case 0x807: // MCI_SEEK
    case 0x808: // MCI_STOP
      notify(system, id, flags, parms);
      return 0;

    case 0x80d: {
      // MCI_SET
      if (!(flags & MCI_SET_TIME_FORMAT)) {
        return null;
      }

      const format =
        (core.read16(parms >>> 16, ((parms & 0xffff) + 4) & 0xffff) |
          (core.read16(parms >>> 16, ((parms & 0xffff) + 6) & 0xffff) << 16)) >>>
        0;

      /* Only the formats the device measures a length in. */
      if (opened.lengths[format] === undefined) {
        return MCIERR_BAD_TIME_FORMAT;
      }

      opened.format = format;
      notify(system, id, flags, parms);
      return 0;
    }

    case 0x814: {
      // MCI_STATUS
      const item =
        core.read16(parms >>> 16, ((parms & 0xffff) + 8) & 0xffff) |
        (core.read16(parms >>> 16, ((parms & 0xffff) + 10) & 0xffff) << 16);
      const answers: Record<number, number> = {
        [MCI_STATUS_LENGTH]: opened.lengths[opened.format] ?? 0,
        [MCI_STATUS_POSITION]: 0,
        [MCI_STATUS_MODE]: MCI_MODE_STOP,
        [MCI_STATUS_TIME_FORMAT]: opened.format,
        [MCI_STATUS_READY]: 0,
      };

      if (!(flags & MCI_STATUS_ITEM) || answers[item] === undefined) {
        return null;
      }

      core.write16(parms >>> 16, ((parms & 0xffff) + 4) & 0xffff, answers[item] & 0xffff);
      core.write16(parms >>> 16, ((parms & 0xffff) + 6) & 0xffff, answers[item] >>> 16);
      notify(system, id, flags, parms);

      /* A time in an SMPTE format, hours, minutes, seconds and frames
       * (`MCISEQ.DRV` seg2 `1cac`-`1cb1`). */
      return kind === 'seq' &&
        SMPTE_FORMATS.includes(opened.format) &&
        (item === MCI_STATUS_LENGTH || item === MCI_STATUS_POSITION)
        ? MCI_COLONIZED4_RETURN
        : 0;
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
