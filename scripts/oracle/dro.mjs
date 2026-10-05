#!/usr/bin/env node
/**
 * Reads what DOSBox captured of its sound while a probe played
 * (`record.mjs --capture`) and turns it into a fixture.
 *
 * The `.dro` file is DOSBox 0.74's "raw OPL" capture, version 2.0
 * (`src/hardware/adlib.cpp`, class `Capture`): a 26-byte header --
 * "DBRAWOPL", the version as two words, 2 and 0, the number of command
 * pairs, the milliseconds they span, the hardware (0 an OPL2), the format
 * (0, interleaved), the compression (0), the two codes that mean a delay,
 * and the size of the code table -- then the code table, which turns a
 * code below 128 into a register, then the pairs. A pair whose code is the
 * short delay's waits its value plus one milliseconds; the long delay's,
 * its value plus one times 256. Any other code is a register write, to the
 * second chip when its top bit is set.
 *
 * What DOSBox leaves out matters to anyone comparing against it:
 *
 * * The file starts at the first key-on after the key is pressed, not at
 *   the key. It begins with every register the chip holds that is not
 *   nought, in the register's order, keys (B0h-B8h) left out, all at
 *   nought milliseconds, then the write that started it (`snapshot`
 *   counts the first).
 * * A write of the value a register already holds is not recorded.
 * * The timers and the test register (02h-04h, and 00h, 06h, 07h) are not
 *   recorded; nor are reads of the status port.
 * * Time is DOSBox's millisecond tick, `PIC_Ticks`: whole milliseconds.
 * * More than 30 seconds between writes closes the file; the next key-on
 *   starts another.
 *
 *   node scripts/oracle/dro.mjs <file.dro>      # its writes, as JSON
 *
 * The `.wav` is the mixer's output, described rather than kept: its
 * header's rate, channels and bits, its length, and its hash.
 *
 * DOSBox built with an access trace (`--dosbox`) writes every access to
 * the OPL's ports, `opl-trace.txt`: the time in milliseconds to the
 * microsecond, `w` or `r`, the port and the byte.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** A `.dro` file's header and its writes, `{ms, register, value}`. */
export function decodeDro(bytes) {
  if (bytes.toString('latin1', 0, 8) !== 'DBRAWOPL') {
    throw new Error('not a DOSBox raw OPL capture');
  }

  const major = bytes.readUInt16LE(8);
  const minor = bytes.readUInt16LE(10);

  if (major !== 2 || minor !== 0) {
    throw new Error(`DRO version ${major}.${minor}, not 2.0`);
  }

  const header = {
    version: `${major}.${minor}`,
    commands: bytes.readUInt32LE(12),
    milliseconds: bytes.readUInt32LE(16),
    hardware: ['opl2', 'dual-opl2', 'opl3'][bytes[20]] ?? bytes[20],
    format: bytes[21],
    compression: bytes[22],
  };
  const short = bytes[23];
  const long = bytes[24];
  const size = bytes[25];
  const table = [...bytes.subarray(26, 26 + size)];

  const writes = [];
  let ms = 0;
  let snapshot = null;

  for (let at = 26 + size; at + 1 < bytes.length; at += 2) {
    const code = bytes[at];
    const value = bytes[at + 1];

    if (code === short) {
      ms += value + 1;
    } else if (code === long) {
      ms += (value + 1) * 256;
    } else {
      const register = table[code & 0x7f] | (code & 0x80 ? 0x100 : 0);

      if (snapshot === null && register >= 0xb0 && register <= 0xb8) {
        snapshot = writes.length;
      }

      writes.push({ ms, register, value });
    }
  }

  return { ...header, pairs: (bytes.length - 26 - size) >> 1, snapshot, writes };
}

/** A `.wav` file described: its format, its length and its hash. */
export function describeWav(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('not a WAVE file');
  }

  let at = 12;
  let format = null;
  let data = null;

  while (at + 8 <= bytes.length) {
    const id = bytes.toString('latin1', at, at + 4);
    const length = bytes.readUInt32LE(at + 4);

    if (id === 'fmt ') {
      format = {
        rate: bytes.readUInt32LE(at + 12),
        channels: bytes.readUInt16LE(at + 10),
        bits: bytes.readUInt16LE(at + 22),
      };
    } else if (id === 'data') {
      data = { at: at + 8, length: Math.min(length, bytes.length - at - 8) };
    }

    at += 8 + length + (length & 1);
  }

  const frames = data.length / (format.channels * (format.bits / 8));

  return {
    ...format,
    frames,
    ms: Math.round((frames / format.rate) * 1000),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** The access trace: `{ms, op, port, value}`, `op` `w` or `r`. */
export function decodeTrace(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ms, op, port, value] = line.split(' ');

      return { ms: Number(ms), op, port: parseInt(port, 16), value: parseInt(value, 16) };
    });
}

/**
 * The trace's register writes as DOSBox's capture would keep them: the
 * address port's last value names the register, the timers and test
 * register are left out, and so is a write of the value the register
 * already holds. DOSBox compares with a register cache it never clears
 * (`Adlib::Module::cache`, allocated with the module and not set), so what
 * a register held before its first write is whatever the memory held: a
 * first write here is kept, and marked `first`, for it may or may not be
 * in a `.dro`.
 */
export function asCaptured(trace) {
  const kept = new Set([0x01, 0x04, 0x05, 0x08, 0xbd]);

  for (let i = 0; i < 24; i++) {
    if ((i & 7) < 6) {
      for (const base of [0x20, 0x40, 0x60, 0x80, 0xe0]) {
        kept.add(base + i);
      }
    }
  }

  for (let i = 0; i < 9; i++) {
    kept
      .add(0xa0 + i)
      .add(0xb0 + i)
      .add(0xc0 + i);
  }

  const held = new Int16Array(256).fill(-1);
  const out = [];
  let register = 0;

  for (const { ms, op, port, value } of trace) {
    if (op !== 'w') {
      continue;
    }

    if ((port & 1) === 0) {
      register = value;
      continue;
    }

    /* 02h-04h are DOSBox's timers, written to them and not to the chip. */
    if (register >= 0x02 && register <= 0x04) {
      continue;
    }

    const before = held[register];

    held[register] = value;

    if (kept.has(register) && before !== value) {
      out.push({ ms, register, value, ...(before === -1 ? { first: true } : {}) });
    }
  }

  return out;
}

/** One write a line, so the fixture diffs a write at a time. */
export function writesJson(writes) {
  return `[\n${writes.map((write) => `    ${JSON.stringify(write)}`).join(',\n')}\n  ]`;
}

if (process.argv[1]?.endsWith('dro.mjs')) {
  const { writes, ...header } = decodeDro(readFileSync(process.argv[2]));

  console.log(`{\n  "header": ${JSON.stringify(header)},\n  "writes": ${writesJson(writes)}\n}`);
}
