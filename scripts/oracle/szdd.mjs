#!/usr/bin/env node
/**
 * The compressed files the `lzfiles`, `verinfo` and `verinst` probes give
 * LZEXPAND, made in Microsoft's `COMPRESS` format: the "SZDD" header and
 * the LZ77 stream `LZEXPAND.DLL`'s decoder reads (`kb/formats/szdd.md`).
 *
 * No compressor ships with Windows 3.1, so this is one, written from the
 * read-out of the decoder (`LZEXPAND.DLL` seg9 `0000`): a ring of 4096
 * bytes, all spaces but its last 16, written from 0FF0h; a flag byte, its
 * bits from the lowest, 1 a literal byte and 0 a pair -- the ring's place,
 * its low eight bits in the first byte and its high four in the second's
 * high nibble, and the length less three in the second's low nibble. A
 * match only ever names ring bytes the decoder has: the spaces, or what it
 * has written. The probes check its output by expanding it through
 * Windows' own `LZEXPAND.DLL` on DOSBox and comparing every byte with the
 * data they make themselves.
 *
 *   node scripts/oracle/szdd.mjs      # writes oracle/probes/lzdata.h
 */

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const RING = 4096;
const START = RING - 16;
const MIN = 3;
const MAX = 18;

/** Data compressed as `COMPRESS` writes it, with its header: `last` the name's last character, kept for `GetExpandedName`. */
export function compress(data, last = 0) {
  const ring = new Uint8Array(RING).fill(0x20, 0, START);
  /* Which places of the ring the decoder has filled: the spaces, at first. */
  const filled = new Uint8Array(RING).fill(1, 0, START);
  const out = [];
  let position = START;
  let at = 0;

  while (at < data.length) {
    const flags = out.length;
    let bits = 0;

    out.push(0);

    for (let bit = 0; bit < 8 && at < data.length; bit++) {
      let best = 0;
      let bestPlace = 0;

      for (let place = 0; place < RING; place++) {
        let length = 0;

        while (length < MAX && at + length < data.length) {
          const from = (place + length) & (RING - 1);
          /* A place this match has itself written, its byte the data's. */
          const ahead = (from - position) & (RING - 1);
          const byte = ahead < length ? data[at + ahead] : filled[from] ? ring[from] : -1;

          if (byte !== data[at + length]) {
            break;
          }

          length++;
        }

        if (length > best) {
          best = length;
          bestPlace = place;
        }
      }

      if (best >= MIN) {
        out.push(bestPlace & 0xff, ((bestPlace >> 4) & 0xf0) | (best - MIN));
      } else {
        best = 1;
        bits |= 1 << bit;
        out.push(data[at]);
      }

      for (let i = 0; i < best; i++) {
        ring[position] = data[at + i];
        filled[position] = 1;
        position = (position + 1) & (RING - 1);
      }

      at += best;
    }

    out[flags] = bits;
  }

  const header = [0x53, 0x5a, 0x44, 0x44, 0x88, 0xf0, 0x27, 0x33, 0x41, last & 0xff];
  const size = data.length;

  header.push(size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff);

  return Uint8Array.from([...header, ...out]);
}

/** What the decoder makes of a stream: the data, `size` bytes of it at most. */
export function expand(file) {
  const size = file[10] | (file[11] << 8) | (file[12] << 16) | (file[13] << 24);
  const ring = new Uint8Array(RING).fill(0x20, 0, START);
  const out = [];
  let position = START;
  let at = 14;

  const put = (byte) => {
    out.push(byte);
    ring[position] = byte;
    position = (position + 1) & (RING - 1);
  };

  while (at < file.length && out.length < size) {
    const flags = file[at++];

    for (let bit = 0; bit < 8 && at < file.length; bit++) {
      if (flags & (1 << bit)) {
        put(file[at++]);
      } else {
        const low = file[at++];
        const high = file[at++];
        const place = low | ((high & 0xf0) << 4);

        for (let i = 0; i < (high & 0x0f) + MIN; i++) {
          put(ring[(place + i) & (RING - 1)]);
        }
      }
    }
  }

  return Uint8Array.from(out);
}

/*
 * The probes' data, made the same way here and in C (`lzdata.h`'s
 * `lzMake`): a linear congruential generator's bytes, as words of text or
 * as runs.
 */

const WORDS = [
  'the ',
  'quick ',
  'brown ',
  'fox ',
  'jumps ',
  'over ',
  'lazy ',
  'dog ',
  '\r\n',
  'Windows ',
  '  ',
];

/** The generator `lzMake` steps: 32 bits, as Watcom's `unsigned long`. */
function generator(seed) {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;

    return (state >>> 16) & 0xff;
  };
}

/** `count` bytes of words, from `seed`. */
export function text(seed, count) {
  const next = generator(seed);
  const out = [];

  while (out.length < count) {
    const word = WORDS[next() % WORDS.length];

    for (const char of word) {
      if (out.length < count) {
        out.push(char.charCodeAt(0));
      }
    }
  }

  return Uint8Array.from(out);
}

/** Runs: 100 spaces, 200 `A`s, `AB` a hundred times, then each byte value once. */
export function runs() {
  const out = [];

  out.push(...new Array(100).fill(0x20));
  out.push(...new Array(200).fill(0x41));

  for (let i = 0; i < 100; i++) {
    out.push(0x41, 0x42);
  }

  for (let i = 0; i < 256; i++) {
    out.push(i);
  }

  return Uint8Array.from(out);
}

/** The files the probes put on the drive, compressed. */
export const FILES = {
  TEXT: { data: () => text(1, 3000), last: 0x54 },
  BIG: { data: () => text(2, 20000), last: 0x54 },
  RUNS: { data: () => runs(), last: 0x4e },
};

function header() {
  const lines = [
    '/*',
    ' * Compressed files for the LZEXPAND and VER probes, in the COMPRESS',
    ' * format, written by scripts/oracle/szdd.mjs: do not edit by hand.',
    ' */',
    '',
  ];

  for (const [name, { data, last }] of Object.entries(FILES)) {
    const bytes = data();
    const packed = compress(bytes, last);
    const back = expand(packed);

    if (back.length !== bytes.length || back.some((byte, i) => byte !== bytes[i])) {
      throw new Error(`${name}: the stream does not expand to its data`);
    }

    lines.push(`/* ${bytes.length} bytes, ${packed.length} compressed. */`);
    lines.push(`#define LZ_${name}_SIZE ${packed.length}`);
    lines.push(`static const unsigned char LZ_${name}[] = {`);

    for (let i = 0; i < packed.length; i += 16) {
      lines.push(
        '    ' +
          Array.from(
            packed.slice(i, i + 16),
            (byte) => `0x${byte.toString(16).padStart(2, '0')},`
          ).join(' ')
      );
    }

    lines.push('};', '');
  }

  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  writeFileSync(join(ROOT, 'oracle', 'probes', 'lzdata.h'), header());
  console.log('lzdata.h written');
}
