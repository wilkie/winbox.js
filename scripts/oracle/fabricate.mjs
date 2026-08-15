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

/* ---- writing a glyph ---- */

/**
 * A few instructions, written so the programs below read as programs.
 *
 * Only what the readouts need. The stack order is the format's, which is not
 * always the order the operands are written in: `SCFS` takes the point first
 * and the coordinate second, so the point is pushed first.
 */
export const ops = {
  /** Point the projection and freedom vectors up the y axis. */
  yAxis: () => [0x00],

  /** Push a byte. */
  byte: (value) => [0xb0, value & 0xff],

  /** Push a word, which is how a 26.6 coordinate arrives. */
  word: (value) => [0xb8, (value >> 8) & 0xff, value & 0xff],

  /** Replace a control value index on the stack with its value. */
  readControlValue: () => [0x45],

  add: () => [0x60],
  subtract: () => [0x61],

  /** Multiply, where both operands and the result are in sixty-fourths. */
  multiply: () => [0x63],

  /** Set a point's coordinate along the projection vector. */
  setCoordinate: () => [0x48],

  duplicate: () => [0x20],
  pop: () => [0x21],
  swap: () => [0x23],
};

/**
 * A readout: a bar one pixel tall, placed where a computed value says.
 *
 * This is the whole trick. A glyph normally draws where its designer put it;
 * this one draws where the arithmetic puts it, so the row it lands on is the
 * answer to a question that has no other way out of GDI.
 *
 * The value is offset and magnified before it is used as a position, because a
 * pixel of cell is a pixel of resolution and that is not enough to settle a
 * question measured in sixty-fourths. Subtracting a base and multiplying by
 * eight turns an eighth of a pixel of value into a whole row of answer.
 *
 * @param {number} index - Which control value to read.
 * @param {number} base - Subtracted first, in sixty-fourths of a pixel.
 * @param {number} magnify - Multiplied after, in whole numbers.
 */
export function readoutProgram(index, base, magnify) {
  /* Worked out once and left on the stack. Recomputing it for each corner is
   * the obvious way to write this and does not fit: the full stop in Times New
   * Roman is eighty-eight bytes of glyph, and a program has to live inside the
   * one it replaces.
   */
  const value = [
    ...ops.byte(index),
    ...ops.readControlValue(),
    ...ops.word(base),
    ...ops.subtract(),
    ...ops.word(magnify * 64),
    ...ops.multiply(),
  ];

  /* `SCFS` wants the point underneath the coordinate, and the coordinate is
   * what is already on the stack -- so it is duplicated, the point pushed on
   * top, and the two swapped.
   */
  const place = (point, extra) => [
    ...ops.duplicate(),
    ...(extra ? [...ops.word(extra), ...ops.add()] : []),
    ...ops.byte(point),
    ...ops.swap(),
    ...ops.setCoordinate(),
  ];

  /* All four corners are placed outright rather than two of them moved and the
   * rest interpolated: nothing here is a real letter, so there is no shape to
   * preserve and no reason to involve `IUP`.
   */
  return [
    ...ops.yAxis(),
    ...value,
    ...place(0, 0),
    ...place(3, 0),
    ...place(1, 64),
    ...place(2, 64),
    ...ops.pop(),
  ];
}

/**
 * Replaces a glyph with a rectangle and a program.
 *
 * Written over the glyph that is already there, which bounds how long it may
 * be -- `loca` says where the next one starts and moving that would mean
 * rewriting every offset after it. The rectangles here are a fraction of the
 * length of the letters they replace, and the slack at the end is never read.
 */
export function setGlyph(bytes, font, glyph, { width, height, program }) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tablesOf(view);

  const long = view.getInt16(tables.head.offset + 50, false) !== 0;
  const loca = tables.loca.offset;

  const start = long
    ? view.getUint32(loca + glyph * 4, false)
    : view.getUint16(loca + glyph * 2, false) * 2;
  const end = long
    ? view.getUint32(loca + (glyph + 1) * 4, false)
    : view.getUint16(loca + (glyph + 1) * 2, false) * 2;

  const room = end - start;
  const at = tables.glyf.offset + start;

  const points = [
    [0, 0],
    [0, height],
    [width, height],
    [width, 0],
  ];

  const body = [];

  // One contour, its bounding box, and where it ends.
  const put16 = (value) => body.push((value >> 8) & 0xff, value & 0xff);

  put16(1);
  put16(0);
  put16(0);
  put16(width);
  put16(height);
  put16(3);

  put16(program.length);
  body.push(...program);

  // Every point on the curve, and every coordinate a signed two byte delta.
  body.push(0x01, 0x01, 0x01, 0x01);

  for (const axis of [0, 1]) {
    let previous = 0;

    for (const point of points) {
      put16(point[axis] - previous);
      previous = point[axis];
    }
  }

  if (body.length > room) {
    throw new Error(`glyph ${glyph} needs ${body.length} bytes and has ${room}`);
  }

  for (let offset = 0; offset < body.length; offset++) {
    view.setUint8(at + offset, body[offset]);
  }

  return bytes;
}

/** The glyph a character maps to, so a readout can replace the right one. */
export function glyphFor(bytes, code) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = tablesOf(view).cmap.offset;
  const count = view.getUint16(base + 2, false);

  let chosen = -1;

  for (let index = 0; index < count; index++) {
    const at = base + 4 + index * 8;

    if (view.getUint16(at, false) === 3 || chosen < 0) {
      chosen = base + view.getUint32(at + 4, false);
    }
  }

  const segments = view.getUint16(chosen + 6, false) / 2;

  const ends = chosen + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;

  for (let segment = 0; segment < segments; segment++) {
    const last = view.getUint16(ends + segment * 2, false);
    const first = view.getUint16(starts + segment * 2, false);

    if (code < first || code > last) {
      continue;
    }

    const delta = view.getInt16(deltas + segment * 2, false);
    const range = view.getUint16(ranges + segment * 2, false);

    if (range === 0) {
      return (code + delta) & 0xffff;
    }

    const glyph = view.getUint16(ranges + segment * 2 + range + (code - first) * 2, false);

    return glyph ? (glyph + delta) & 0xffff : 0;
  }

  return 0;
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
/**
 * The characters the glyph probe draws, which are the readouts available.
 *
 * Six per recording, so six questions per two minutes of DOSBox. Each can
 * carry a different base, which is what turns a sequence of yes-or-no answers
 * into a number.
 */
const READOUT_CHARACTERS = ['A', 'W', 'g', 'j', '1', '.'];

/**
 * A font whose glyphs report a control value instead of drawing a letter.
 *
 * Each character reads the same control value and places its bar at
 * `(value - base) * magnify`, with a different base. The row a bar lands on
 * says where the value sits relative to that base, and six of them at
 * increasing bases bracket it.
 */
function readout(name, { index, bases, magnify, describe }) {
  return {
    name,
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe,

    edit: (bytes) => {
      READOUT_CHARACTERS.forEach((character, at) => {
        setGlyph(bytes, null, glyphFor(bytes, character.charCodeAt(0)), {
          width: 400,
          height: 40,
          program: readoutProgram(index, bases[at], magnify),
        });
      });

      return bytes;
    },
  };
}

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

  /* The first readout, at whole pixel resolution, to check the mechanism
   * before anything is asked of it. Control value 0 scales to about 9.7
   * pixels, so with no offset and no magnification the bar should land a
   * little under ten pixels above the baseline -- and if it does, a glyph
   * that reports arithmetic instead of drawing a letter works.
   */
  readout('times-cvt0-plain', {
    index: 0,
    bases: [0, 0, 0, 0, 0, 0],
    magnify: 1,
    describe: 'control value 0 as a bar, unmagnified, to prove the readout',
  }),

  /* The measurement. Magnified sixty-four times, one whole row of answer per
   * sixty-fourth of a pixel of value, with each character offset eight
   * sixty-fourths further along so that between them they cover the range the
   * value could be in. A character whose window does not contain it puts its
   * bar off the top or below the baseline, and says so by where it lands.
   *
   * The value is known to be near 9.7 pixels, which is 622 sixty-fourths; the
   * question is whether Windows agrees or holds something three higher.
   */
  readout('times-cvt0-fine', {
    index: 0,
    bases: [608, 616, 624, 632, 640, 648],
    magnify: 64,
    describe: 'control value 0 magnified sixty-four times, to read it exactly',
  }),

  /* And the one the whole chase is about. Control value 2 is what `MIAP`
   * rounds to place the top of a `W`, and ours comes out of `prep` at 640 --
   * ten pixels exactly, which rounds to ten. Windows draws that cap at nine,
   * so its value must be 607 or less. This asks it directly.
   */
  readout('times-cvt2-fine', {
    index: 2,
    bases: [592, 600, 608, 616, 624, 632],
    magnify: 64,
    describe: 'control value 2 magnified sixty-four times, which decides a cap height',
  }),
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
