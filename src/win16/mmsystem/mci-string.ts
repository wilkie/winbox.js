'use strict';

import { GlobalAlloc } from '../kernel/GlobalAlloc.js';
import { GlobalFree } from '../kernel/GlobalFree.js';
import { globalPointer } from '../kernel/GlobalLock.js';
import { find, mciSendCommand, mciSendCommandGiven } from './mci.js';
import { MMSYSTEM_STRINGS } from './strings.js';

/**
 * MCI's string interface: a command as words, run as the command it names,
 * and the answer given back as text. **Recorded** by `sndplay`, in an
 * installation with no sound driver, as Flak of the corpus opens its music:
 *
 * * `open`, with `type` and `alias` or without, answers the new device's ID,
 *   `1`; a name the task has open already, as an alias, answers 121h; a file
 *   that is not there 113h.
 * * `status` answers a number -- the length, the position -- or a word: the
 *   mode, `stopped`; the time format, `song pointer` or `milliseconds`;
 *   whether the device is ready, `false`. An item there is none of answers
 *   122h.
 * * `set ... time format` changes the format the length is in; `seek ... to
 *   start` and `stop` answer nought; `play` the driver's error; `info ...
 *   product` the driver's name; `sysinfo all quantity` and `name` the
 *   devices `[mci]` names.
 * * `close all` closes every device the task has open.
 * * A device the task has not open answers 107h; a command with no device,
 *   124h; nothing at all, 10Bh.
 * * The text is nothing where the answer is an error or has no text.
 *
 * Not recorded, and answered as MCI's documentation has them: a command
 * there is none of (105h, as MMSYSTEM's own error for it), `notify`'s
 * window, and a return buffer too small (10Ch).
 */

const MCI_OPEN = 0x803;
const MCI_CLOSE = 0x804;
const MCI_PLAY = 0x806;
const MCI_SEEK = 0x807;
const MCI_STOP = 0x808;
const MCI_PAUSE = 0x809;
const MCI_INFO = 0x80a;
const MCI_SET = 0x80d;
const MCI_SYSINFO = 0x810;
const MCI_STATUS = 0x814;
const MCI_RESUME = 0x855;

const MCI_NOTIFY = 0x1;
const MCI_WAIT = 0x2;
const MCI_FROM = 0x4;
const MCI_TO = 0x8;
const MCI_OPEN_SHAREABLE = 0x100;
const MCI_OPEN_ELEMENT = 0x200;
const MCI_OPEN_ALIAS = 0x400;
const MCI_OPEN_TYPE = 0x2000;
const MCI_SEEK_TO_START = 0x100;
const MCI_SEEK_TO_END = 0x200;
const MCI_STATUS_ITEM = 0x100;
/* A status's answer given as hours, minutes, seconds and frames. */
const MCI_COLONIZED4_RETURN = 0x40000;
const MCI_SET_TIME_FORMAT = 0x400;
const MCI_INFO_PRODUCT = 0x100;
const MCI_INFO_FILE = 0x200;
const MCI_SYSINFO_QUANTITY = 0x100;
const MCI_SYSINFO_OPEN = 0x200;
const MCI_SYSINFO_NAME = 0x400;
const MCI_ALL_DEVICE_ID = 0xffff;

const MCIERR_UNRECOGNIZED_COMMAND = 0x105;
const MCIERR_INVALID_DEVICE_NAME = 0x107;
const MCIERR_MISSING_COMMAND_STRING = 0x10b;
const MCIERR_PARAM_OVERFLOW = 0x10c;
const MCIERR_UNRECOGNIZED_KEYWORD = 0x122;
const MCIERR_MISSING_DEVICE_NAME = 0x124;
const MCIERR_BAD_TIME_FORMAT = 0x125;

/** The status items, and how each answers: a number, a word of MMSYSTEM's by value, or true or false. */
const ITEMS: Record<string, [number, 'number' | 'mode' | 'format' | 'boolean']> = {
  length: [1, 'number'],
  position: [2, 'number'],
  'number of tracks': [3, 'number'],
  mode: [4, 'mode'],
  'media present': [5, 'boolean'],
  'time format': [6, 'format'],
  ready: [7, 'boolean'],
  'current track': [8, 'number'],
};

/** The time formats by name, as `set` takes them and `status` gives them. */
const FORMATS: [string, number][] = [
  ['milliseconds', 0],
  ['ms', 0],
  ['hms', 1],
  ['msf', 2],
  ['frames', 3],
  ['smpte 24', 4],
  ['smpte 25', 5],
  ['smpte 30', 6],
  ['smpte 30 drop', 7],
  ['bytes', 8],
  ['samples', 9],
  ['tmsf', 10],
  ['song pointer', 0x4001],
];

/** A time given as hours, minutes, seconds and frames, a byte each from the lowest, as hh:mm:ss:ff. */
export function colonized(value: number) {
  return [0, 8, 16, 24].map((shift) => String((value >>> shift) & 0xff).padStart(2, '0')).join(':');
}

/** The words of a command: split at spaces, a double-quoted run kept whole. */
function wordsOf(command: string) {
  const words: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(command))) {
    words.push(match[1] ?? match[2]);
  }

  return words;
}

/** The program's memory, a block at a time, freed after the command. */
class Scratch {
  blocks: number[] = [];

  constructor(private system: any) {}

  /** A block of `size` bytes, zeroed, as a far pointer. */
  take(size: number) {
    const block = GlobalAlloc.call(this.system, 0x42, size);

    this.blocks.push(block);

    return globalPointer.call(this.system, block) >>> 0;
  }

  /** A string in a block of its own. */
  text(value: string) {
    const far = this.take(value.length + 1);
    const core = this.system.machine.cpu.core;

    for (let i = 0; i < value.length; i++) {
      core.write8(far >>> 16, ((far & 0xffff) + i) & 0xffff, value.charCodeAt(i) & 0xff);
    }

    return far;
  }

  read32(far: number, at: number) {
    const core = this.system.machine.cpu.core;
    const offset = far & 0xffff;

    return (
      (core.read16(far >>> 16, (offset + at) & 0xffff) |
        (core.read16(far >>> 16, (offset + at + 2) & 0xffff) << 16)) >>>
      0
    );
  }

  write32(far: number, at: number, value: number) {
    const core = this.system.machine.cpu.core;
    const offset = far & 0xffff;

    core.write16(far >>> 16, (offset + at) & 0xffff, value & 0xffff);
    core.write16(far >>> 16, (offset + at + 2) & 0xffff, (value >>> 16) & 0xffff);
  }

  readText(far: number) {
    const core = this.system.machine.cpu.core;
    let text = '';

    for (let at = far & 0xffff; ; at = (at + 1) & 0xffff) {
      const byte = core.read8(far >>> 16, at);

      if (!byte) {
        return text;
      }

      text += String.fromCharCode(byte);
    }
  }

  free() {
    for (const block of this.blocks) {
      GlobalFree.call(this.system, block);
    }
  }
}

/** A run of words, taken from the front where it is there. */
function takes(words: string[], ...wanted: string[]) {
  if (wanted.every((word, at) => words[at]?.toLowerCase() === word)) {
    words.splice(0, wanted.length);
    return true;
  }

  return false;
}

/** The notify and wait flags, taken from wherever they are in the words; the window for notify. */
function waits(words: string[], hwnd: number) {
  let flags = 0;

  for (let at = words.length - 1; at >= 0; at--) {
    const word = words[at].toLowerCase();

    if (word === 'wait' || word === 'notify') {
      flags |= word === 'wait' ? MCI_WAIT : MCI_NOTIFY;
      words.splice(at, 1);
    }
  }

  return { flags, callback: flags & MCI_NOTIFY ? hwnd & 0xffff : 0 };
}

/** Runs a command string; its answer, and its text. */
async function run(system: any, command: string, hwnd: number): Promise<[number, string]> {
  const words = wordsOf(command);
  const scratch = new Scratch(system);

  try {
    if (!words.length) {
      return [MCIERR_MISSING_COMMAND_STRING, ''];
    }

    const verb = words.shift()!.toLowerCase();

    if (!words.length) {
      return [MCIERR_MISSING_DEVICE_NAME, ''];
    }

    const name = words.shift()!;
    const { flags: waiting, callback } = waits(words, hwnd);
    const task = system.scheduler?.active ?? 0;
    const send = (id: number, message: number, flags: number, parms: number) =>
      mciSendCommand.call(system, id, message, (flags | waiting) >>> 0, parms);

    if (verb === 'open') {
      const parms = scratch.take(0x18);
      let flags = 0;

      scratch.write32(parms, 0, callback);

      while (words.length) {
        if (takes(words, 'type') && words.length) {
          flags |= MCI_OPEN_TYPE;
          scratch.write32(parms, 8, scratch.text(words.shift()!));
        } else if (takes(words, 'alias') && words.length) {
          flags |= MCI_OPEN_ALIAS;
          scratch.write32(parms, 0x10, scratch.text(words.shift()!));
        } else if (takes(words, 'shareable')) {
          flags |= MCI_OPEN_SHAREABLE;
        } else {
          return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
        }
      }

      /* A name with a type is its element; alone, a file where it looks
       * like one, and otherwise a device's type. */
      if (flags & MCI_OPEN_TYPE || /[.\\:]/.test(name)) {
        flags |= MCI_OPEN_ELEMENT;
        scratch.write32(parms, 0x0c, scratch.text(name));
      } else {
        flags |= MCI_OPEN_TYPE;
        scratch.write32(parms, 8, scratch.text(name));
      }

      const answer = await send(0, MCI_OPEN, flags, parms);

      return answer ? [answer, ''] : [0, String(scratch.read32(parms, 4) & 0xffff)];
    }

    if (verb === 'sysinfo') {
      const parms = scratch.take(0x14);
      const text = scratch.take(128);
      let flags = 0;

      scratch.write32(parms, 0, callback);
      scratch.write32(parms, 4, text);
      scratch.write32(parms, 8, 128);

      if (takes(words, 'quantity')) {
        flags |= MCI_SYSINFO_QUANTITY;
      } else if (takes(words, 'name') && words.length) {
        flags |= MCI_SYSINFO_NAME;
        scratch.write32(parms, 0x0c, Number(words.shift()) >>> 0);
      } else {
        return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
      }

      if (takes(words, 'open')) {
        flags |= MCI_SYSINFO_OPEN;
      }

      if (words.length) {
        return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
      }

      const id = name.toLowerCase() === 'all' ? MCI_ALL_DEVICE_ID : 0;
      const answer = await send(id, MCI_SYSINFO, flags, parms);

      if (answer) {
        return [answer, ''];
      }

      return [
        0,
        flags & MCI_SYSINFO_QUANTITY ? String(scratch.read32(text, 0)) : scratch.readText(text),
      ];
    }

    const id = find(system, task, name);

    if (!id) {
      return [MCIERR_INVALID_DEVICE_NAME, ''];
    }

    switch (verb) {
      case 'close':
      case 'stop':
      case 'pause':
      case 'resume': {
        if (words.length) {
          return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
        }

        const parms = scratch.take(4);
        const message = { close: MCI_CLOSE, stop: MCI_STOP, pause: MCI_PAUSE, resume: MCI_RESUME }[
          verb
        ];

        scratch.write32(parms, 0, callback);
        return [await send(id, message, 0, parms), ''];
      }

      case 'play': {
        const parms = scratch.take(12);
        let flags = 0;

        scratch.write32(parms, 0, callback);

        while (words.length) {
          if (takes(words, 'from') && words.length) {
            flags |= MCI_FROM;
            scratch.write32(parms, 4, Number(words.shift()) >>> 0);
          } else if (takes(words, 'to') && words.length) {
            flags |= MCI_TO;
            scratch.write32(parms, 8, Number(words.shift()) >>> 0);
          } else {
            return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
          }
        }

        return [await send(id, MCI_PLAY, flags, parms), ''];
      }

      case 'seek': {
        const parms = scratch.take(8);
        let flags = 0;

        scratch.write32(parms, 0, callback);

        if (takes(words, 'to', 'start')) {
          flags = MCI_SEEK_TO_START;
        } else if (takes(words, 'to', 'end')) {
          flags = MCI_SEEK_TO_END;
        } else if (takes(words, 'to') && words.length) {
          flags = MCI_TO;
          scratch.write32(parms, 4, Number(words.shift()) >>> 0);
        }

        if (!flags || words.length) {
          return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
        }

        return [await send(id, MCI_SEEK, flags, parms), ''];
      }

      case 'status': {
        const item = ITEMS[words.join(' ').toLowerCase()];

        if (!item) {
          return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
        }

        const parms = scratch.take(0x10);

        scratch.write32(parms, 0, callback);
        scratch.write32(parms, 8, item[0]);

        const [answer, given] = await mciSendCommandGiven(
          system,
          id,
          MCI_STATUS,
          (MCI_STATUS_ITEM | waiting) >>> 0,
          parms
        );

        if (answer) {
          return [answer, ''];
        }

        const value = scratch.read32(parms, 4);

        /* A time in an SMPTE format: hours, minutes, seconds and frames, a
         * byte each from the lowest, two digits each (**recorded** by
         * `seqlen`: "00:00:00:12"). */
        if (given & MCI_COLONIZED4_RETURN) {
          return [0, colonized(value)];
        }

        switch (item[1]) {
          case 'mode':
            return [0, MMSYSTEM_STRINGS.get(value & 0xffff) ?? String(value)];
          case 'boolean':
            return [0, value ? 'true' : 'false'];
          case 'format':
            return [
              0,
              FORMATS.find(([word, format]) => format === value && word !== 'ms')?.[0] ??
                String(value),
            ];
          default:
            return [0, String(value)];
        }
      }

      case 'set': {
        const parms = scratch.take(0x0c);

        scratch.write32(parms, 0, callback);

        if (!takes(words, 'time', 'format')) {
          return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
        }

        const format = FORMATS.find(([word]) => word === words.join(' ').toLowerCase());

        if (!format) {
          return [MCIERR_BAD_TIME_FORMAT, ''];
        }

        scratch.write32(parms, 4, format[1]);
        return [await send(id, MCI_SET, MCI_SET_TIME_FORMAT, parms), ''];
      }

      case 'info': {
        const flags = takes(words, 'product')
          ? MCI_INFO_PRODUCT
          : takes(words, 'file')
            ? MCI_INFO_FILE
            : 0;

        if (!flags || words.length) {
          return [MCIERR_UNRECOGNIZED_KEYWORD, ''];
        }

        const parms = scratch.take(0x0c);
        const text = scratch.take(128);

        scratch.write32(parms, 0, callback);
        scratch.write32(parms, 4, text);
        scratch.write32(parms, 8, 128);

        const answer = await send(id, MCI_INFO, flags, parms);

        return answer ? [answer, ''] : [0, scratch.readText(text)];
      }

      default:
        return [MCIERR_UNRECOGNIZED_COMMAND, ''];
    }
  } finally {
    scratch.free();
  }
}

/**
 * Runs an MCI command given as a string, and gives its answer back as text.
 *
 * @param {Types.LPCSTR} lpstrCommand - The command.
 * @param {Types.FARPTR} lpstrReturnString - Where the text goes, or nought.
 * @param {Types.UINT} uReturnLength - The room there.
 * @param {Types.HWND} hwndCallback - The window `notify` tells.
 *
 * @returns {Types.DWORD} Nought, or an error.
 */
export async function mciSendString(
  this: any,
  lpstrCommand: any,
  lpstrReturnString: number,
  uReturnLength: number,
  hwndCallback: number
) {
  let [answer, text] = await run(this, String(lpstrCommand ?? ''), hwndCallback);

  if (lpstrReturnString && uReturnLength) {
    if (text.length + 1 > uReturnLength) {
      answer = answer || MCIERR_PARAM_OVERFLOW;
      text = '';
    }

    const core = this.machine.cpu.core;
    const segment = (lpstrReturnString >>> 16) & 0xffff;
    const offset = lpstrReturnString & 0xffff;

    for (let i = 0; i < text.length; i++) {
      core.write8(segment, (offset + i) & 0xffff, text.charCodeAt(i) & 0xff);
    }

    core.write8(segment, (offset + text.length) & 0xffff, 0);
  }

  return answer >>> 0;
}
