#!/usr/bin/env node
/**
 * Builds fonts with known contents, to ask Windows questions it will not
 * otherwise answer.
 *
 * Everything the oracle records is something a program can ask for. The
 * interpreter's own workings are not: what a control value scaled to, which
 * way a half rounded, whether a distance was compensated. Those are decided
 * inside GDI and never come out, and reasoning about them from the pixels of
 * a real font has taken this as far as it goes -- there is a discrepancy of
 * three sixty-fourths of a pixel in one control value of Times New Roman that
 * no amount of reading has explained.
 *
 * The way in is to control the input. If the font is ours, the values in it
 * are known exactly, and a glyph can be made to draw *where a computed value
 * says* rather than where a designer drew it. The rasteriser becomes a
 * readout: the row a bar lands on is the answer, and a bar that appears or
 * does not is one bit of one.
 *
 * These are patched rather than authored. A TrueType font is a dozen
 * interdependent tables and a `.FOT` stub to install it, and none of that is
 * what is being asked about; taking a font Windows already has and changing
 * the bytes under test keeps every other variable fixed, which is the point.
 *
 *   node scripts/oracle/fabricate.mjs           # build them all
 *   node scripts/oracle/fabricate.mjs --list    # say what would be built
 *
 * Output goes to `oracle/build/fonts/`, which `record.mjs` stages onto the
 * scratch drive before it runs a probe.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { driveFor } from './install-windows.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUILD = join(ROOT, 'oracle', 'build');
const OUTPUT = join(BUILD, 'fonts');

function log(...args) {
  console.log(...args);
}

/* ---- reading a font ---- */

/**
 * The table directory, as offsets into the file.
 *
 * Tags keep their trailing spaces -- `cvt ` is four characters and one of them
 * is a space, and trimming it is the sort of tidiness that costs an afternoon.
 */
export function tablesOf(view) {
  const count = view.getUint16(4, false);
  const tables = {};

  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16;

    let tag = '';

    for (let byte = 0; byte < 4; byte++) {
      tag += String.fromCharCode(view.getUint8(at + byte));
    }

    tables[tag] = {
      record: at,
      offset: view.getUint32(at + 8, false),
      length: view.getUint32(at + 12, false),
    };
  }

  return tables;
}

/* ---- checksums ---- */

/**
 * A table's checksum: the sum of its words, as though it were padded with
 * zeroes to a multiple of four.
 */
function checksum(view, offset, length) {
  let sum = 0;

  for (let at = 0; at < length; at += 4) {
    let word = 0;

    for (let byte = 0; byte < 4; byte++) {
      word = (word * 256 + (at + byte < length ? view.getUint8(offset + at + byte) : 0)) >>> 0;
    }

    sum = (sum + word) >>> 0;
  }

  return sum;
}

/**
 * Recomputes every checksum a font carries.
 *
 * Each table's own, then the adjustment in `head`, which is defined as a magic
 * constant minus the checksum of the whole file -- computed with that field
 * itself zeroed, since it cannot depend on its own value.
 *
 * Whether Windows 3.1 checks any of this is not known. Getting it right costs
 * twenty lines and removes the question, which is worth more than the twenty
 * lines: a fabricated font that fails to load would otherwise have two
 * possible explanations.
 */
export function reseal(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tablesOf(view);

  for (const tag of Object.keys(tables)) {
    const table = tables[tag];

    if (tag === 'head') {
      // Zeroed while its own table is summed, per the format.
      view.setUint32(table.offset + 8, 0, false);
    }

    view.setUint32(table.record + 4, checksum(view, table.offset, table.length), false);
  }

  if (tables.head) {
    const whole = checksum(view, 0, bytes.byteLength);

    view.setUint32(tables.head.offset + 8, (0xb1b0afba - whole) >>> 0, false);
  }

  return bytes;
}

/* ---- edits ---- */

/**
 * Replaces one entry of the control value table.
 *
 * In font units, which is how the table stores them; what they become in
 * pixels is exactly the question being asked.
 */
export function setControlValue(bytes, index, units) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = tablesOf(view)['cvt '];

  if (!table) {
    throw new Error('font has no control value table');
  }

  if ((index + 1) * 2 > table.length) {
    throw new Error(`control value ${index} is past the end of a ${table.length / 2} entry table`);
  }

  view.setInt16(table.offset + index * 2, units, false);

  return bytes;
}

/**
 * Replaces a program with one of our own, padded to the length it had.
 *
 * Same-length replacement on purpose. Growing a table means moving every table
 * after it and rewriting the directory, and none of that is under test; the
 * programs being written here are far shorter than the ones they replace, and
 * the remainder is filled with an instruction that does nothing.
 */
export function setProgram(bytes, tag, code) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = tablesOf(view)[tag];

  if (!table) {
    throw new Error(`font has no ${tag} table`);
  }

  if (code.length > table.length) {
    throw new Error(`${code.length} bytes of program will not fit in ${table.length}`);
  }

  for (let at = 0; at < table.length; at++) {
    // 0x4C is MPS, which pushes and is harmless; padding is never reached.
    view.setUint8(table.offset + at, at < code.length ? code[at] : 0x4c);
  }

  return bytes;
}

/* ---- what gets built ---- */

/**
 * The fonts to fabricate.
 *
 * Each names a font to start from, a file name to install as, and what to
 * change. Installing over the original name is deliberate: Windows finds it
 * through `WIN.INI`, which the installer already wrote, so nothing else has to
 * be told about it.
 */
export const FABRICATIONS = [
  {
    name: 'times-cvt0-raised',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: 'Times New Roman with control value 0 raised by 512 font units',

    /* The first experiment, and the one that proves the road exists. Control
     * value 0 is the one behind the cap height; raising it by 512 units is
     * about three and a half pixels at the size the glyphs are recorded at,
     * which no rounding can hide.
     *
     * Large on purpose. The first attempt raised it by a single unit, which is
     * a sixty-fourth of a pixel and moved nothing -- and a null result from a
     * change too small to see says nothing about whether the font was loaded
     * at all. A proof that the road exists has to be unmistakable or it is not
     * a proof.
     */
    edit: (bytes) => setControlValue(bytes, 0, controlValueOf(bytes, 0) + 512),
  },
];

/** Reads a control value back, so an edit can be relative to what is there. */
export function controlValueOf(bytes, index) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = tablesOf(view)['cvt '];

  return view.getInt16(table.offset + index * 2, false);
}

async function main() {
  const args = process.argv.slice(2);
  const listing = args.includes('--list');

  const source = join(driveFor('vga'), 'WINDOWS', 'SYSTEM');

  if (listing) {
    for (const fabrication of FABRICATIONS) {
      log(`  ${fabrication.name.padEnd(28)} ${fabrication.describe}`);
    }

    return;
  }

  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });

  for (const fabrication of FABRICATIONS) {
    const original = new Uint8Array(await readFile(join(source, fabrication.from)));

    // A copy per fabrication, since the edits are in place.
    const bytes = original.slice();

    fabrication.edit(bytes);
    reseal(bytes);

    let changed = 0;

    for (let at = 0; at < bytes.length; at++) {
      if (bytes[at] !== original[at]) {
        changed++;
      }
    }

    await mkdir(join(OUTPUT, fabrication.name), { recursive: true });
    await writeFile(join(OUTPUT, fabrication.name, fabrication.as), bytes);

    log(`  ${fabrication.name.padEnd(28)} ${fabrication.as}  ${changed} bytes differ`);
  }

  const built = await readdir(OUTPUT);

  log('');
  log(`${built.length} fabricated font${built.length === 1 ? '' : 's'} in ${OUTPUT}`);
  log('');
  log('Next: node scripts/oracle/record.mjs <probe> --font <name>');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
