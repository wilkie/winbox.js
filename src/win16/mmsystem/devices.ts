'use strict';

import { copyText } from '../user/control-classes.js';

/**
 * The multimedia devices of an installation with no sound driver, which is
 * what the Windows here is: its `SYSTEM.INI` names only the timer and the
 * MIDI mapper. **Recorded** by the `mmdevs` probe:
 *
 * * There are no waveform, MIDI or auxiliary devices: each count is 0.
 * * Opening a waveform device, for output or input, by number or through the
 *   mapper, to query a format or for real, answers `MMSYSERR_BADDEVICEID`
 *   (2), and a handle asked for is written as 0.
 * * Asking a device's capabilities answers 2 as well.
 * * The error texts are `MMSYSTEM.DLL`'s own strings, numbered as the errors
 *   are, read from the file on the disk; asking answers 0.
 *
 * Sound Recorder took an answer of 0 -- a device opened -- at its word, and
 * copied a recording of minus two bytes over its own stack.
 */

const MMSYSERR_BADDEVICEID = 2;
const MMSYSERR_BADERRNUM = 9;

export function waveOutGetNumDevs() {
  return 0;
}

export function waveInGetNumDevs() {
  return 0;
}

export function midiInGetNumDevs() {
  return 0;
}

export function auxGetNumDevs() {
  return 0;
}

/** `waveOutOpen` and `waveInOpen`: no device, and no handle. */
export function waveOpen(this: any, lphWave: number) {
  const far = lphWave >>> 0;

  if (far) {
    const core = this.machine.cpu.core;

    core.write8(far >>> 16, far & 0xffff, 0);
    core.write8(far >>> 16, (far + 1) & 0xffff, 0);
  }

  return MMSYSERR_BADDEVICEID;
}

/** `waveOutGetDevCaps` and `waveInGetDevCaps`: no device. */
export function waveGetDevCaps() {
  return MMSYSERR_BADDEVICEID;
}

/** An error's text, from `MMSYSTEM.DLL`'s string table: the general errors, 0 to 11, and the waveform ones, 32 to 35. */
export async function waveGetErrorText(this: any, error: number, far: number, size: number) {
  error &= 0xffff;

  if (!((error >= 0 && error <= 11) || (error >= 32 && error <= 35))) {
    return MMSYSERR_BADERRNUM;
  }

  const text = await mmsystemString(this, error);

  if (text === null) {
    return MMSYSERR_BADERRNUM;
  }

  copyText(this, text, far >>> 0, size & 0xffff);

  return 0;
}

/** A string of `MMSYSTEM.DLL`'s string table, read from the file. */
export function mmsystemString(system: any, id: number) {
  return moduleString(system, 'C:\\WINDOWS\\SYSTEM\\MMSYSTEM.DLL', id);
}

/** A string of a module's string table, read from its file; null when there is none. */
export async function moduleString(system: any, path: string, id: number): Promise<string | null> {
  const files = system.dos?.files;
  const handle = files ? await files.open(path) : null;
  const file = handle ? files.resolve(handle) : null;

  if (!file) {
    return null;
  }

  const read = async (offset: number, length: number) => new Uint8Array(await file.read(offset, length));
  const word = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);

  try {
    const mz = await read(0, 0x40);
    const ne = word(mz, 0x3c) | (word(mz, 0x3e) << 16);
    const header = await read(ne, 0x40);
    const table = ne + word(header, 0x24);
    const resources = await read(table, word(header, 0x26) - word(header, 0x24));
    const shift = word(resources, 0);
    const block = (id >> 4) + 1;

    for (let at = 2; word(resources, at); ) {
      const type = word(resources, at);
      const count = word(resources, at + 2);

      at += 8;

      for (let index = 0; index < count; index++, at += 12) {
        if (type === 0x8006 && (word(resources, at + 6) & 0x7fff) === block) {
          const data = await read(word(resources, at) << shift, word(resources, at + 2) << shift);
          let offset = 0;

          for (let skip = 0; skip < (id & 15); skip++) {
            offset += 1 + data[offset];
          }

          return String.fromCharCode(...data.subarray(offset + 1, offset + 1 + data[offset]));
        }
      }
    }
  } catch {
    // Not a file this can read.
  }

  return null;
}
