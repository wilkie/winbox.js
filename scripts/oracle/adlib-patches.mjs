#!/usr/bin/env node
/**
 * Takes the Ad Lib driver's instruments and tables out of Windows' own
 * `MSADLIB.DRV`, for a synthesizer of WinBox's own to play MIDI as it does.
 * What each is, and where the driver uses it, is `kb/topics/adlib.md`.
 *
 *   node scripts/oracle/adlib-patches.mjs [MSADLIB.DRV]
 *
 * Writes `crates/winbox-win16/data/adlib-patches.json`:
 *
 * * `bank`: resource 1 of type 256, an Ad Lib instrument bank (`.BNK`,
 *   "ADLIB-", version 1.0), as the driver loads it into its data segment
 *   (seg2 `3ba`): the first 180 of its 192 records, 30 bytes each, from
 *   the bank's data offset; each its number, its name in the bank's name
 *   list if it has one, whether it is a percussion instrument and the voice
 *   it then plays on, and its two operators' 13 parameters and waveform.
 *   Patches 0-127 are the programs; 128-174 are the drums.
 * * `drums`: resource 1 of type 257, the drum key map the driver loads
 *   (seg2 `48f`): for each key from 35 to 81, the patch and the note it
 *   plays.
 * * From the driver's data segment (seg3): `transpose`, each program's
 *   transposition in semitones (seg3 `11e`); `velocity`, the volume each
 *   velocity gives (seg3 `9e`); and the operator tables (seg3 `14`-`6b`).
 * * `fnumbers`: the 25 rows of 12 F-numbers the driver computes when it
 *   resets (seg2 `262`, `2fc`, `367`), by its own integer arithmetic.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNE } from './ne.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRIVER =
  process.argv[2] ??
  join(ROOT, 'oracle', 'build', 'drive-c-vgasound', 'WINDOWS', 'SYSTEM', 'MSADLIB.DRV');
const OUTPUT = join(ROOT, 'crates', 'winbox-win16', 'data', 'adlib-patches.json');

/** A resource's bytes, by its numbered type and id. */
function resource({ bytes, view, header }, type, id) {
  const table = header + view.getUint16(header + 0x24, true);
  const shift = view.getUint16(table, true);
  let at = table + 2;

  while (view.getUint16(at, true)) {
    const kind = view.getUint16(at, true);
    const count = view.getUint16(at + 2, true);

    at += 8;

    for (let i = 0; i < count; i++, at += 12) {
      if (kind === (0x8000 | type) && view.getUint16(at + 6, true) === (0x8000 | id)) {
        const offset = view.getUint16(at, true) << shift;

        return bytes.subarray(offset, offset + (view.getUint16(at + 2, true) << shift));
      }
    }
  }

  throw new Error(`no resource ${type}:${id}`);
}

const PARAMETERS = [
  'ksl',
  'multiple',
  'feedback',
  'attack',
  'sustain',
  'sustaining',
  'decay',
  'release',
  'level',
  'tremolo',
  'vibrato',
  'ksr',
  'fm',
];

/** The F-numbers, as seg2 `2fc` and `367` work them out, row by row. */
function fnumbers() {
  const rows = [];

  for (let row = 0; row < 25; row++) {
    /* seg2 `367`, called with 4 * row and 100: the first note's, in
     * eighths. Each step is the driver's long multiply and divide, which
     * truncate; the numbers stay positive. */
    const a = 4 * row;
    let x = Math.floor(((10000 + 6 * a) * 52088) / 250000);

    x = Math.floor((x * 147456) / 111875);

    const notes = [(x + 4) >> 3];

    /* Each next semitone 106/100 of the one before (seg2 `32b`). */
    for (let i = 1; i < 12; i++) {
      x = Math.floor((x * 106) / 100);
      notes.push((x + 4) >> 3);
    }

    rows.push(notes);
  }

  return rows;
}

const ne = readNE(DRIVER);
const data = ne.segments[2];
const seg3 = ne.bytes.subarray(data.at, data.at + data.length);
const signed = (byte) => (byte & 0x80 ? byte - 0x100 : byte);

const bnk = resource(ne, 256, 1);

if (bnk.toString('latin1', 2, 8) !== 'ADLIB-') {
  throw new Error('resource 256:1 is not an Ad Lib bank');
}

const used = bnk.readUInt16LE(8);
const names = new Map();
const nameAt = bnk.readUInt32LE(12);
const dataAt = bnk.readUInt32LE(16);

for (let i = 0; i < used; i++) {
  const at = nameAt + i * 12;
  const name = bnk.toString('latin1', at + 3, at + 12).replace(/\0.*$/, '');

  names.set(bnk.readUInt16LE(at), name);
}

const bank = [];

/* seg2 `42f`-`476`: 30 bytes a record into `[424h]`, until `[193Ch]`. */
for (let patch = 0; patch < (0x193c - 0x424) / 30; patch++) {
  const at = dataAt + patch * 30;
  const operator = (from, wave) => ({
    ...Object.fromEntries(PARAMETERS.map((name, i) => [name, bnk[from + i]])),
    wave: bnk[wave],
  });

  bank.push({
    patch,
    name: names.get(patch) ?? null,
    percussive: bnk[at],
    voice: bnk[at + 1],
    operators: [operator(at + 2, at + 28), operator(at + 15, at + 29)],
  });
}

const drums = [];
const keys = resource(ne, 257, 1);

/* seg2 `4f0`-`545`: three bytes a key, up to 47 of them. */
for (let at = 0; at + 3 <= keys.length && drums.length < 47; at += 3) {
  if (keys[at] >= 35 && keys[at] <= 81) {
    drums.push({ key: keys[at], patch: keys[at + 1], note: keys[at + 2] });
  }
}

const table = (at, count) => [...seg3.subarray(at, at + count)];

const out = {
  source:
    "Windows 3.1's MSADLIB.DRV (22,064 bytes): resources 256:1 (the bank) and 257:1 (the " +
    'drum keys), and its data segment (seg3); see kb/topics/adlib.md and ' +
    'scripts/oracle/adlib-patches.mjs.',
  bank,
  drums,
  transpose: table(0x11e, 128).map(signed),
  velocity: table(0x9e, 128),
  /* The eighteen operators in the driver's order, and where each's
   * registers are: 20h + this, and so on (seg3 `14`). */
  slotOffsets: table(0x14, 18),
  /* Whether each is a carrier (seg3 `26`), and its channel (seg3 `3e`). */
  carrier: table(0x26, 18),
  slotChannel: table(0x3e, 18),
  /* Each melodic voice's modulator and carrier (seg3 `5a`), the bass
   * drum's pair (seg3 `50`), and the one operator of each other drum,
   * voices 7 to 10 (seg3 `52`): snare, tom, cymbal, hi-hat. */
  voiceSlots: Array.from({ length: 9 }, (_, v) => table(0x5a + 2 * v, 2)),
  percussionSlots: [6, 7, 8, 9, 10].map((v) => table(0x44 + 2 * v, v === 6 ? 2 : 1)),
  /* Each percussion voice's bit of BDh (seg3 `38`). */
  percussionBits: table(0x38, 5),
  /* The message lengths (seg3 `1ae`, `1b6`). */
  lengths: table(0x1ae, 8),
  systemLengths: table(0x1b6, 8),
  fnumbers: fnumbers(),
};

/* A patch, a drum key or a row a line; the rest as JSON has it. */
const json = `{\n${Object.entries(out)
  .map(([key, value]) =>
    Array.isArray(value) && typeof value[0] === 'object'
      ? `  ${JSON.stringify(key)}: [\n${value.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`
      : `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`
  )
  .join(',\n')}\n}`;

writeFileSync(OUTPUT, `${json}\n`);
console.log(`${bank.length} patches, ${drums.length} drum keys -> ${OUTPUT}`);
