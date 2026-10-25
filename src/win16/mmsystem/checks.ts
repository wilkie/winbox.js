'use strict';

import { IsBadHugeReadPtr, IsBadHugeWritePtr, IsBadWritePtr } from '../kernel/bad-pointers.js';
import { IsWindow } from '../user/window-queries.js';
import { MMSYSTEM_STRINGS } from './strings.js';
import {
  MMSYSERR_BADERRNUM,
  MMSYSERR_INVALPARAM,
  MMSYSERR_NOERROR,
  readDword,
  writeBytes,
} from './devices.js';

/**
 * What MMSYSTEM checks of a call's arguments before any driver hears of it,
 * and the error texts it gives itself. The twin of `mmsystem/checks.rs`.
 *
 * **Read out** of `MMSYSTEM.DLL` (seg4 `353`-`548`, seg3 `95a`, seg6 `21e`).
 * Each failing check is logged with KERNEL's `LogParamError`, which the
 * retail KERNEL passes on only to a debugger and the tool helper's
 * notification: WinBox has neither, and does not log.
 */

/** A header's flags: done, prepared, queued. */
export const DONE = 0x01;
export const PREPARED = 0x02;
export const WAVE_INQUEUE = 0x10;
export const MIDI_INQUEUE = 0x04;

/** Where a header keeps its flags. */
const FLAGS_AT = 0x10;

/** Whether a block can be written: `IsBadHugeWritePtr` as MMSYSTEM asks it (seg4 `442`). */
export function writable(system: any, far: number, size: number) {
  return !IsBadHugeWritePtr.call(system, far >>> 0, size >>> 0);
}

/** Whether a block can be read: `IsBadHugeReadPtr` (seg4 `40d`). */
export function readable(system: any, far: number, size: number) {
  return !IsBadHugeReadPtr.call(system, far >>> 0, size >>> 0);
}

/** A far pointer and some bytes more, within its segment. */
function step(far: number, bytes: number) {
  return ((far & 0xffff0000) | ((far + bytes) & 0xffff)) >>> 0;
}

export function headerFlags(system: any, header: number) {
  return readDword(system, step(header, FLAGS_AT));
}

export function setHeaderFlags(system: any, header: number, flags: number) {
  writeBytes(system, step(header, FLAGS_AT), [
    flags & 0xff,
    (flags >>> 8) & 0xff,
    (flags >>> 16) & 0xff,
    (flags >>> 24) & 0xff,
  ]);
}

/**
 * Whether a header is one MMSYSTEM takes (seg4 `353`): writable for its
 * size; its size a waveform header's, 20h, for a waveform handle, a MIDI
 * header's, 1Ch, for a MIDI one; no flag in the low word of its flags but
 * those its kind has; and its data writable for its length.
 */
export function headerOk(system: any, header: number, size: number, handleType: number) {
  if (IsBadWritePtr.call(system, header >>> 0, size & 0xffff)) {
    return false;
  }

  const [expected, mask] = handleType <= 2 ? [0x20, 0xffe0] : [0x1c, 0xfff8];

  if ((size & 0xffff) !== expected || headerFlags(system, header) & mask & 0xffff) {
    return false;
  }

  return writable(system, readDword(system, header), readDword(system, step(header, 4)));
}

/**
 * Whether a callback is one MMSYSTEM takes (seg4 `477`), by the kind the
 * high word of the open's flags gives: none; a window, by a handle of one;
 * a task, by a handle of one; a function, in a code segment of a module's
 * that is neither moveable nor discardable, as `GetCodeInfo` reads its
 * flags. Another kind is refused.
 */
export function callbackOk(system: any, callback: number, kind: number) {
  const low = callback & 0xffff;

  switch (kind & 7) {
    case 0:
      return true;

    case 1:
      return callback >>> 16 === 0 && !!IsWindow.call(system, low);

    case 2:
      return callback >>> 16 === 0 && isTask(system, low);

    case 3: {
      const flags = codeFlags(system, (callback >>> 16) & 0xffff);

      return flags !== null && (flags & 0x1011) === 0;
    }

    default:
      return false;
  }
}

/** Whether a handle is a task's. */
export function isTask(system: any, handle: number) {
  return !!handle && !!system.scheduler?._tasks?.[handle];
}

/**
 * A code segment's flags, as `GetCodeInfo` gives them: its module's segment
 * table's as KERNEL keeps it, every segment of a program's -- a module not a
 * library, its flags' 8000h clear -- made moveable as the table is read
 * (`KRNL386.EXE` seg2 `0f4b`-`0f6b`; `mmnodev`: 4556h for a program's fixed
 * code). Null for a selector no module's segment is.
 */
function codeFlags(system: any, selector: number): number | null {
  const index = selector >> 3;
  const loaders = new Set<any>();

  for (const task of Object.values(system.scheduler?._tasks ?? {}) as any[]) {
    if (task?.loader) {
      loaders.add(task.loader);
    }
  }

  for (const entry of Object.values(system.handles?._handles ?? {}) as any[]) {
    if (entry?.instance?.loader) {
      loaders.add(entry.instance.loader);
    }
  }

  for (const loader of loaders) {
    for (const [number, mapped] of Object.entries(loader._segmentMap ?? {})) {
      if (mapped === index) {
        const flags = loader.segments[Number(number) - 1]?.flags;
        const program = !((loader.header?.flags ?? 0) & 0x8000);

        return flags === undefined ? null : flags | (program ? 0x10 : 0);
      }
    }
  }

  return null;
}

/**
 * An error's text, as `waveOutGetErrorText` and `midiOutGetErrorText` give
 * it (seg3 `95a`, seg6 `21e`): the buffer's first byte made nought; an error
 * not the general ones, 0 to 11, nor the kind's own, `MMSYSERR_BADERRNUM`;
 * else MMSYSTEM's string loaded into a buffer of two bytes or more.
 */
export function errorText(
  system: any,
  error: number,
  far: number,
  size: number,
  own: [number, number]
) {
  error &= 0xffff;
  size &= 0xffff;

  if (!size) {
    return MMSYSERR_NOERROR;
  }

  if (!writable(system, far, size)) {
    return MMSYSERR_INVALPARAM;
  }

  writeBytes(system, far, [0]);

  if (error > 11 && !(error >= own[0] && error <= own[1])) {
    return MMSYSERR_BADERRNUM;
  }

  if (size > 1) {
    const text = MMSYSTEM_STRINGS.get(error);

    if (text === undefined) {
      return MMSYSERR_BADERRNUM;
    }

    const count = Math.min(text.length, size - 1);

    writeBytes(
      system,
      far,
      Array.from({ length: count + 1 }, (_, i) => (i < count ? text.charCodeAt(i) : 0))
    );
  }

  return MMSYSERR_NOERROR;
}
