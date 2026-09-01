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
 * Where a glyph's instructions live, and how much room they have.
 *
 * A simple glyph is a count of contours, a bounding box, the index each
 * contour ends at, then the instruction length and the instructions
 * themselves, and only then the points. So shortening the instructions means
 * moving everything after them, and lengthening them means finding the room
 * first. Both are done in place inside the slot `loca` already allots.
 */
function glyphBody(bytes, glyph) {
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

  const at = tables.glyf.offset + start;
  const contours = view.getInt16(at, false);

  if (contours < 0) {
    throw new Error(`glyph ${glyph} is a composite`);
  }

  const lengthAt = at + 10 + contours * 2;
  const length = view.getUint16(lengthAt, false);

  return {
    view,
    at,
    room: end - start,
    lengthAt,
    program: at + 10 + contours * 2 + 2,
    length,
    rest: lengthAt + 2 + length,
    restLength: at + (end - start) - (lengthAt + 2 + length),
  };
}

/**
 * Rewrites one glyph's instructions, keeping its outline.
 *
 * This is what makes a differential harness possible. `hdmx` says what a
 * glyph's advance comes to once its program has run, and nothing says what any
 * intermediate point was doing -- but a program that has been cut short and
 * given a new ending can be made to report one, and Windows will run it.
 *
 * @param {Uint8Array} bytes - The whole font.
 * @param {number} glyph - Which glyph to rewrite.
 * @param {Array} code - The instructions to put there.
 */
export function setGlyphProgram(bytes, glyph, code) {
  const body = glyphBody(bytes, glyph);

  const tail = [];

  for (let offset = 0; offset < body.restLength; offset++) {
    tail.push(body.view.getUint8(body.rest + offset));
  }

  if (2 + code.length + tail.length > body.room - (body.lengthAt - body.at)) {
    throw new Error(`glyph ${glyph} program of ${code.length} does not fit`);
  }

  body.view.setUint16(body.lengthAt, code.length, false);

  let write = body.lengthAt + 2;

  for (const byte of code) {
    body.view.setUint8(write++, byte);
  }

  for (const byte of tail) {
    body.view.setUint8(write++, byte);
  }

  return bytes;
}

/**
 * Rewrites one glyph's instructions when they will not fit where they are.
 *
 * `setGlyphProgram` writes into the room `loca` already gives a glyph, which is
 * exactly what the glyph's own program fills. That is enough to shorten a
 * program or to trade its tail for a readout, and it is not enough to add one:
 * Times New Roman's `8` has twenty-three offsets its program is statically
 * balanced at and every cut with room for a readout moves the points the readout
 * exists to report, so the glyph has to get bigger instead.
 *
 * Making it bigger means rebuilding the font. `glyf` grows, every table after it
 * moves, `loca` is rewritten from the glyph onwards, and the directory has to
 * agree with all of that -- so this returns a new buffer rather than editing in
 * place, and the caller reseals it as usual.
 *
 * @param {Uint8Array} bytes - The whole font.
 * @param {number} glyph - Which glyph to rewrite.
 * @param {Array} code - The instructions to put there.
 * @returns {Uint8Array} A new font.
 */
export function growGlyphProgram(bytes, glyph, code) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tablesOf(view);
  const body = glyphBody(bytes, glyph);

  const long = view.getInt16(tables.head.offset + 50, false) !== 0;
  const count = long ? tables.loca.length / 4 - 1 : tables.loca.length / 2 - 1;

  const loca = [];

  for (let index = 0; index <= count; index++) {
    loca.push(
      long
        ? view.getUint32(tables.loca.offset + index * 4, false)
        : view.getUint16(tables.loca.offset + index * 2, false) * 2
    );
  }

  /* The glyph as three pieces: what comes before the instruction length, the
   * instructions, and the outline after them. Only the middle one changes.
   */
  const head = [];

  for (let at = body.at; at < body.lengthAt; at++) {
    head.push(view.getUint8(at));
  }

  const tail = [];

  for (let at = 0; at < body.restLength; at++) {
    tail.push(view.getUint8(body.rest + at));
  }

  const replacement = [...head, (code.length >> 8) & 0xff, code.length & 0xff, ...code, ...tail];

  // A short `loca` counts in words, so every glyph has to start on an even byte.
  while (replacement.length % 2 !== 0) {
    replacement.push(0);
  }

  const glyf = [];

  for (let at = 0; at < loca[glyph]; at++) {
    glyf.push(view.getUint8(tables.glyf.offset + at));
  }

  glyf.push(...replacement);

  for (let at = loca[glyph + 1]; at < tables.glyf.length; at++) {
    glyf.push(view.getUint8(tables.glyf.offset + at));
  }

  const moved = loca[glyph] + replacement.length - loca[glyph + 1];

  for (let index = glyph + 1; index <= count; index++) {
    loca[index] += moved;
  }

  /* A short `loca` cannot address past 128k. Rather than convert the format --
   * which changes the table's length again and every offset in it -- this
   * refuses, since no face here comes near it.
   */
  if (!long && loca[count] > 0x1fffe) {
    throw new Error(`glyf of ${loca[count]} bytes is too large for a short loca`);
  }

  const written = [];

  for (const offset of loca) {
    if (long) {
      written.push(
        (offset >>> 24) & 0xff,
        (offset >>> 16) & 0xff,
        (offset >>> 8) & 0xff,
        offset & 0xff
      );
    } else {
      written.push((offset >> 9) & 0xff, (offset >> 1) & 0xff);
    }
  }

  return rebuild(bytes, view, tables, { glyf: glyf, loca: written });
}

/**
 * A font with some of its tables replaced by longer or shorter ones.
 *
 * Everything keeps the order it had in the file, each table starting on a four
 * byte boundary as the format asks, and the directory is rewritten to match.
 */
function rebuild(bytes, view, tables, replacements) {
  const order = Object.entries(tables).sort((one, two) => one[1].offset - two[1].offset);

  let size = 12 + order.length * 16;

  const laid = order.map(([tag, table]) => {
    const content = replacements[tag] ?? null;
    const length = content ? content.length : table.length;
    const at = (size + 3) & ~3;

    size = at + length;

    return { tag, table, content, at, length };
  });

  const out = new Uint8Array((size + 3) & ~3);

  out.set(bytes.subarray(0, 12), 0);

  const fresh = new DataView(out.buffer, out.byteOffset, out.byteLength);

  laid.forEach((entry, index) => {
    const record = 12 + index * 16;

    for (let byte = 0; byte < 4; byte++) {
      fresh.setUint8(record + byte, entry.tag.charCodeAt(byte));
    }

    fresh.setUint32(record + 4, view.getUint32(entry.table.record + 4, false), false);
    fresh.setUint32(record + 8, entry.at, false);
    fresh.setUint32(record + 12, entry.length, false);

    if (entry.content) {
      out.set(Uint8Array.from(entry.content), entry.at);
    } else {
      out.set(
        bytes.subarray(entry.table.offset, entry.table.offset + entry.table.length),
        entry.at
      );
    }
  });

  return out;
}

/** A glyph's instructions, as they stand. */
export function glyphProgram(bytes, glyph) {
  const body = glyphBody(bytes, glyph);
  const code = [];

  for (let offset = 0; offset < body.length; offset++) {
    code.push(body.view.getUint8(body.program + offset));
  }

  return code;
}

/**
 * Instructions that report a point's coordinate as the glyph's advance.
 *
 * The advance is the one number a program can hand back to a caller: `hdmx`
 * tabulates it and `GetTextExtent` reports it. Moving the advance phantom to
 * wherever some other point ended up turns that channel into a probe for any
 * position in the glyph.
 *
 * Magnified, because a whole pixel of advance is a whole pixel of resolution
 * and the questions here are worth a sixty-fourth. Multiplying by eight before
 * reporting turns an eighth of a pixel into a pixel of answer.
 *
 * @param {number} point - The point to report.
 * @param {number} phantom - The index of the advance phantom.
 * @param {number} magnify - How much to multiply the coordinate by.
 */
export function reportPoint(point, phantom, magnify) {
  return [
    // Both vectors along x, so a coordinate means the x coordinate.
    0x01,
    ...ops.byte(phantom),
    ...ops.byte(point),
    0x46,

    /* The multiply is what buys the resolution, and it is also a step that can
     * be wrong on its own -- so a magnification of one leaves it out entirely
     * and reads the coordinate as it stands.
     */
    ...(magnify === 1 ? [] : [...ops.word(magnify * 64), ...ops.multiply()]),
    ...ops.setCoordinate(),
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
export function setGlyph(bytes, font, glyph, { width, height, program, points, contours, box }) {
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

  /* One contour unless several are asked for. A glyph made of two shapes says
   * something a glyph made of one cannot: whether anything the rasteriser does
   * depends on how much outline is around the stroke being measured, rather
   * than on the stroke. See `cour-crowd`.
   */
  const loops = contours ?? [
    points ?? [
      [0, 0],
      [0, height],
      [width, height],
      [width, 0],
    ],
  ];

  const corners = loops.flat();

  const body = [];

  // One contour, its bounding box, and where it ends.
  const put16 = (value) => body.push((value >> 8) & 0xff, value & 0xff);

  /* The bounding box has to be the box the points are actually in. Writing a
   * zero-based one and then placing the points elsewhere leaves `xMin`
   * disagreeing with the outline, and `xMin` is what the origin phantom is
   * computed from -- so every coordinate read out of the glyph comes back
   * shifted, by an amount too small to see at whole-pixel resolution and
   * plainly visible once magnified. That looked like an instruction misbehaving
   * for as long as it took to run the control.
   */
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);

  /* The box is the one the points are in unless a different one is asked for.
   * Writing a false one is how `cour-lies` separates what the header says from
   * what the outline is, which is otherwise impossible: Windows places a glyph
   * at `pen + lsb + (x - xMin)`, so the two always move together.
   */
  put16(loops.length);
  put16(box ? box[0] : Math.min(...xs));
  put16(box ? box[1] : Math.min(...ys));
  put16(box ? box[2] : Math.max(...xs));
  put16(box ? box[3] : Math.max(...ys));

  // Where each contour ends, as an index into the flattened list of points.
  let ended = -1;

  for (const loop of loops) {
    ended += loop.length;

    put16(ended);
  }

  put16(program.length);
  body.push(...program);

  /* Flags: bit zero says the point is on the curve. A third element of `false`
   * marks a control point, which is how a fabrication draws anything that is
   * not made of straight lines -- an arch over a scanline, say.
   */
  for (const point of corners) {
    body.push(point[2] === false ? 0x00 : 0x01);
  }

  for (const axis of [0, 1]) {
    let previous = 0;

    for (const point of corners) {
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
/**
 * Sets a glyph's left side bearing, in `hmtx`.
 *
 * A rewritten outline needs this or it will not be drawn where it was put.
 * Windows places a glyph at `pen + lsb + (x - xMin)`, so the bearing and the
 * bounding box are two statements of the same thing and a font that has been
 * edited on one side only is drawn shifted by the difference. Real fonts always
 * agree, which is why nothing noticed until a fabrication disagreed: bars
 * placed at six different offsets all came back at the same place, because the
 * offset was being cancelled by the bearing it did not match.
 *
 * @param {Uint8Array} bytes - The whole font.
 * @param {number} glyph - The glyph index.
 * @param {number} bearing - The bearing to write, in font units.
 */
export function setBearing(bytes, glyph, bearing) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tablesOf(view);
  const count = view.getUint16(tables.hhea.offset + 34, false);
  const base = tables.hmtx.offset;

  // The long entries carry an advance each; the short tail is bearings only.
  const at = glyph < count ? base + glyph * 4 + 2 : base + count * 4 + (glyph - count) * 2;

  view.setInt16(at, bearing, false);

  return bytes;
}

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

/**
 * Instructions that report a fixed number as the glyph's advance.
 *
 * The calibration for `reportPoint`. A readout says where a point is by moving
 * the advance phantom onto it, and the advance is the distance between the two
 * phantoms -- so anything that has happened to the *other* phantom lands in
 * every reading as a constant offset. Reporting a number that is known in
 * advance is the only way to find out whether there is one.
 */
export function reportConstant(value, phantom) {
  return [0x01, ...ops.byte(phantom), ...ops.word(value), ...ops.setCoordinate()];
}

/**
 * How many points a glyph's outline has, so the phantoms can be addressed.
 *
 * The phantom points are numbered straight on from the last real one, which
 * means a program that wants to move the advance has to know how many points
 * came before it. Every glyph answers differently.
 */
export function pointCount(bytes, glyph) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tablesOf(view);

  const long = view.getInt16(tables.head.offset + 50, false) !== 0;
  const loca = tables.loca.offset;

  const start = long
    ? view.getUint32(loca + glyph * 4, false)
    : view.getUint16(loca + glyph * 2, false) * 2;

  const at = tables.glyf.offset + start;
  const contours = view.getInt16(at, false);

  return view.getUint16(at + 10 + (contours - 1) * 2, false) + 1;
}

/**
 * A glyph that exists only to run one instruction and report the result.
 *
 * Reading a point out of a real letter says where that letter's program put it
 * and leaves the reason to inference. A glyph whose whole program is the
 * instruction under test says what the instruction does, because everything
 * that goes into it was chosen.
 *
 * The outline is four points in a row along the baseline, so every original
 * position is known exactly and the arithmetic can be worked out by hand for
 * whatever answer comes back.
 */
function experiment(name, { font, character, points, body, report, magnify = 8, describe }) {
  return {
    name,
    from: font,
    as: font,
    describe,

    edit: (bytes) => {
      const glyph = glyphFor(bytes, character.charCodeAt(0));

      return setGlyph(bytes, null, glyph, {
        width: Math.max(...points.map((point) => point[0])),
        height: Math.max(...points.map((point) => point[1])),
        points,
        program: [
          ...body,
          ...(magnify === 0
            ? reportConstant(16 * 64, points.length + 1)
            : reportPoint(report, points.length + 1, magnify)),
        ],
      });
    },
  };
}

/**
 * A glyph whose program reports a number it worked out, rather than a point.
 *
 * `experiment` reads a coordinate back after an instruction has moved it, which
 * suits the instructions that move points. The ones that answer onto the stack
 * -- what version of the scaler is running, what the state of something is --
 * have no point to read, so the answer is put on the advance phantom directly.
 *
 * The body is handed a stack with the phantom's number already on it and must
 * leave one number above that: the coordinate to move the phantom to, in
 * sixty-fourths. Multiplying a plain count by sixty-four and again by eight is
 * what turns an answer of two or three into a reading far enough from its
 * neighbours to be unmistakable.
 *
 * Anything in `after` runs once the answer is already on the phantom, which is
 * how a question about what happens to work already done gets asked.
 */
function stackReporter(name, { font, character, points, body, after = [], describe }) {
  return {
    name,
    from: font,
    as: font,
    describe,

    edit: (bytes) => {
      const glyph = glyphFor(bytes, character.charCodeAt(0));

      return setGlyph(bytes, null, glyph, {
        width: Math.max(...points.map((point) => point[0])),
        height: Math.max(...points.map((point) => point[1])),
        points,
        program: [
          // Along x, so the phantom's own x is what the answer becomes.
          0x01,
          ...ops.byte(points.length + 1),
          ...body,
          ...ops.setCoordinate(),
          ...after,
        ],
      });
    },
  };
}

/**
 * A fabrication that makes one letter report one of its own points.
 *
 * The glyph keeps its outline and its whole program, and gains an ending that
 * moves the advance phantom onto the point named. What Windows then reports as
 * the letter's width is that point's position, magnified -- so the `hinting`
 * probe's sweep over sizes becomes a table of where Windows put it at each of
 * them.
 *
 * Nothing else about the font changes, so the same recording still says what
 * every other letter does and can be checked against the unfabricated one.
 */
function reporter(
  name,
  { font = 'TIMES.TTF', character, point, constant, cut, magnify, describe }
) {
  return {
    name,
    from: font,
    as: font,
    describe,

    edit: (bytes) => {
      const glyph = glyphFor(bytes, character.charCodeAt(0));
      const full = glyphProgram(bytes, glyph);

      /* The readout has to go somewhere, and `loca` gives a glyph exactly the
       * room its own program already fills -- Times New Roman's `w` has not a
       * byte to spare. So the tail comes off to make space.
       *
       * Where it comes off matters more than how much. The first attempt cut
       * inside a conditional, which put the readout in a branch that half the
       * sizes never entered; those sizes reported the advance the glyph would
       * have had anyway, which looks like a reading and is not one. The cut has
       * to be at a point the program is statically balanced at -- every `IF`
       * opened before it also closed -- and 717 is the last such point with
       * room for the readout.
       *
       * Whether the truncation disturbs the point being reported is not assumed.
       * Our own interpreter runs the full program and the fabricated one, and
       * the two agree on this point at every size, which is what makes the
       * reading mean anything.
       */
      const ending =
        constant === undefined
          ? reportPoint(point, pointCount(bytes, glyph) + 1, magnify)
          : reportConstant(constant, pointCount(bytes, glyph) + 1);

      const code = [...full.slice(0, cut), ...ending];

      if (code.length > full.length) {
        throw new Error(`readout of ${code.length} does not fit in ${full.length}`);
      }

      return setGlyphProgram(bytes, glyph, code);
    },
  };
}

/**
 * Hides a table from Windows by renaming it.
 *
 * A readout only says anything at a size where the program actually runs, and
 * `hdmx` is a cache of what the program would have come to -- so a size the
 * table covers is answered without running anything. Times New Roman's table
 * leaves gaps and Arial's does not, which is why the eight could be read at
 * seven sizes and the seven at none.
 *
 * Renaming the tag rather than removing the table keeps every offset in the
 * directory valid and every other table where it was; the loader simply does
 * not find it. `reseal` puts the checksums right afterwards.
 */
export function dropTable(bytes, tag) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table = tablesOf(view)[tag];

  if (!table) {
    throw new Error(`font has no ${tag} table`);
  }

  // Reversed, so it is obvious in a hex dump what was done and to what.
  for (let byte = 0; byte < 4; byte++) {
    view.setUint8(table.record + byte, tag.charCodeAt(3 - byte));
  }

  return bytes;
}

/**
 * A letter reporting one of its own points, with its program intact.
 *
 * `reporter` trades the tail of a program for the readout, which is fine when
 * the point being read is settled by then. Times New Roman's `8` is not: every
 * cut with room for a readout moves the waist. So this keeps the whole program
 * and grows the glyph instead, and reads y rather than x, because the waist is
 * a height.
 *
 * Reading y and reporting it needs both vectors twice over. `GC` measures along
 * the projection vector, so the vectors go up y to read the point; the advance
 * is a distance in x, so they go back along x before `SCFS` moves the phantom.
 */
function pointReporter(
  name,
  { font = 'TIMES.TTF', character, point, axis = 'y', magnify = 64, drop, describe }
) {
  return {
    name,
    from: font,
    as: font,
    describe,

    edit: (bytes) => {
      const glyph = glyphFor(bytes, character.charCodeAt(0));
      const phantom = pointCount(bytes, glyph) + 1;

      const ending = [
        // Along the axis being read, so `GC` measures the coordinate wanted.
        ...(axis === 'y' ? ops.yAxis() : [0x01]),
        ...ops.byte(phantom),
        ...ops.byte(point),
        0x46,
        ...(magnify === 1 ? [] : [...ops.word(magnify * 64), ...ops.multiply()]),
        // Back along x, so the coordinate set is the one the advance is made of.
        0x01,
        ...ops.setCoordinate(),
      ];

      const grown = growGlyphProgram(bytes, glyph, [...glyphProgram(bytes, glyph), ...ending]);

      for (const tag of drop ?? []) {
        dropTable(grown, tag);
      }

      return grown;
    },
  };
}

export const FABRICATIONS = [
  pointReporter('times-y-tail-right', {
    character: 'y',
    point: 26,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Times New Roman's y reporting the right of its descender tail",
  }),
  pointReporter('times-y-tail-depth', {
    character: 'y',
    point: 29,
    axis: 'y',
    drop: ['hdmx', 'LTSH'],
    describe: "Times New Roman's y reporting how deep its descender tail reaches",
  }),
  pointReporter('times-y-tail-c27', {
    character: 'y',
    point: 27,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Times New Roman's y reporting the upper control of its tail curve",
  }),
  pointReporter('times-y-tail-c28', {
    character: 'y',
    point: 28,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Times New Roman's y reporting the lower control of its tail curve",
  }),
  pointReporter('times-y-tail-foot', {
    character: 'y',
    point: 29,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Times New Roman's y reporting the foot of its descender tail",
  }),
  pointReporter('cour-g-tail-left', {
    font: 'COUR.TTF',
    character: 'g',
    point: 20,
    axis: 'x',
    describe: "Courier New's g reporting the leftmost point of its descender tail",
  }),
  pointReporter('times-W-interpolated', {
    character: 'W',
    point: 23,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Times New Roman's W reporting a point the two IUP rules disagree about",
  }),
  pointReporter('arial-7-anchor-high', {
    font: 'ARIAL.TTF',
    character: '7',
    point: 13,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Arial's 7 reporting the upper anchor its left diagonal interpolates from",
  }),
  pointReporter('arial-7-diagonal-right', {
    font: 'ARIAL.TTF',
    character: '7',
    point: 5,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Arial's 7 reporting the control point of its right diagonal",
  }),
  pointReporter('arial-7-diagonal-left', {
    font: 'ARIAL.TTF',
    character: '7',
    point: 11,
    axis: 'x',
    drop: ['hdmx', 'LTSH'],
    describe: "Arial's 7 reporting the control point of its left diagonal",
  }),
  pointReporter('times-8-waist-upper', {
    character: '8',
    point: 26,
    describe: "Times New Roman's 8 reporting the foot of its upper counter",
  }),
  pointReporter('times-8-waist-lower', {
    character: '8',
    point: 39,
    describe: "Times New Roman's 8 reporting the head of its lower counter",
  }),
  /* One lean, both directions, eighteen phases each: the distance to a centre
   * swept on its own.
   *
   * The rule misses only where the edge has more than half a pixel to travel
   * before it meets a centre, and only when the stroke leans left. Every font
   * so far varies that distance as a side effect of varying something else --
   * the offset, the width, the direction -- so it has never been the thing on
   * the axis.
   *
   * Here it is. The lean is fixed at a quarter of the height, which puts the
   * travel at a pixel at the smallest size and two and a half at the largest,
   * inside the band or near it throughout. The width and height are fixed. The
   * only thing that changes is where the stroke starts, in eighteen steps of a
   * fourteenth of a pixel, in each direction -- so the distance to a centre
   * sweeps its whole range twice over, once each way, with nothing else moving.
   */
  {
    name: 'cour-phases',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New sweeping the distance to a pixel centre, both directions',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const SLANT = 256;
      const WIDTH = 80;
      const TALL = 1400;
      const STEP = 14;
      const BASE = 600;

      for (let index = 0; index < WIDE.length; index++) {
        const rightward = index < WIDE.length / 2;
        const start = BASE + (index % 18) * STEP;

        const points = rightward
          ? [
              [start, 0],
              [start + SLANT, TALL],
              [start + SLANT + WIDTH, TALL],
              [start + WIDTH, 0],
            ]
          : [
              [start + SLANT, 0],
              [start, TALL],
              [start + WIDTH, TALL],
              [start + SLANT + WIDTH, 0],
            ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, start);
      }

      return bytes;
    },
  },

  /* The mirror pairs again, this time inside the band.
   *
   * The first mirror font holds everything but the direction fixed and finds no
   * difference -- but every stroke in it travels two pixels or more, and the
   * rule's misses are all in the half-to-two band. So it tested the direction
   * where the direction was never in doubt.
   *
   * These are the same matched pairs with the leans cut to land in the band:
   * three magnitudes against six offsets, in both directions, one width, one
   * height.
   */
  {
    name: 'cour-mirrorband',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with matched pairs of strokes leaning each way, in the band',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const OFFSETS = [600, 643, 685, 728, 771, 813];
      const SLANTS = [140, 240, 380];
      const WIDTH = 80;
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const rightward = index < WIDE.length / 2;
        const within = index % 18;
        const start = OFFSETS[within % OFFSETS.length];
        const slant = SLANTS[Math.floor(within / OFFSETS.length) % SLANTS.length];

        const points = rightward
          ? [
              [start, 0],
              [start + slant, TALL],
              [start + slant + WIDTH, TALL],
              [start + WIDTH, 0],
            ]
          : [
              [start + slant, 0],
              [start, TALL],
              [start + WIDTH, TALL],
              [start + slant + WIDTH, 0],
            ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, start);
      }

      return bytes;
    },
  },

  /* Left-leaning strokes in the band where the rule fails.
   *
   * Splitting the rule's misses by shift and direction puts them all in one
   * cell: strokes leaning left whose edge travels between half a pixel and two
   * pixels over the stroke, where it accounts for 22 of 34. Everywhere else it
   * is 96% or better and mostly exact. That band is also the least sampled --
   * the left-leaning font's smallest lean already travels three quarters of a
   * pixel at the smallest size, and the mirror font's smallest travels two.
   *
   * Six leans chosen to land in the band across the probe's sizes, against six
   * offsets so the phase sweeps, all leaning left.
   */
  {
    name: 'cour-leftband',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with left-leaning strokes in the band the rule misses',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const OFFSETS = [600, 643, 685, 728, 771, 813];
      const SLANTS = [60, 100, 160, 240, 350, 500];
      const WIDTH = 80;
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const start = OFFSETS[index % OFFSETS.length];
        const slant = SLANTS[Math.floor(index / OFFSETS.length) % SLANTS.length];

        // Head at the offset, foot a slant to the right: leaning left.
        const points = [
          [start + slant, 0],
          [start, TALL],
          [start + WIDTH, TALL],
          [start + slant + WIDTH, 0],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, start);
      }

      return bytes;
    },
  },

  /* Eighteen strokes leaning right against eighteen leaning left, alike in
   * everything else.
   *
   * The two slant fonts differ in more than their direction -- they start at
   * different places and so present different phases -- which is enough to
   * leave a comparison between them arguable. Here the same width, the same
   * height, the same three lean magnitudes and the same six starting offsets
   * appear in both directions, so every stroke has a mirror twin that differs
   * from it in nothing else.
   *
   * Both forms are wound clockwise and both have the same bounding box: the
   * right-leaning one puts its foot at the offset and its head a slant to the
   * right, the left-leaning one puts its head at the offset and its foot a
   * slant to the right. The leans are large on purpose -- between two and five
   * pixels of travel over the stroke -- because that is where the rule says
   * left with an enormous margin and the left-leaning strokes say right anyway.
   */
  {
    name: 'cour-mirror',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with matched pairs of strokes leaning each way',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const OFFSETS = [600, 643, 685, 728, 771, 813];
      const SLANTS = [700, 1000, 1400];
      const WIDTH = 80;
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const rightward = index < WIDE.length / 2;
        const within = index % 18;
        const start = OFFSETS[within % OFFSETS.length];
        const slant = SLANTS[Math.floor(within / OFFSETS.length) % SLANTS.length];

        const points = rightward
          ? [
              [start, 0],
              [start + slant, TALL],
              [start + slant + WIDTH, TALL],
              [start + WIDTH, 0],
            ]
          : [
              [start + slant, 0],
              [start, TALL],
              [start + WIDTH, TALL],
              [start + slant + WIDTH, 0],
            ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, start);
      }

      return bytes;
    },
  },

  /* Width against height, at one lean, to separate two things that had been
   * growing together.
   *
   * With the width fixed in design units, a bigger size makes the stroke both
   * wider in pixels and taller in rows, and the left answers arrive with both.
   * Only one of them can be what matters, and no font that scales a fixed shape
   * can say which.
   *
   * This one varies them against each other: six design widths against six
   * heights, so that at any one size the strokes differ in width, and the same
   * width appears at several heights. The lean is held at about a
   * thirty-second of a pixel per row -- the value that gave the most even mix
   * of the two answers -- which means the slant has to be scaled with the
   * height to keep the ratio the same.
   */
  {
    name: 'cour-shapes',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with bars of six widths against six heights, at one lean',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [40, 80, 120, 160, 200, 240];
      const HEIGHTS = [300, 500, 800, 1100, 1400, 1800];
      const LEAN = 0.032;
      const START = 600;

      for (let index = 0; index < WIDE.length; index++) {
        const width = WIDTHS[index % WIDTHS.length];
        const height = HEIGHTS[Math.floor(index / WIDTHS.length) % HEIGHTS.length];
        const slant = Math.round(LEAN * height);

        const points = [
          [START, 0],
          [START + slant, height],
          [START + slant + width, height],
          [START + width, 0],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, START);
      }

      return bytes;
    },
  },

  /* Bars that lean a little, at six starting offsets, to fill a hole the other
   * fonts left.
   *
   * The branch between the two candidate pixels is separable by `u` -- how far
   * the span's start sits past the pixel centre below it -- only where both
   * answers occur at the same lean. In the earlier slant fonts the starting
   * offset was the same for all thirty-six glyphs, so `u` is very nearly a
   * function of the size alone and each font samples about seven values of it.
   * At the smallest leans none of those seven happened to be small, so there
   * were no left answers at all, and a threshold search on a class with no
   * members returns whatever it was handed. It returned 0.137, and 0.137 was
   * read as a constant.
   *
   * This one varies the offset instead of the width: six leans against six
   * offsets, spaced a sixth of a pixel apart at eight pixels per em so that `u`
   * sweeps its whole range at every lean. The width is fixed, which costs the
   * third variable and buys the first one properly.
   */
  {
    name: 'cour-offsets',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with bars leaning a little, at six sub-pixel offsets',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      // A pixel is 256 design units at eight pixels per em.
      const OFFSETS = [600, 643, 685, 728, 771, 813];
      const SLANTS = [2, 5, 12, 21, 30, 45];
      const WIDTH = 80;
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const start = OFFSETS[index % OFFSETS.length];
        const slant = SLANTS[Math.floor(index / OFFSETS.length) % SLANTS.length];

        const points = [
          [start, 0],
          [start + slant, TALL],
          [start + slant + WIDTH, TALL],
          [start + WIDTH, 0],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, start);
      }

      return bytes;
    },
  },

  /* Bars that lean by almost nothing, to ask whether the rasteriser tests for
   * an upright edge or merely fails to notice a small one.
   *
   * An upright stroke's dropout takes the pixel to the right of the gap and a
   * leaning one takes the pixel to the left, whichever way it leans -- so the
   * thing that decides is the slope's magnitude and not its sign. Two shapes of
   * explanation fit that. Either the rasteriser has a separate path for a
   * vertical edge, which is worth having because a stem is the commonest thing
   * in a font and needs no walk at all; or there is one path and something in
   * it is sensitive to how far the edge moves in a row.
   *
   * They differ at the smallest lean. A test for `dx == 0` puts a stroke that
   * leans by a fiftieth of a pixel per row with the slanted ones; a threshold,
   * or an accumulator that has to overflow before it moves anything, puts it
   * with the upright ones. The slants here go down to two design units over
   * fourteen hundred -- about a five-hundredth of a pixel per row at the sizes
   * the probe draws.
   */
  {
    name: 'cour-hairslants',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with its letters replaced by bars leaning by almost nothing',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [40, 60, 80, 100, 120, 140];
      const SLANTS = [0, 2, 5, 12, 30, 80];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const width = WIDTHS[index % WIDTHS.length];
        const slant = SLANTS[Math.floor(index / WIDTHS.length) % SLANTS.length];

        const points = [
          [600, 0],
          [600 + slant, TALL],
          [600 + slant + width, TALL],
          [600 + width, 0],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, 600);
      }

      return bytes;
    },
  },

  /* The same slanted bars leaning the other way.
   *
   * Leaning right, the rescued pixel is the one to the *left* of the span at
   * every slant tried; upright, it is the one to the right. Either the rule
   * knows which way the stroke leans, or it knows something else that upright
   * bars happen not to have. Bars leaning left separate those.
   */
  {
    name: 'cour-backslants',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with its letters replaced by bars leaning the other way',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [40, 60, 80, 100, 120, 140];
      const SLANTS = [0, -200, -400, -700, -1000, -1400];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const width = WIDTHS[index % WIDTHS.length];
        const slant = SLANTS[Math.floor(index / WIDTHS.length) % SLANTS.length];

        const points = [
          [1700, 0],
          [1700 + slant, TALL],
          [1700 + slant + width, TALL],
          [1700 + width, 0],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));
        const left = Math.min(...points.map((point) => point[0]));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, left);
      }

      return bytes;
    },
  },

  /* Thirty-six slanted bars, to ask whether a rescued pixel remembers the row
   * above it.
   *
   * The upright bars and the wedges between them settled which spans get
   * rescued and left one thing open: which pixel a rescued span turns on when
   * its edges slant. No function of the span's two endpoints fits both fonts,
   * an incremental edge walk gives the same answer an exact solve does, and the
   * winding makes no difference -- so the deciding information is somewhere
   * other than the span, and the candidate left is state carried down the
   * scanlines.
   *
   * Neither existing font can test that. A bar's span never moves, so following
   * the geometry and following the row above are the same thing; a wedge has
   * only one rescued row, so there is no row above to follow.
   *
   * A parallelogram has both. Its horizontal cut is the same width at every
   * row -- so the span is a stroke, not a taper -- and it walks sideways by a
   * fixed amount per row, so a column of rescued pixels has to either step
   * where the geometry steps or step where the row above did. Six widths
   * against six slants, from upright (which reproduces the bar font, as the
   * control) to forty-five degrees.
   */
  {
    name: 'cour-slants',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with its letters replaced by slanted bars of known width',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [40, 60, 80, 100, 120, 140];
      const SLANTS = [0, 200, 400, 700, 1000, 1400];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const width = WIDTHS[index % WIDTHS.length];
        const slant = SLANTS[Math.floor(index / WIDTHS.length) % SLANTS.length];

        // Clockwise, the way an outer contour is meant to go.
        const points = [
          [300, 0],
          [300 + slant, TALL],
          [300 + slant + width, TALL],
          [300 + width, 0],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, 300);
      }

      return bytes;
    },
  },

  /* Thirty-six wedges, which is the other half of the bar experiment.
   *
   * The bars answer "does Windows rescue a stroke too thin to cover a pixel
   * centre", and they answer it yes, at every width and without a threshold in
   * sight. They cannot answer "does it refuse a *stub*", because a rectangle
   * has no tips: every span in that font is a genuine stroke.
   *
   * A triangle is nothing but a tip. Scanlines up it give spans that narrow
   * continuously to nothing, and the apex is a local extremum in y -- which is
   * the shape every description of the stub rule is describing. If Windows inks
   * every one of those rows, tips are rescued too and the refusal in real
   * letters is not about tips at all; if it stops, where it stops is the rule,
   * read off directly instead of fitted.
   *
   * Six base widths against six heights, so the taper varies from blunt to
   * sharp and the width at a given row is separable from how far that row is
   * from the apex.
   */
  {
    name: 'cour-wedges',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with its letters replaced by wedges tapering to a point',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const BASES = [200, 300, 400, 500, 600, 700];
      const HEIGHTS = [400, 600, 800, 1000, 1200, 1400];

      for (let index = 0; index < WIDE.length; index++) {
        const base = BASES[index % BASES.length];
        const height = HEIGHTS[Math.floor(index / BASES.length) % HEIGHTS.length];

        /* Clockwise, which is what TrueType asks an outer contour to be.
         *
         * The first version of this went the other way round, and the font was
         * malformed in a way that nothing complains about: the fill is
         * non-zero winding, so a reversed contour still comes out solid and
         * every rescue decision still looks reasonable. What it changed was
         * which of the two crossings the rasteriser calls the left edge, and
         * that is exactly what the pixel choice turns on. The bars were
         * clockwise by luck of how a rectangle is easiest to write down, so
         * the two fonts disagreed about the pixel for a reason that had
         * nothing to do with slanted edges.
         */
        const points = [
          [300, 0],
          [300 + Math.floor(base / 2), height],
          [300 + base, 0],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, 300);
      }

      return bytes;
    },
  },

  /* Thirty-six bars, to ask about dropout control with one variable at a time.
   *
   * The stub rule has now failed to fit three ways -- by width, by topology and
   * by the direction of the two bounding edges -- and every attempt has been an
   * inference from letters, where each scanline crosses several strokes of
   * different widths at different angles next to tips of their own. A letter
   * cannot separate them.
   *
   * A bar can. Each of the thirty-six characters the glyph probe draws becomes
   * a single rectangle of a chosen width at a chosen sub-pixel offset: the
   * first eighteen upright, so a scanline across one is a span of known width
   * and known phase, and the last eighteen on their side for the sweep down
   * columns. Nothing else is in the glyph -- no program, so nothing is
   * grid-fitted and the outline is exactly what was asked for; no second
   * contour, so no winding to reason about; no tips at all, so **every span is
   * a genuine stroke and nothing in the font is a stub**.
   *
   * That last is the point. If Windows rescues all of them the rescue is not a
   * function of width and the whole rule is about shape, which is a thing the
   * letters cannot say and this says in one recording. If it refuses some, the
   * width and phase at which it starts refusing are read straight off.
   *
   * Seven cells in the probe give seven pixel sizes for each bar, so the six
   * widths cover about a sixth of a pixel to a pixel and a half.
   */
  {
    name: 'cour-bars',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with its letters replaced by bars of known width and offset',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      // In design units, with 2,048 to the em: at eight pixels per em a pixel
      // is 256 of them, so these are a sixth to a half of one.
      const WIDTHS = [40, 60, 80, 100, 120, 140];
      const PHASES = [0, 85, 170];

      for (let index = 0; index < WIDE.length; index++) {
        const width = WIDTHS[index % WIDTHS.length];
        const phase = PHASES[Math.floor(index / WIDTHS.length) % PHASES.length];
        const upright = index < WIDE.length / 2;

        const low = 600 + phase;

        const points = upright
          ? [
              [low, 0],
              [low, 1400],
              [low + width, 1400],
              [low + width, 0],
            ]
          : [
              [200, low],
              [200, low + width],
              [1800, low + width],
              [1800, low],
            ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });

        /* The bearing has to say the same thing the box does, or Windows draws
         * the bar at `pen + lsb` and the offset chosen above is cancelled.
         */
        setBearing(bytes, glyph, Math.min(...points.map((point) => point[0])));
      }

      return bytes;
    },
  },

  /* The same bar, drawn three ways, to ask whether the rest of the outline
   * matters.
   *
   * Everything else has been ruled out. A lone fabricated bar and a real
   * letter's stem can present the rasteriser with the same span, at the same
   * size, in the same font, with the same lean, the same winding, the same
   * placement verified to an eighth of a pixel and nothing else in the row --
   * and Windows inks a different pixel. No function of the span's two edges
   * fits both; the family was searched, not guessed at. See `FONTS.md`.
   *
   * The one difference left is that a shape font's glyph is a single contour of
   * three or four points and a letter is several contours of dozens. That is
   * not a property a scan converter ought to notice, which is exactly why it
   * has to be measured rather than argued about.
   *
   * So: twelve widths and phases, each drawn three times.
   *
   *  - **plain**, four points, one contour -- the control, and the same shape
   *    the bar font already recorded, so a disagreement with it would mean
   *    something else had moved;
   *  - **subdivided**, the identical rectangle with four extra collinear points
   *    up each side, so the outline has twelve points and describes exactly the
   *    same region -- every crossing the rasteriser computes is unchanged, to
   *    the last bit;
   *  - **crowded**, the plain bar plus a second contour in the descender, well
   *    below the baseline and well to the left, sharing no scanline and no
   *    column with the bar.
   *
   * If the three groups agree, outline complexity is not it and the bars are
   * sound. If the plain group takes one pixel and the other two take the other,
   * the rasteriser is answering a question about the glyph rather than about
   * the stroke, and every rule tried so far has been the wrong shape.
   */
  {
    name: 'cour-crowd',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with one bar drawn plain, subdivided, and beside a second contour',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      // The same widths and phases the bar font used, so the two can be compared.
      const WIDTHS = [40, 80, 120, 140];
      const PHASES = [0, 85, 170];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const variant = Math.floor(index / 12);
        const which = index % 12;
        const width = WIDTHS[which % WIDTHS.length];
        const phase = PHASES[Math.floor(which / WIDTHS.length)];
        const low = 600 + phase;

        const plain = [
          [low, 0],
          [low, TALL],
          [low + width, TALL],
          [low + width, 0],
        ];

        /* Four extra points up each side, on the line and evenly spaced. The
         * region is identical; only the number of segments describing it is not.
         */
        const step = TALL / 5;
        const subdivided = [
          ...[0, 1, 2, 3, 4, 5].map((at) => [low, Math.round(at * step)]),
          ...[5, 4, 3, 2, 1, 0].map((at) => [low + width, Math.round(at * step)]),
        ];

        /* Somewhere no scanline crossing the bar can reach: below the baseline,
         * where the bar has nothing, and left of it, where the bar has nothing.
         */
        const elsewhere = [
          [100, -400],
          [100, -200],
          [300, -200],
          [300, -400],
        ];

        const loops = variant === 0 ? [plain] : variant === 1 ? [subdivided] : [plain, elsewhere];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, contours: loops, program: [] });
        setBearing(bytes, glyph, Math.min(...loops.flat().map((point) => point[0])));
      }

      return bytes;
    },
  },

  /* Why a second contour changes the drawing, which `cour-crowd` established
   * that it does.
   *
   * That font moved the second contour far to the left and well below the
   * baseline, so it changed three things at once: the glyph gained a contour,
   * its `xMin` fell from 685 to 100, and its `yMin` fell from 0 to −400. Any of
   * the three could be what the rasteriser is reacting to, and they can be
   * separated by moving the extra contour rather than by adding more of them.
   *
   * Six widths and phases, each drawn six ways. Every extra contour is kept out
   * of the rows the bar occupies -- below the baseline, or above the ascender --
   * so the bar's own crossings are identical in all six.
   *
   *  - **plain**: the bar alone, one contour, as the control;
   *  - **far**: a second contour low and to the left, which is what `cour-crowd`
   *    did -- `xMin` and `yMin` both move;
   *  - **near**: the same contour just left of the bar, so `xMin` moves a
   *    little rather than a lot and `yMin` moves the same as `far`;
   *  - **under**: directly beneath the bar at its own x, so `xMin` does not move
   *    at all and only `yMin` does;
   *  - **over**: directly above the bar at its own x, so only `yMax` moves and
   *    `yMin` does not;
   *  - **three**: the bar and two extra contours, to ask whether the effect
   *    counts contours or merely notices that there is more than one.
   *
   * If `under` behaves like `far`, the bounding box in x is not it. If `over`
   * behaves like `plain`, the direction the box grows matters. If `three`
   * behaves like `far`, the count does not.
   */
  /* A glyph one column wide with a hole in it, and the hole swept.
   *
   * `cour-boxes` and `cour-widths` both leave a hole where they should not: a
   * sub-pixel bar with a second contour below it comes out with a gap in the
   * column of ink, and Windows draws it solid. Filling every such column from
   * its topmost ink to its bottommost fixes them and is fitted rather than
   * read -- "fill the column" is one of several rules that would close those
   * particular gaps, and nothing in either fabrication tells them apart.
   *
   * This does. Two pieces of one sub-pixel bar with a gap between them, swept
   * from a quarter of a pixel to six at the smallest size and proportionally
   * less at the largest, at three phases. If Windows closes every gap the rule
   * is right and can be written down as what it does. If it stops somewhere,
   * the threshold is what the sweep reports, and the rule as written is wrong
   * about everything past it.
   */
  {
    name: 'cour-gaps',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with a sub-pixel bar split by a gap of swept height',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      // A quarter of a pixel to six, at eight per em where a pixel is 256.
      const GAPS = [64, 128, 192, 256, 384, 512, 640, 768, 896, 1024, 1280, 1536];
      const PHASES = [0, 85, 170];
      const THIN = 40;
      const FOOT = 400;
      const HEAD = 600;

      for (let index = 0; index < WIDE.length; index++) {
        const gap = GAPS[index % GAPS.length];
        const phase = PHASES[Math.floor(index / GAPS.length) % PHASES.length];
        const left = 600 + phase;
        const right = left + THIN;

        const piece = (low, high) => [
          [left, low],
          [left, high],
          [right, high],
          [right, low],
        ];

        const loops = [piece(0, FOOT), piece(FOOT + gap, FOOT + gap + HEAD)];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, contours: loops, program: [] });
        setBearing(bytes, glyph, left);
      }

      return bytes;
    },
  },

  {
    name: 'cour-boxes',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with one bar and an extra contour moved about to isolate why it matters',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [40, 80, 140];
      const PHASES = [85, 170];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const variant = Math.floor(index / 6);
        const which = index % 6;
        const width = WIDTHS[which % WIDTHS.length];
        const phase = PHASES[Math.floor(which / WIDTHS.length)];
        const low = 600 + phase;

        const bar = [
          [low, 0],
          [low, TALL],
          [low + width, TALL],
          [low + width, 0],
        ];

        // A small box, wherever it is asked for, wound the same way as the bar.
        const box = (x0, x1, y0, y1) => [
          [x0, y0],
          [x0, y1],
          [x1, y1],
          [x1, y0],
        ];

        const far = box(100, 300, -400, -200);
        const near = box(low - 200, low - 20, -400, -200);
        const under = box(low, low + width, -400, -200);
        const over = box(low, low + width, TALL + 100, TALL + 300);

        const loops = [[bar], [bar, far], [bar, near], [bar, under], [bar, over], [bar, far, over]][
          variant
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, contours: loops, program: [] });
        setBearing(bytes, glyph, Math.min(...loops.flat().map((point) => point[0])));
      }

      return bytes;
    },
  },

  /* What the header says against what the outline is.
   *
   * `cour-boxes` narrowed it: an extra contour above or below the bar changes
   * nothing at all, one to its left changes the drawing, and far and near
   * change it identically. So it is the glyph's left extent that matters, not
   * how many contours there are nor how far away they sit.
   *
   * But `xMin` and the left side bearing always move together -- Windows places
   * a glyph at `pen + lsb + (x - xMin)`, and a fabrication that keeps the bar
   * where it was has to change both. Writing a false `xMin` into the glyph
   * header separates them, because the outline is then not where the header
   * says it begins.
   *
   *  - **plain**: the bar, its true box, `lsb` matching -- the control;
   *  - **lying**: the same single-contour bar, unchanged to the last point, with
   *    `xMin` written as 100 and `lsb` written as 100 to match, so the bar lands
   *    in exactly the same place and only the header differs;
   *  - **crowded**: the bar with a real second contour out at 100, which is what
   *    `cour-boxes` called `far`.
   *
   * If lying behaves like crowded, it is the number in the header and the
   * arithmetic done with it. If lying behaves like plain, the header is
   * innocent and something about a real second contour is what counts.
   */
  {
    name: 'cour-lies',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with a bar whose header claims a wider box than its outline has',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [40, 80, 120, 140];
      const PHASES = [0, 85, 170];
      const TALL = 1400;
      const CLAIM = 100;

      for (let index = 0; index < WIDE.length; index++) {
        const variant = Math.floor(index / 12);
        const which = index % 12;
        const width = WIDTHS[which % WIDTHS.length];
        const phase = PHASES[Math.floor(which / WIDTHS.length)];
        const low = 600 + phase;

        const bar = [
          [low, 0],
          [low, TALL],
          [low + width, TALL],
          [low + width, 0],
        ];

        const far = [
          [CLAIM, -400],
          [CLAIM, -200],
          [CLAIM + 200, -200],
          [CLAIM + 200, -400],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        if (variant === 1) {
          setGlyph(bytes, null, glyph, {
            width: 0,
            height: 0,
            contours: [bar],
            program: [],
            box: [CLAIM, -400, low + width, TALL],
          });
          setBearing(bytes, glyph, CLAIM);
        } else {
          const loops = variant === 0 ? [bar] : [bar, far];

          setGlyph(bytes, null, glyph, { width: 0, height: 0, contours: loops, program: [] });
          setBearing(bytes, glyph, Math.min(...loops.flat().map((point) => point[0])));
        }
      }

      return bytes;
    },
  },

  /* Which side the extra contour is on.
   *
   * `cour-lies` showed the glyph header is innocent -- a single bar whose box
   * and bearing both claim to start at 100 draws exactly as one that tells the
   * truth, in all 84 comparisons. So it takes a real contour, and `cour-boxes`
   * showed one directly above or below the bar does nothing while one to its
   * left changes the drawing whether it is near or far.
   *
   * That was never tested on the other side, and "anything to the left" and
   * "anything not directly above or below" are different claims. Six widths and
   * phases, six placements, every extra contour kept out of the bar's own rows:
   *
   *  - **plain**, the bar alone;
   *  - **left**, a box out at 100, below the baseline -- the known case;
   *  - **right**, the mirror of it, out beyond the bar at 1700;
   *  - **rightNear**, just beyond the bar's right edge;
   *  - **leftAbove**, out at 100 but above the ascender rather than below the
   *    baseline, to ask whether the side is about x alone;
   *  - **both**, one box on each side.
   */
  {
    name: 'cour-sides',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with a bar and an extra contour to its left, its right, or both',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [40, 80, 140];
      const PHASES = [85, 170];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const variant = Math.floor(index / 6);
        const which = index % 6;
        const width = WIDTHS[which % WIDTHS.length];
        const phase = PHASES[Math.floor(which / WIDTHS.length)];
        const low = 600 + phase;

        const bar = [
          [low, 0],
          [low, TALL],
          [low + width, TALL],
          [low + width, 0],
        ];

        const box = (x0, x1, y0, y1) => [
          [x0, y0],
          [x0, y1],
          [x1, y1],
          [x1, y0],
        ];

        const left = box(100, 300, -400, -200);
        const right = box(1700, 1900, -400, -200);
        const rightNear = box(low + width + 20, low + width + 200, -400, -200);
        const leftAbove = box(100, 300, TALL + 100, TALL + 300);

        const loops = [
          [bar],
          [bar, left],
          [bar, right],
          [bar, rightNear],
          [bar, leftAbove],
          [bar, left, right],
        ][variant];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, contours: loops, program: [] });
        setBearing(bytes, glyph, Math.min(...loops.flat().map((point) => point[0])));
      }

      return bytes;
    },
  },

  /* Where stub exclusion switches on, as a function of the glyph's width.
   *
   * `cour-sides` narrowed it to this: a glyph wide enough loses the first and
   * last row of its stroke and takes the other candidate pixel, and a narrow one
   * does neither. The narrow case is very narrow indeed -- a lone bar is forty
   * to a hundred and forty design units across, which is a sixth to a half of a
   * pixel at the sizes recorded, so the whole glyph is thinner than the grid it
   * is drawn on. The obvious threshold to look for is one pixel.
   *
   * So: the same bar in the same place in all thirty-six glyphs, and a small box
   * below the baseline whose distance from it sweeps the glyph's total width
   * from a quarter of a pixel to about three. The box sits to the **right**, so
   * `xMin` never moves and the bar's placement is identical everywhere -- the
   * only thing changing is how wide the glyph is. Seven recorded sizes turn
   * thirty-six widths in design units into a fine sweep in pixels.
   */
  {
    name: 'cour-widths',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe:
      'Courier New with one bar and a box sweeping the glyph width from a quarter pixel to three',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const LOW = 685;
      const BAR = 40;
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        // The glyph's whole width, in design units: 60 to 795, evenly.
        const span = 60 + index * 21;

        const bar = [
          [LOW, 0],
          [LOW, TALL],
          [LOW + BAR, TALL],
          [LOW + BAR, 0],
        ];

        /* Twenty units wide, ending exactly where the glyph is meant to, and
         * below the baseline so it shares no row with the bar.
         */
        const right = LOW + span;
        const box = [
          [right - 20, -400],
          [right - 20, -200],
          [right, -200],
          [right, -400],
        ];

        const loops = span <= BAR ? [bar] : [bar, box];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, contours: loops, program: [] });
        setBearing(bytes, glyph, LOW);
      }

      return bytes;
    },
  },

  /* Near-horizontal strokes that are curves rather than bars.
   *
   * More than half of what is still wrong about the recorded letters is pixels
   * Windows inks where nothing here produces a span at all: a stroke lying
   * between two scanlines, half to one pixel tall, missing the nearer by less
   * than a quarter of a pixel. They occur almost entirely in round letters --
   * `S a b d e g m n s 6 9 3` -- so they are the apexes of bowls.
   *
   * The bar font already asked whether a flat stroke between two scanlines gets
   * ink and the answer was no, twenty-seven times out of twenty-seven. But a
   * bar is not a bowl: its edges are horizontal lines meeting corners, and an
   * apex is a curve turning over, where the scanline below it cuts the outline
   * twice and the one above not at all. That difference has never been tested,
   * and it is the only one left.
   *
   * So: a wide shallow arch, thin enough that its apex falls between two
   * scanlines, drawn eighteen ways -- three thicknesses by six heights, moving
   * the apex through a whole pixel -- and the same eighteen again as flat bars
   * at the same place, as the control. The glyph is wide either way, so both
   * sit on the far side of the switch that `cour-widths` found.
   */
  {
    name: 'cour-arches',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with shallow arches and flat bars of the same thickness and height',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const THICK = [60, 100, 140];
      const PHASE = [0, 40, 80, 120, 160, 200];
      const RISE = 200;
      const LEFT = 200;
      const RIGHT = 1800;

      for (let index = 0; index < WIDE.length; index++) {
        const arch = index < 18;
        const rest = index % 18;
        const thick = THICK[rest % THICK.length];
        const base = 700 + PHASE[Math.floor(rest / THICK.length)];

        /* The arch: a quadratic over the top from left to right, down the right
         * side, a matching quadratic back along the bottom, up the left side.
         * The control point sits twice the rise above the ends, which puts the
         * curve's own apex exactly one rise above them.
         */
        const points = arch
          ? [
              [LEFT, base],
              [(LEFT + RIGHT) / 2, base + RISE * 2, false],
              [RIGHT, base],
              [RIGHT, base - thick],
              [(LEFT + RIGHT) / 2, base - thick + RISE * 2, false],
              [LEFT, base - thick],
            ]
          : [
              [LEFT, base - thick],
              [LEFT, base],
              [RIGHT, base],
              [RIGHT, base - thick],
            ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, LEFT);
      }

      return bytes;
    },
  },

  /* Hairlines tall enough to cross a band boundary.
   *
   * The scaler's interface rasterises a scanline range at a time and offers two
   * banding strategies, of which only the costlier "can preserve dropout-control
   * behaviour". If GDI bands, and if a boundary loses what dropout control
   * carries across it, a stroke rescued on every scanline should break on one
   * fixed device row. Every rule found so far breaks a stroke at its own ends,
   * which move with the stroke; a band would break it in the middle, in the same
   * place for every glyph at that size.
   *
   * The `bands` probe draws these two hundred pixels tall, which is where the
   * question lives -- the glyph probe's sizes are one band by any reckoning.
   *
   * Six widths from four to fourteen design units, which stay under a pixel from
   * fifty pixels per em to a hundred and sixty, by six sub-pixel phases. The bar
   * runs from below the baseline to above the ascender so that it is as long as
   * the cell allows, and a small box sits well below it so the glyph is wide
   * enough to be on the far side of the switch `cour-widths` found -- a lone
   * hairline is a narrow glyph, and narrow glyphs are drawn by the other rule.
   */
  {
    name: 'cour-hairs',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with tall hairlines, for the bands probe',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [4, 6, 8, 10, 12, 14];
      const PHASES = [0, 42, 85, 128, 170, 213];
      const LOW = -300;
      const HIGH = 1500;

      for (let index = 0; index < WIDE.length; index++) {
        const width = WIDTHS[index % WIDTHS.length];
        const phase = PHASES[Math.floor(index / WIDTHS.length) % PHASES.length];
        const left = 600 + phase;

        const bar = [
          [left, LOW],
          [left, HIGH],
          [left + width, HIGH],
          [left + width, LOW],
        ];

        // Well below the bar, so it widens the glyph and shares no scanline.
        const ballast = [
          [1700, -700],
          [1700, -500],
          [1900, -500],
          [1900, -700],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, {
          width: 0,
          height: 0,
          contours: [bar, ballast],
          program: [],
        });
        setBearing(bytes, glyph, left);
      }

      return bytes;
    },
  },

  /* The same hairlines in the face whose dropout control lasts.
   *
   * `cour-hairs` asked the band question of Courier New and could not answer
   * it: that face's `prep` sets `SCANCTRL` to switch dropout control off above
   * forty-four pixels per em, so at the sizes a band boundary needs there is no
   * rescue left to break -- 79 of its 144 hairlines are simply not drawn.
   *
   * Times New Roman sets the same control to a hundred and twenty-four, so a
   * hairline is still rescued at a size where the glyph is over a hundred
   * scanlines tall. That is the only face installed that can be asked.
   *
   * The scaler's interface rasterises a scanline range at a time and offers two
   * banding strategies, of which only the costlier "can preserve dropout-control
   * behaviour". If GDI bands, and if a boundary loses what dropout control
   * carries across it, a stroke rescued on every scanline should break on one
   * fixed device row. Every rule found so far breaks a stroke at its own ends,
   * which move with the stroke; a band would break it in the middle, in the same
   * place for every glyph at that size.
   *
   * The `bands` probe draws these two hundred pixels tall, which is where the
   * question lives -- the glyph probe's sizes are one band by any reckoning.
   *
   * Six widths from four to fourteen design units, which stay under a pixel from
   * fifty pixels per em to a hundred and sixty, by six sub-pixel phases. The bar
   * runs from below the baseline to above the ascender so that it is as long as
   * the cell allows, and a small box sits well below it so the glyph is wide
   * enough to be on the far side of the switch `cour-widths` found -- a lone
   * hairline is a narrow glyph, and narrow glyphs are drawn by the other rule.
   */
  {
    name: 'times-hairs',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: 'Times New Roman with tall hairlines, whose dropout control survives to 124 ppem',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTHS = [4, 6, 8, 10, 12, 14];
      const PHASES = [0, 42, 85, 128, 170, 213];
      const LOW = -300;
      const HIGH = 1500;

      for (let index = 0; index < WIDE.length; index++) {
        const width = WIDTHS[index % WIDTHS.length];
        const phase = PHASES[Math.floor(index / WIDTHS.length) % PHASES.length];
        const left = 600 + phase;

        const bar = [
          [left, LOW],
          [left, HIGH],
          [left + width, HIGH],
          [left + width, LOW],
        ];

        // Well below the bar, so it widens the glyph and shares no scanline.
        const ballast = [
          [1700, -700],
          [1700, -500],
          [1900, -500],
          [1900, -700],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, {
          width: 0,
          height: 0,
          contours: [bar, ballast],
          program: [],
        });
        setBearing(bytes, glyph, left);
      }

      return bytes;
    },
  },

  /* A flat shelf between two scanlines, in a glyph that has scanlines.
   *
   * The bar font asked whether Windows inks a horizontal stroke that misses
   * every scanline and answered no, 27 times of 27 -- and that answer has been
   * load-bearing ever since: it is why the sweep down columns was deleted.
   *
   * But those bars were the whole glyph. A lone sideways bar thinner than the
   * gap between two scanlines is a glyph covering no row centre at all, which
   * `cour-widths` later showed is a degenerate case the rasteriser treats
   * differently -- and in the vertical direction degenerate means there are no
   * scanlines to sweep, so nothing could have been drawn whatever the rule. The
   * bars never tested a shelf inside a glyph; they tested a glyph that was a
   * shelf.
   *
   * A real letter's is inside. The bottom bar of Courier New's `E` at eight
   * pixels per em runs from 5.672 to 6.000 in device coordinates -- a third of a
   * pixel tall, lying wholly between the scanlines at 5.5 and 6.5, invisible to
   * a sweep along rows -- and Windows draws it.
   *
   * So: a tall post to give the glyph its rows, and beside it a thin shelf whose
   * height sweeps a whole pixel and whose thickness runs from an eighth of one
   * to a half. The post is wide enough to be drawn ordinarily and sits well left
   * of the shelf, so the two share no span. If the shelf gets ink, dropout
   * control works down columns after all and the bar font was answering a
   * different question.
   */
  {
    name: 'cour-shelves',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with a tall post and a thin horizontal shelf between scanlines',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const THICK = [30, 45, 60, 75, 90, 105];
      const PHASE = [0, 42, 85, 128, 170, 213];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const thick = THICK[index % THICK.length];
        const phase = PHASE[Math.floor(index / THICK.length) % PHASE.length];
        const base = 600 + phase;

        // Wide enough to fill ordinarily at every size recorded.
        const post = [
          [200, 0],
          [200, TALL],
          [500, TALL],
          [500, 0],
        ];

        const shelf = [
          [900, base],
          [900, base + thick],
          [1700, base + thick],
          [1700, base],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, contours: [post, shelf], program: [] });
        setBearing(bytes, glyph, 200);
      }

      return bytes;
    },
  },

  /* A foot under a post, which is the shape half the remaining error is in.
   *
   * The bottom bars of `E`, `B` and `d` at eight pixels per em are a horizontal
   * stroke lying between two scanlines with an inked stem standing on it, and
   * Windows draws them a row above where this does -- and draws four columns
   * where this draws two. `cour-shelves` established that such a stroke gets ink
   * at all, 134 times of 134, but its shelf stood in open space beside a post.
   * It never put one *underneath* something already drawn, which is the
   * configuration the guard and the tip rule both react to.
   *
   * So: one contour shaped like a post standing on a foot. The post is wide
   * enough to fill ordinarily at every size, so there is always ink directly
   * above the foot; the foot is wider than the post on both sides, so it has
   * columns of its own where nothing else reaches. Six thicknesses, all under
   * half a pixel at the sizes recorded, by six heights moving the foot through a
   * whole pixel.
   */
  /* One bar, with a continuation at one end, the other, both, or neither.
   *
   * `cour-bars` leaves forty-nine cells where Windows draws the first and last
   * row of an isolated upright bar and we do not. The mechanism is known and the
   * reason is not: a bar that thin and that straight puts nothing in the
   * vertical lists, so the stub check in `DoHorizDropout` collapses to "does the
   * next row have crossings", which is false at both ends of any isolated run.
   * `cour-shelves` and `cour-feet` are exact, and their thin runs are attached
   * to a post; `cour-phases` is exact, and its bars lean. Every fabrication that
   * agrees gives the check something to find.
   *
   * So the question is whether the end of a run is drawn because something
   * continues from it, and it has never been put directly. Here it is: the same
   * sub-pixel post four times over, with an arm at the top, at the bottom, at
   * both, and at neither. The arm is wide and thick enough to be drawn outright,
   * so it is continuation and nothing else.
   *
   * If Windows draws every row of all four, the check is not doing what its
   * shape says and ours should not either. If it draws the arm end and not the
   * bare one, we are right about the rule and `cour-bars` is wrong for some
   * other reason. If it draws the bare end only when the *other* end has an arm,
   * the check is being asked once for the run rather than once for each row.
   */
  {
    name: 'cour-stubs',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with a thin post carrying an arm at one end, both, or neither',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      // A third to two thirds of a pixel at sixteen per em, where one is 128.
      const THIN = [40, 60, 80];
      const PHASE = [0, 42, 85];
      const TALL = 1400;
      // Wide and thick enough that no size in the sweep can lose it.
      const ARM = 600;
      const DEEP = 200;

      for (let index = 0; index < WIDE.length; index++) {
        const thin = THIN[index % THIN.length];
        const phase = PHASE[Math.floor(index / THIN.length) % PHASE.length];
        const which = Math.floor(index / (THIN.length * PHASE.length)) % 4;

        const left = 600 + phase;
        const right = left + thin;
        const top = which === 1 || which === 3;
        const foot = which === 2 || which === 3;

        /* Up the left side, across whatever is at the top, down the right side,
         * and across whatever is at the bottom -- the same winding as the other
         * bar fabrications, so nothing here changes which list a crossing joins.
         */
        const points = [
          [left, 0],
          [left, TALL],
        ];

        if (top) {
          points.push([left + ARM, TALL], [left + ARM, TALL - DEEP], [right, TALL - DEEP]);
        } else {
          points.push([right, TALL]);
        }

        if (foot) {
          points.push([right, DEEP], [left + ARM, DEEP], [left + ARM, 0]);
        } else {
          points.push([right, 0]);
        }

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, left);
      }

      return bytes;
    },
  },

  {
    name: 'cour-feet',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'Courier New with a post standing on a foot thinner than a scanline gap',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const THICK = [30, 45, 60, 75, 90, 105];
      const PHASE = [0, 42, 85, 128, 170, 213];
      const TALL = 1400;

      for (let index = 0; index < WIDE.length; index++) {
        const thick = THICK[index % THICK.length];
        const base = 100 + PHASE[Math.floor(index / THICK.length) % PHASE.length];
        const top = base + thick;

        const points = [
          [300, base],
          [300, top],
          [600, top],
          [600, TALL],
          [900, TALL],
          [900, top],
          [1300, top],
          [1300, base],
        ];

        const glyph = glyphFor(bytes, WIDE.charCodeAt(index));

        setGlyph(bytes, null, glyph, { width: 0, height: 0, points, program: [] });
        setBearing(bytes, glyph, 300);
      }

      return bytes;
    },
  },

  /* Reading a point back out of three glyphs with three side bearings.
   *
   * The last hundred wrong pixels are not the rasteriser's: an exact solve of
   * the outline and an integer walk over it now agree with each other and
   * disagree with Windows on the same 106 pixels, and the one cell whose
   * outline never passes through the interpreter is very nearly perfect. So it
   * is the outline that differs, and the way to find out where is to stop
   * inferring it from letters and ask an instruction directly.
   *
   * The `hinting` probe sweeps three characters of this face -- `W`, `o` and
   * `w` -- across ninety-nine sizes, so a fabrication gets three questions per
   * recording and no more. One of the three is always spent on a control: a
   * glyph that runs no instruction at all and reports the same point. Whatever
   * that reads is what the channel makes of an untouched point, and the other
   * two mean nothing without it.
   *
   * Every glyph has the same outline, four points along the baseline at 0, 256,
   * 512 and 768 font units, so the distance under test is exactly an eighth of
   * an em and its scaled value is a number that can be worked out by hand. What
   * the three do not share is the side bearing they inherit from the letter
   * they are written over -- 27 units for the `W`, 69 for the `o` and 13 for
   * the `w` -- and that turned out to be the variable that mattered.
   *
   * @param {string} name - What the fabrication is called.
   * @param {string} describe - What it is for.
   * @param {Function} bodies - Given the three characters, the program each
   *                            runs before the readout and how far to magnify.
   */
  ...[
    {
      name: 'times-rounding',
      describe: 'MDRP with and without rounding, against a control that runs nothing',
      W: () => ({ body: [] }),
      o: (setup) => ({ body: [...setup, 0x18, ...ops.byte(1), 0xc4] }),
      w: (setup) => ({ body: [...setup, 0x18, ...ops.byte(1), 0xc0] }),
    },

    /* The same three experiments moved onto different glyphs, which is how the
     * one that looked like a rounding bug turned out to belong to the glyph it
     * was sitting on rather than to the instruction.
     */
    {
      name: 'times-swapped',
      describe: 'the same three experiments, moved onto different glyphs',
      W: (setup) => ({ body: [...setup, 0x18, ...ops.byte(1), 0xc4] }),
      o: () => ({ body: [] }),
      w: (setup) => ({ body: [...setup, 0x18, ...ops.byte(1), 0xc0] }),
    },

    /* Three controls at three magnifications.
     *
     * The readout multiplies the coordinate it reads before reporting it, and
     * the two accounts of what the side bearing does to that reading differ
     * only in whether the magnification multiplies the bearing along with the
     * point. At eightfold they are the same number; at fourfold and twofold
     * they are not, and nothing else about the three glyphs changes.
     */
    {
      name: 'times-magnified',
      describe: 'the same control read back at three magnifications',
      W: () => ({ body: [], magnify: 8 }),
      o: () => ({ body: [], magnify: 4 }),
      w: () => ({ body: [], magnify: 2 }),
    },
  ].map(({ name, describe, ...bodies }) => ({
    name,
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe,

    edit: (bytes) => {
      const POINTS = [
        [0, 0],
        [256, 0],
        [512, 0],
        [768, 0],
      ];

      const setup = [
        0x01, // SVTCA[x]
        ...ops.byte(0),
        0x10, // SRP0
      ];

      for (const [character, of] of Object.entries(bodies)) {
        const { body, magnify = 8 } = of(setup);

        setGlyph(bytes, null, glyphFor(bytes, character.charCodeAt(0)), {
          width: 768,
          height: 0,
          points: POINTS,

          /* A control still needs the `SVTCA` the others get from their setup,
           * because the readout reads along whichever axis is current.
           */
          program: [
            ...(body.length ? body : [0x01]),
            ...reportPoint(1, POINTS.length + 1, magnify),
          ],
        });
      }

      return bytes;
    },
  })),

  /* Reading the stored coordinate itself, exactly, at every half.
   *
   * Twelve readings say the conversion from font units to pixels rounds a half
   * two different ways, six each, and no single rule produces both. The next
   * thing to know is what the arithmetic actually is, and for that it is no
   * good inferring the stored coordinate from a magnified reading -- it has to
   * be read.
   *
   * A magnification of sixty-four does that. The readout reports the advance in
   * whole pixels and the coordinate is a whole number of sixty-fourths, so
   * multiplying by sixty-four before reporting makes the reported number of
   * pixels equal the stored number of sixty-fourths. Nothing is rounded on the
   * way and nothing has to be assumed about the channel.
   *
   * The price is range: the advance is carried in sixteen bits of 26.6, so a
   * reading much past five hundred wraps. Every point here is therefore chosen
   * to scale to under eight pixels at the largest size swept.
   *
   * Each point sits so that its distance from the outline's zero, once the side
   * bearing of the letter it is written over is added, is 144, 80 and 16 font
   * units. All three are sixteen more than a multiple of thirty-two, which puts
   * the scaled value exactly on a half at every odd size -- fifty-odd halves per
   * glyph rather than the two or three a sweep stumbles onto. The three differ
   * by a factor of nine in magnitude, which is the point: a rounding rule does
   * not care how large the coordinate is, and a scale factor carrying a
   * relative error does.
   */
  {
    name: 'times-halves',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: 'the scaled coordinate read back exactly, on a half at every odd size',

    edit: (bytes) => {
      // The bearing each glyph inherits, and what it must add up to.
      const WANTED = { W: [27, 144], o: [69, 80], w: [13, 16] };

      for (const [character, [bearing, total]] of Object.entries(WANTED)) {
        const at = total - bearing;

        setGlyph(bytes, null, glyphFor(bytes, character.charCodeAt(0)), {
          width: 768,
          height: 0,
          points: [
            [0, 0],
            [at, 0],
            [at + 256, 0],
            [at + 512, 0],
          ],
          program: [0x01, ...reportPoint(1, 5, 64)],
        });
      }

      return bytes;
    },
  },

  /* An edge walked across a sample point, with the interpreter taken out.
   *
   * The last hundred wrong pixels are all one situation: the outline passes
   * within thousandths of a pixel of a sample point, and Windows calls it one
   * way and this implementation the other. Two things could do that. The
   * outline reaching the rasteriser might differ by a sixty-fourth or less,
   * which would be the interpreter and invisible anywhere but on a sample
   * point; or the walk might resolve the sample differently, which would be the
   * rasteriser. Nothing measured so far separates them, because every recorded
   * letter has been through both.
   *
   * These glyphs have no program at all. Nothing is hinted, so the outline
   * Windows rasterises is the one written here scaled once -- and that scaling
   * is already known to agree, since it is what the `hdmx` advances and Arial
   * Italic's `M` measure. Whatever disagreement is left has only the walk to
   * come from.
   *
   * Each of the thirty-six characters the glyph probe draws gets a rectangle
   * whose right edge is three font units further out than the last. At the
   * sizes the probe uses that is about two thirds of a sixty-fourth a step, so
   * the sweep carries the edge across rather more than half a pixel and over at
   * least one column of sample points. Eighteen of them have a straight right
   * edge, walked by `CalcLine`, and eighteen a gently curved one, walked by
   * `CalcSpline`, over the same ground. Where each implementation stops
   * lighting the last column is a threshold, and the two thresholds either
   * coincide or they do not.
   */
  {
    name: 'edge-sweep',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: 'an unhinted edge carried across a column of sample points',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const TALL = 900;
      const BULGE = 40;

      WIDE.split('').forEach((character, index) => {
        const curved = index >= 18;
        const at = 200 + (index % 18) * 3;

        /* Anticlockwise in font coordinates, which is the filled direction:
         * up the left side, across the top, down the right.
         */
        const points = curved
          ? [
              [0, 0],
              [0, TALL],
              [at, TALL],
              [at + BULGE, TALL / 2, false],
              [at, 0],
            ]
          : [
              [0, 0],
              [0, TALL],
              [at, TALL],
              [at, 0],
            ];

        setGlyph(bytes, null, glyphFor(bytes, character.charCodeAt(0)), {
          width: 1024,
          height: TALL,
          points,
          program: [],
        });

        /* All thirty-six on the same bearing, so that the only thing the sweep
         * varies is the edge. Without this each keeps the bearing of the letter
         * it was written over, the outline is carried onto a different one in
         * every glyph, and the left side of the rectangle moves along with the
         * right.
         */
        setBearing(bytes, glyphFor(bytes, character.charCodeAt(0)), 0);
      });

      return bytes;
    },
  },

  /* A curve's turning point carried across a column of sample points.
   *
   * `edge-sweep` moved an edge across the sample columns and found one cell
   * where the two walks disagreed; tracing it showed why. Windows walks a whole
   * quadratic, and this implementation splits one at its turning point so that
   * both halves are monotonic -- which creates an endpoint the original never
   * had, and that endpoint has to be put on the grid. Rounded to the nearest
   * sixty-fourth it can land half of one beyond where the curve actually
   * reaches, and a pixel whose centre falls in that half is lit here and not
   * there. Rounding the turn toward the curve instead settles it.
   *
   * That rule now wants a sweep of its own, because `edge-sweep` moves an edge
   * and not an extreme: it crossed the case by accident, once. These glyphs
   * move the turning point itself. Each is a rectangle with one curved side
   * whose control point is one font unit further out than the last, so the
   * extreme -- which is the average of the two scaled ends and the scaled
   * control -- steps across a sample column in halves of a sixty-fourth. The
   * cases either side of a sample and the case exactly on it are what the rule
   * is about, and here they are asked for rather than stumbled onto.
   *
   * Eighteen bulge right, where the turn is a maximum and the rule rounds down,
   * and eighteen bulge left, where it is a minimum and the rule rounds up. Each
   * is given a bearing equal to its own `xMin` so that the outline is carried
   * onto nothing and the only thing moving is the curve.
   */
  {
    name: 'turn-sweep',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: "a curve's extreme stepped across a sample column, both ways",

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const TALL = 900;

      WIDE.split('').forEach((character, index) => {
        const control = index % 18;

        /* Bulging right, the curve runs down the right side of a rectangle
         * standing at nothing; bulging left, up the left side of one standing
         * further over, so that no coordinate goes negative.
         */
        const points =
          index < 18
            ? [
                [0, 0],
                [0, TALL],
                [200, TALL],
                [230 + control, TALL / 2, false],
                [200, 0],
              ]
            : [
                [400, 0],
                [30 + control, TALL / 2, false],
                [400, TALL],
                [600, TALL],
                [600, 0],
              ];

        const glyph = glyphFor(bytes, character.charCodeAt(0));

        setGlyph(bytes, null, glyph, { width: 1024, height: TALL, points, program: [] });

        // The bearing its own left edge, so the outline is carried onto nothing.
        setBearing(bytes, glyph, Math.min(...points.map((point) => point[0])));
      });

      return bytes;
    },
  },

  /* A crossing carried across a sample point a twentieth of a sixty-fourth at a
   * time.
   *
   * Everything still disagreeing about is a curve passing within a sixty-fourth
   * of a sample point, so the thing to measure is where exactly the threshold
   * sits. The other sweeps move an edge or an extreme by about half a
   * sixty-fourth a step, which brackets the answer and does not locate it.
   *
   * The lever here is the curve's own parameter. A quadratic's control point
   * moves the curve by `2t(1-t)` of the way it is displaced, which is a half at
   * the middle and much less near either end -- so a row near the top of a tall
   * curve moves a small fraction of however far the control moves. At these
   * sizes a font unit of control is under half a sixty-fourth to begin with,
   * and a tenth of the way along the curve it is a twelfth of one.
   *
   * So: a rectangle two thousand units tall with one curved side, thirty-six of
   * them, the control a unit further out each time. Every row is a separate
   * reading, and the rows near the ends are the fine ones. Where Windows starts
   * lighting a column, against where the outline actually crosses that row,
   * is the threshold.
   */
  {
    name: 'fine-sweep',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: 'a curve crossing a sample point in the smallest steps a font unit allows',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const TALL = 2000;
      const LEFT = 200;

      WIDE.split('').forEach((character, index) => {
        const control = LEFT + 90 + index;

        const points = [
          [0, 0],
          [0, TALL],
          [LEFT, TALL],
          [control, TALL / 2, false],
          [LEFT, 0],
        ];

        const glyph = glyphFor(bytes, character.charCodeAt(0));

        setGlyph(bytes, null, glyph, { width: 1024, height: TALL, points, program: [] });
        setBearing(bytes, glyph, 0);
      });

      return bytes;
    },
  },

  /* Two vertical dropouts in one column, to see which end the column is read
   * from.
   *
   * `FindDropouts` walks a column's entries in reverse, which is down the
   * glyph, and `PerformVertDropout` declines where a neighbour is already lit.
   * Put two rescues one row apart in the same column and the direction decides
   * the answer: read downward, the upper one is made and then blocks the lower;
   * read upward, the lower one is made first, its neighbour above is still
   * clear, and both survive. One pixel against two, in the bitmap, where the
   * oracle can be asked.
   *
   * A stroke too thin to cover a sample down a column is a vertical dropout, so
   * what this needs is two horizontal hairlines, close enough together that
   * their rescues land on neighbouring rows. Each glyph gets the same two bars
   * with a different gap between them -- from about four fifths of a pixel to
   * about two and a quarter at the sizes the probe draws -- so whatever the
   * rounding does, several of the thirty-six land on the case that matters.
   */
  {
    name: 'twin-bars',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: 'two hairlines a row apart, so the column tells which way it is read',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const WIDTH = 900;
      const THICK = 50;
      const LOW = 200;

      WIDE.split('').forEach((character, index) => {
        const gap = 120 + index * 6;

        const bar = (bottom) => [
          [0, bottom],
          [WIDTH, bottom],
          [WIDTH, bottom + THICK],
          [0, bottom + THICK],
        ];

        const glyph = glyphFor(bytes, character.charCodeAt(0));

        setGlyph(bytes, null, glyph, {
          width: 1024,
          height: LOW + gap + THICK,
          contours: [bar(LOW), bar(LOW + gap)],
          program: [],
        });

        setBearing(bytes, glyph, 0);
      });

      return bytes;
    },
  },

  /* The letters that disagree, with their hinting taken away.
   *
   * The recorded letters are hinted and the fabricated sweeps are not, and
   * their residues look alike -- an edge landing on the wrong side of a sample
   * -- so one has been read as evidence about the other. It need not be. Strip
   * the program from a glyph that disagrees and both sides scan-convert the
   * same outline, scaled once by arithmetic already confirmed elsewhere. If
   * they then agree, what was wrong was the outline the interpreter produced;
   * if they still disagree, it was the scan conversion.
   *
   * Only the instruction length is touched, so the points, the contours and
   * every table around them are the font's own. `prep` and `fpgm` still run --
   * they set up a size, they do not move a glyph's points -- and the phantom
   * points are still placed and still rounded, so the advance is unchanged and
   * the letter lands where it did.
   *
   * Times rather than Arial because Arial is the shell's own font: stripped of
   * its hinting it never gets as far as the probe, and the recording times out
   * twice out of two. Times carries a third of the disagreeing pixels and is
   * not load-bearing for the desktop.
   */
  {
    name: 'times-bare',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: 'Times New Roman with the glyph programs removed, hinting and all',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      for (const character of WIDE) {
        const glyph = glyphFor(bytes, character.charCodeAt(0));
        const body = glyphBody(bytes, glyph);

        if (body.contours < 0) {
          // A composite keeps its own arrangement; there is nothing to strip.
          continue;
        }

        /* Filled with `SVTCA[x]` rather than shortened.
         *
         * A glyph's points are stored after its instructions, so setting the
         * instruction length to nothing does not remove them -- it moves where
         * the flags and coordinates are read from, and the outline comes back
         * as whatever the old instruction bytes happen to decode to. Windows
         * does not survive the attempt; the recording crashed the emulator.
         *
         * Overwriting each byte with an opcode that takes no operands and moves
         * no point leaves the layout untouched and the program inert.
         */
        for (let at = 0; at < body.length; at++) {
          view.setUint8(body.program + at, 0x01);
        }
      }

      return bytes;
    },
  },

  /* One spline, its control point walked away from the chord.
   *
   * Everything still disagreeing is a spline crossing, and lines never
   * disagree at all -- 3,673 of them in `times-bare` without a single one being
   * drawn differently. The one input a spline has and a line does not is its
   * control point, and the rate at which the disputes fall along a spline's own
   * parameter has the shape of `2t(1-t)`: nothing at either end and most in the
   * middle, which is precisely the weight a quadratic gives that point.
   *
   * If the difference is something about the control, it should grow with how
   * far the control is from the chord, since that is what scales its influence.
   * So: thirty-six rectangles with one curved side, the endpoints of the curve
   * fixed and the control walked outward twenty font units at a time, from
   * sitting exactly on the chord -- where the three points are collinear and
   * `EvaluateSpline` hands the piece to `CalcLine` instead -- to some five
   * pixels clear of it at the sizes the probe draws.
   *
   * The first glyph is therefore a control: a spline that is really a line, and
   * which ought to agree perfectly if lines do.
   */
  {
    name: 'control-sweep',
    from: 'TIMES.TTF',
    as: 'TIMES.TTF',
    describe: "a spline's control point walked out from its chord, twenty units a step",

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const TALL = 1200;
      const LEFT = 300;

      WIDE.split('').forEach((character, index) => {
        const bulge = index * 20;

        const points = [
          [0, 0],
          [0, TALL],
          [LEFT, TALL],
          [LEFT + bulge, TALL / 2, false],
          [LEFT, 0],
        ];

        const glyph = glyphFor(bytes, character.charCodeAt(0));

        setGlyph(bytes, null, glyph, { width: 1400, height: TALL, points, program: [] });
        setBearing(bytes, glyph, 0);
      });

      return bytes;
    },
  },

  {
    name: 'cour-control-sweep',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: 'the same control sweep in Courier New, whose outlines are drawn differently',

    edit: (bytes) => {
      const WIDE = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

      const TALL = 1200;
      const LEFT = 300;

      WIDE.split('').forEach((character, index) => {
        const bulge = index * 20;

        const points = [
          [0, 0],
          [0, TALL],
          [LEFT, TALL],
          [LEFT + bulge, TALL / 2, false],
          [LEFT, 0],
        ];

        const glyph = glyphFor(bytes, character.charCodeAt(0));

        setGlyph(bytes, null, glyph, { width: 1400, height: TALL, points, program: [] });
        setBearing(bytes, glyph, 0);
      });

      return bytes;
    },
  },

  /* Courier New with its `INSTCTRL` turned around.
   *
   * Its `prep` executes the instruction twice, both times as `PUSHB[2] 1, 1`
   * followed by the opcode -- selector 1, value 1, which sets the bit meaning
   * "do not grid-fit at this size". The first is guarded by `MPPEM < 9`, and
   * eight pixels per em is the size at which this face is 0 of 36 recorded
   * glyphs and more than half of every wrong pixel in the fixture.
   *
   * Zeroing the *value* byte of each push leaves the selector alone and turns
   * the instruction from setting the bit into clearing it, so the glyph
   * programs run where they otherwise would not. One byte each, no lengths
   * changed, nothing else about the font touched.
   *
   * The point is not that Windows should be made to hint. It is that the
   * recording made with this font and the recording made without it can be
   * compared: if they are identical, `INSTCTRL` does nothing to what gets
   * drawn and the reading of it here is wrong; if they differ, it works, and
   * the fabricated one is a recording of Courier New *hinted* at eight pixels
   * per em, which nothing else can produce.
   */
  {
    name: 'cour-no-instctrl',
    from: 'COUR.TTF',
    as: 'COUR.TTF',
    describe: "Courier New with prep's INSTCTRL clearing the bit instead of setting it",

    edit: (bytes) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const table = tablesOf(view).prep;

      let found = 0;

      for (let at = table.offset; at < table.offset + table.length; at++) {
        // `PUSHB[2] 1, 1` then `INSTCTRL`, which is the whole of the pattern.
        if (
          bytes[at] === 0xb1 &&
          bytes[at + 1] === 0x01 &&
          bytes[at + 2] === 0x01 &&
          bytes[at + 3] === 0x8e
        ) {
          // The deeper of the two is the value; the top one is the selector.
          bytes[at + 1] = 0x00;
          found++;
        }
      }

      if (found !== 2) {
        throw new Error(`expected two INSTCTRL sites in prep, found ${found}`);
      }

      return bytes;
    },
  },

  /* Times New Roman Italic's `j`, which is the last record of `CreateFont`
   * still disagreeing and now also the only record of 927 that the `hinting`
   * sweep disagrees on: at thirty-four pixels per em Windows advances by 8 and
   * this by 9.
   *
   * The advance phantom is point 50 -- the glyph has 49 of its own -- so
   * reporting that one reads the answer itself rather than an interior point,
   * and a sweep of cuts says which byte of the program moves it.
   */
  reporter('timesi-j-p50-cut0', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 0,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 0 bytes",
  }),
  reporter('timesi-j-p50-cut50', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 50,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 50 bytes",
  }),
  reporter('timesi-j-p50-cut88', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 88,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 88 bytes",
  }),
  reporter('timesi-j-p50-cut107', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 107,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 107 bytes",
  }),
  reporter('timesi-j-p50-cut140', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 140,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 140 bytes",
  }),
  reporter('timesi-j-p50-cut160', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 160,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 160 bytes",
  }),
  reporter('timesi-j-p50-cut180', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 180,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 180 bytes",
  }),
  reporter('timesi-j-p50-cut202', {
    font: 'TIMESI.TTF',
    character: 'j',
    point: 50,
    cut: 202,
    magnify: 8,
    describe: "Times New Roman Italic's j reporting its advance after 202 bytes",
  }),
  reporter('timesi-j-constant', {
    font: 'TIMESI.TTF',
    character: 'j',
    constant: 16 * 64,
    cut: 202,
    describe: "Times New Roman Italic's j reporting a constant, as the control",
  }),

  /* Times New Roman's capital `W`, the one glyph of the five still differing
   * that the instrument can reach: its failing size is fourteen pixels per em,
   * which `hdmx` does not tabulate. Points 9, 10, 26, 27 and 28 are the two
   * inner diagonals, which is where the missing pixel is.
   */
  reporter('times-cap-w-p9', {
    character: 'W',
    point: 9,
    cut: 623,
    magnify: 8,
    describe: "Times New Roman's W reporting point 9",
  }),

  reporter('times-cap-w-p10', {
    character: 'W',
    point: 10,
    cut: 623,
    magnify: 8,
    describe: "Times New Roman's W reporting point 10",
  }),

  reporter('times-cap-w-p26', {
    character: 'W',
    point: 26,
    cut: 623,
    magnify: 8,
    describe: "Times New Roman's W reporting point 26",
  }),

  reporter('times-cap-w-p27', {
    character: 'W',
    point: 27,
    cut: 623,
    magnify: 8,
    describe: "Times New Roman's W reporting point 27",
  }),

  reporter('times-cap-w-p28', {
    character: 'W',
    point: 28,
    cut: 623,
    magnify: 8,
    describe: "Times New Roman's W reporting point 28",
  }),

  /* Courier New's `1`, whose flag this draws and Windows draws two pixels more
   * of. Points 17 to 27 are the flag; 17 is where it meets the stem and 22 is
   * its far end. Courier New has no `hdmx`, so every size can be read.
   */
  reporter('cour-one-p17', {
    font: 'COUR.TTF',
    character: '1',
    point: 17,
    cut: 158,
    magnify: 8,
    describe: "Courier New's 1 reporting point 17, which is on the flag",
  }),

  reporter('cour-one-p18', {
    font: 'COUR.TTF',
    character: '1',
    point: 18,
    cut: 158,
    magnify: 8,
    describe: "Courier New's 1 reporting point 18, which is on the flag",
  }),

  reporter('cour-one-p22', {
    font: 'COUR.TTF',
    character: '1',
    point: 22,
    cut: 158,
    magnify: 8,
    describe: "Courier New's 1 reporting point 22, which is on the flag",
  }),

  reporter('cour-one-p27', {
    font: 'COUR.TTF',
    character: '1',
    point: 27,
    cut: 158,
    magnify: 8,
    describe: "Courier New's 1 reporting point 27, which is on the flag",
  }),

  /* The calibration for the synthetic glyphs, which has to come first: at the
   * sizes `hdmx` covers, `GetTextExtent` reports the tabulated advance and the
   * program's answer never reaches the outside. This says which sizes can be
   * read at all.
   */
  /* `ISECT` where the two lines barely cross, which is a fragility rather than
   * a feature.
   *
   * The reference divides unless its denominator is exactly nought, so two lines
   * a fraction of a degree apart put the point an enormous distance away and
   * Windows lets them. Ours used to take the midpoint whenever they were within
   * about three degrees, on an unexplained constant, and that has been changed
   * to match; nothing in any recording moved, because no fixture had a
   * near-parallel `ISECT` in it. These three put one in.
   *
   * The same five points every time, and only the second line's far end moves:
   *
   *   crossing   line B at right angles, meeting A at 400,200 -- the control,
   *              which says the instruction and the readout both work;
   *   grazing    line B rising eight units over eight hundred, about half a
   *              degree, so the meeting point is twenty thousand units out --
   *              a hundred and fifty pixels at sixteen per em, far outside the
   *              glyph and impossible to reach by accident;
   *   parallel   line B exactly along A, where the denominator really is nought
   *              and both implementations take the midpoint.
   *
   * Read unmagnified, since the grazing answer is already enormous.
   */
  ...[
    ['isect-crossing', [400, 0], [400, 400], 'the two lines meeting at right angles'],
    ['isect-grazing', [0, 0], [800, 8], 'the two lines half a degree apart'],
    ['isect-parallel', [0, 200], [800, 200], 'the two lines exactly parallel'],
  ].map(([name, from, to, what]) =>
    experiment(name, {
      font: 'ARIALI.TTF',
      character: 'm',
      // The point to move, then line A, then line B.
      points: [[0, 0], [0, 200], [800, 200], from, to],
      body: [...ops.byte(0), ...ops.byte(1), ...ops.byte(2), ...ops.byte(3), ...ops.byte(4), 0x0f],
      report: 0,
      magnify: 1,
      describe: `ISECT with ${what}`,
    })
  ),

  /* `SROUND` and `S45ROUND` decode one byte into a period, a phase and a
   * threshold, and two corners of that decoding are ours rather than read.
   *
   * The reference gives the fourth period selector a period of 999 and calls it
   * illegal; we gave it a whole pixel, which is a guess that happens to be the
   * second selector's answer. And `S45ROUND`'s period is the square root of a
   * half, which the reference keeps in 2.30 and converts to a whole number of
   * sixty-fourths, where ours divides 45 by two and keeps 22.5 -- so its
   * threshold comes out on a different side of the halves.
   *
   * A fixed argument and the size sweep between them measure the whole state:
   * `MDAP[r]` rounds one point with whatever `SROUND` has just set up, and the
   * point's own position moves a sixty-fourth at a time as the size changes, so
   * ninety-nine sizes walk the value across every period and phase the argument
   * describes.
   */
  ...[
    ['sround-illegal', 0x76, 0xc0, 'the period selector the reference calls illegal'],
    ['sround-quarter', 0x76, 0x14, 'a half-pixel period on a quarter phase'],
    ['s45round-half', 0x77, 0x04, 'the forty-five degree period, halved'],
  ].map(([name, op, argument, what]) =>
    experiment(name, {
      font: 'ARIALI.TTF',
      character: 'm',
      points: [
        [67, 0],
        [323, 400],
        [579, 400],
        [835, 0],
      ],
      body: [
        // Along x, so the point's own x is what gets rounded and reported.
        0x01,
        ...ops.byte(argument),
        op,
        ...ops.byte(1),
        // MDAP[r]: round the point where it stands.
        0x2f,
      ],
      report: 1,
      magnify: 8,
      describe: `MDAP[r] under ${what}`,
    })
  ),

  /* Whether a delta list has to arrive sorted by size.
   *
   * The two fabrications hold the same sixteen exceptions -- one for every size
   * the first delta band covers, each moving the point a whole pixel -- and
   * differ only in the order they sit on the stack. A reading that walks the
   * list looking for its own size cannot tell them apart. One that assumes the
   * list is sorted, and stops as soon as it has passed the size it wants, sees
   * all sixteen in the ascending list and none in the descending one.
   *
   * So the ascending fabrication is the control: it says the exceptions arrive
   * and land where expected. The descending one is the question.
   */
  ...[
    ['delta-ascending', (i) => i, 'in the order a font would write them'],
    ['delta-descending', (i) => 15 - i, 'largest size first'],
  ].map(([name, sizeAt, what]) =>
    experiment(name, {
      font: 'ARIALI.TTF',
      character: 'm',
      points: [
        [67, 0],
        [323, 400],
        [579, 400],
        [835, 0],
      ],
      body: [
        // Along x, so the exceptions move the point the report reads.
        0x01,
        /* Sixteen pairs, deepest first. Each is the packed argument -- the size
         * counted from the delta base in the high nibble, and the largest step
         * up in the low one, which at the default shift is a whole pixel -- and
         * then the point it applies to.
         */
        ...Array.from({ length: 16 }, (_, i) => i).flatMap((i) => [
          ...ops.byte((sizeAt(i) << 4) | 0x0f),
          ...ops.byte(1),
        ]),
        ...ops.byte(16),
        // DELTAP1: the first band, which is the delta base and the fifteen
        // sizes above it.
        0x5d,
      ],
      report: 1,
      magnify: 8,
      describe: `sixteen delta exceptions ${what}`,
    })
  ),

  /* What the scaler says it is.
   *
   * `GETINFO` answers a font's questions about what is running it, and a font
   * is entitled to branch on the answer. The version is not a bit but a number
   * or-ed into the low end of the reply, so a font comparing it against two or
   * three takes a different path depending on what Windows says here -- and
   * what Windows says has been assumed rather than read.
   *
   * The selector nothing asks for is the control: with no bits set the reply is
   * zero, which pins the phantom at the origin and shows the channel carries
   * whatever the instruction returned rather than the letter's own width.
   */
  ...[
    ['getinfo-version', 1, 'the version bit'],
    ['getinfo-nothing', 0, 'no bit at all'],
  ].map(([name, selector, what]) =>
    stackReporter(name, {
      font: 'ARIALI.TTF',
      character: 'm',
      points: [
        [67, 0],
        [323, 400],
        [579, 400],
        [835, 0],
      ],
      body: [
        ...ops.byte(selector),
        // GETINFO.
        0x88,
        /* Into sixty-fourths, and then eight times over, so that answers one
         * apart land eight pixels apart and no size's own width can be mistaken
         * for one of them.
         */
        ...ops.word(64 * 64),
        ...ops.multiply(),
        ...ops.word(8 * 64),
        ...ops.multiply(),
      ],
      describe: `what GETINFO answers for ${what}`,
    })
  ),

  /* What size the program thinks it is running at.
   *
   * `MPS` answers the point size, and both halves of what we answer are a
   * guess: that the point size is the pixels-per-em, which is only so at
   * seventy-two dots to the inch, and that it comes back in sixty-fourths.
   *
   * One fabrication puts the reply straight onto the phantom as a coordinate,
   * where a plain count of points is too small to read and a count in
   * sixty-fourths reads as itself. The other multiplies by sixty-four first,
   * where the plain count reads as itself and the sixty-fourths overflow. So
   * between the two the unit shows itself, and the number that comes back can
   * be held against the size the record already names.
   */
  ...[
    ['mps-raw', [], 'as it comes'],
    ['mps-scaled', [...ops.word(64 * 64), ...ops.multiply()], 'multiplied into sixty-fourths'],
  ].map(([name, scale, what]) =>
    stackReporter(name, {
      font: 'ARIALI.TTF',
      character: 'm',
      points: [
        [67, 0],
        [323, 400],
        [579, 400],
        [835, 0],
      ],
      // MPS.
      body: [0x4c, ...scale],
      describe: `the point size MPS answers, ${what}`,
    })
  ),

  /* What becomes of the work a program did before it went wrong.
   *
   * An instruction the scaler does not know stops the program where it stands
   * and hands an error back to whatever asked for the glyph. What that caller
   * then does is the question: keep the half-hinted outline, or throw the
   * hinting away and draw the letter as it was designed.
   *
   * Both fabrications put an unmistakable number on the advance phantom first
   * and only then go wrong, so the answer is already made when the error
   * happens. The control does not go wrong at all.
   */
  ...[
    ['abort-illegal', [0x7b], 'and then meets an instruction that does not exist'],
    ['abort-none', [], 'and is left alone'],
  ].map(([name, after, what]) =>
    stackReporter(name, {
      font: 'ARIALI.TTF',
      character: 'm',
      points: [
        [67, 0],
        [323, 400],
        [579, 400],
        [835, 0],
      ],
      /* Twenty-four pixels, which no size in the sweep has as its own width and
       * which does not move with the size, so a reading of it is the report and
       * nothing else.
       */
      body: [...ops.word(24 * 64)],
      after,
      describe: `a program that reports a width ${what}`,
    })
  ),

  /* Which vector a twilight point is placed along.
   *
   * A twilight point has no outline behind it, so `MIAP` does not move it, it
   * puts it there -- at the control value's distance from the origin, along a
   * vector. Which vector was a guess: we used the one points are free to move
   * along, and the scaler uses the one distances are measured along. The two
   * are the same until a program separates them, and a program that separates
   * them is what diagonal hinting is.
   *
   * Both fabrications write a known control value, place twilight point nought
   * at it, and read the placed point's coordinate back. The control leaves both
   * vectors on the x axis, where the question does not arise. The experiment
   * measures along x but frees along y: placing along the measuring vector puts
   * the point where the control put it, and placing along the freeing vector
   * puts it at nought instead, since it has no x at all.
   */
  ...[
    ['twilight-crossed', [0x03, 0x04], 'measured along x and freed along y'],
    ['twilight-square', [0x01], 'both on the x axis'],
  ].map(([name, vectors, what]) =>
    stackReporter(name, {
      font: 'ARIALI.TTF',
      character: 'm',
      points: [
        [67, 0],
        [323, 400],
        [579, 400],
        [835, 0],
      ],
      body: [
        ...vectors,

        // A control value of our own, so the reading does not depend on what
        // the font happens to keep in the table.
        ...ops.byte(0),
        ...ops.word(24 * 64),
        // WCVTP.
        0x44,

        // Point nought of the twilight zone, placed at that control value.
        ...ops.byte(0),
        // SZP0.
        0x13,
        ...ops.byte(0),
        ...ops.byte(0),
        // MIAP, without rounding, so nothing but the placing shows.
        0x3e,

        // Read it back, which needs the twilight zone as the third one too.
        ...ops.byte(0),
        // SZP2.
        0x16,
        ...ops.byte(0),
        // GC, in the position it is at.
        0x46,

        /* Back to a square pair of vectors and the glyph's own zone, so that
         * putting the answer on the phantom is not itself a diagonal move.
         */
        0x01,
        ...ops.byte(1),
        0x16,
      ],
      describe: `a twilight point placed with the vectors ${what}`,
    })
  ),

  experiment('ip-calibrate', {
    font: 'ARIALI.TTF',
    character: 'm',
    points: [
      [67, 0],
      [323, 400],
      [579, 400],
      [835, 0],
    ],
    body: [0x01],
    report: 1,
    magnify: 0,
    describe: 'the synthetic glyph reporting nothing at all, to find the readable sizes',
  }),

  /* The same reading with no multiply at all, which separates `GC` from `MUL`.
   */
  experiment('ip-plain', {
    font: 'ARIALI.TTF',
    character: 'm',
    points: [
      [67, 0],
      [323, 400],
      [579, 400],
      [835, 0],
    ],
    body: [0x01],
    report: 1,
    magnify: 1,
    describe: 'the coordinate of an untouched point, read with no magnification',
  }),

  /* The control that says the channel reads a *point* correctly, not just a
   * constant: the same program as the identity experiment with the `IP` taken
   * out. Whatever this reports is what the readout makes of an untouched point,
   * and any difference between it and the identity experiment is `IP` alone.
   */
  experiment('ip-absent', {
    font: 'ARIALI.TTF',
    character: 'm',
    points: [
      [67, 0],
      [323, 400],
      [579, 400],
      [835, 0],
    ],
    body: [
      0x01, // SVTCA[x]
      ...ops.byte(0),
      0x11, // SRP1
      ...ops.byte(3),
      0x12, // SRP2
    ],
    report: 1,
    describe: 'the identity experiment with the IP removed, which is the control for it',
  }),

  /* What `IP` does when its reference points have not moved.
   *
   * Ours does nothing: the original distance and the current one are the same
   * number, so the interpolation is the identity. Windows moves the point
   * anyway -- that is what the `M` says and this is what asks directly. Four
   * points at 0, 256, 512 and 768 font units, `rp1` and `rp2` set to the outer
   * two, and the second interpolated between them without either reference
   * having been touched.
   */
  experiment('ip-identity', {
    font: 'ARIALI.TTF',
    character: 'm',
    points: [
      [67, 0],
      [323, 400],
      [579, 400],
      [835, 0],
    ],
    body: [
      0x01, // SVTCA[x]
      ...ops.byte(0),
      0x11, // SRP1, from point 0
      ...ops.byte(3),
      0x12, // SRP2, to point 3
      ...ops.byte(1),
      0x39, // IP, on point 1
    ],
    report: 1,
    describe: 'IP with both reference points untouched, reporting the point it interpolated',
  }),

  /* The same, with `rp2` moved a whole pixel right first. Whatever `IP` does,
   * it has to do more of it here, and the difference between the two says how
   * the ratio is taken.
   */
  experiment('ip-stretched', {
    font: 'ARIALI.TTF',
    character: 'm',
    points: [
      [67, 0],
      [323, 400],
      [579, 400],
      [835, 0],
    ],
    body: [
      0x01, // SVTCA[x]
      ...ops.byte(3),
      ...ops.byte(3),
      0x47, // GC[orig] of point 3
      ...ops.word(64),
      0x60, // ADD one pixel
      0x48, // SCFS, putting point 3 one pixel right of where it started
      ...ops.byte(0),
      0x11, // SRP1
      ...ops.byte(3),
      0x12, // SRP2
      ...ops.byte(1),
      0x39, // IP
    ],
    report: 1,
    describe: 'IP with the far reference moved one pixel, reporting the interpolated point',
  }),

  reporter('ariali-m-p10-cut344', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 344,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 344 bytes of its program",
  }),

  reporter('ariali-m-p10-cut359', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 359,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 359 bytes of its program",
  }),

  reporter('ariali-m-p10-cut345', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 345,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 345 bytes of its program",
  }),

  reporter('ariali-m-p10-cut347', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 347,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 347 bytes of its program",
  }),

  reporter('ariali-m-p10-cut349', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 349,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 349 bytes of its program",
  }),

  reporter('ariali-m-p10-cut351', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 351,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 351 bytes of its program",
  }),

  reporter('ariali-m-p10-cut353', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 353,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 353 bytes of its program",
  }),

  reporter('ariali-m-p10-cut355', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 355,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 355 bytes of its program",
  }),

  reporter('ariali-m-p10-cut357', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 357,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 357 bytes of its program",
  }),

  reporter('ariali-m-p10-cut358', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 10,
    cut: 358,
    magnify: 8,
    describe: "Arial Italic's M reporting point 10 after 358 bytes of its program",
  }),

  reporter('ariali-m-p11-cut344', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 11,
    cut: 344,
    magnify: 8,
    describe: "Arial Italic's M reporting point 11 after 344 bytes of its program",
  }),

  reporter('ariali-m-p11-cut347', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 11,
    cut: 347,
    magnify: 8,
    describe: "Arial Italic's M reporting point 11 after 347 bytes of its program",
  }),

  reporter('ariali-m-p11-cut351', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 11,
    cut: 351,
    magnify: 8,
    describe: "Arial Italic's M reporting point 11 after 351 bytes of its program",
  }),

  reporter('ariali-m-p5-cut344', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 5,
    cut: 344,
    magnify: 8,
    describe: "Arial Italic's M reporting point 5 after 344 bytes of its program",
  }),

  reporter('ariali-m-p5-cut341', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 5,
    cut: 341,
    magnify: 8,
    describe: "Arial Italic's M reporting point 5 after 341 bytes of its program",
  }),

  reporter('ariali-m-p5-cut240', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 5,
    cut: 240,
    magnify: 8,
    describe: "Arial Italic's M reporting point 5 after 240 bytes of its program",
  }),

  reporter('ariali-m-p5-cut300', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 5,
    cut: 300,
    magnify: 8,
    describe: "Arial Italic's M reporting point 5 after 300 bytes of its program",
  }),

  reporter('ariali-m-p5-cut328', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 5,
    cut: 328,
    magnify: 8,
    describe: "Arial Italic's M reporting point 5 after 328 bytes of its program",
  }),

  reporter('ariali-m-p5-cut336', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 5,
    cut: 336,
    magnify: 8,
    describe: "Arial Italic's M reporting point 5 after 336 bytes of its program",
  }),

  reporter('ariali-m-p5-cut340', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 5,
    cut: 340,
    magnify: 8,
    describe: "Arial Italic's M reporting point 5 after 340 bytes of its program",
  }),

  /* The two phantom points, which is what the `IP` at byte 340 interpolates
   * between: the `M` has twenty-five points, so 25 and 26 are phantom 0 and
   * phantom 1. Read at the start and either side of that instruction.
   */
  reporter('ariali-m-p25-cut0', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 25,
    cut: 0,
    magnify: 8,
    describe: "Arial Italic's M reporting point 25 after 0 bytes of its program",
  }),

  reporter('ariali-m-p26-cut0', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 26,
    cut: 0,
    magnify: 8,
    describe: "Arial Italic's M reporting point 26 after 0 bytes of its program",
  }),

  reporter('ariali-m-p25-cut340', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 25,
    cut: 340,
    magnify: 8,
    describe: "Arial Italic's M reporting point 25 after 340 bytes of its program",
  }),

  reporter('ariali-m-p26-cut340', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 26,
    cut: 340,
    magnify: 8,
    describe: "Arial Italic's M reporting point 26 after 340 bytes of its program",
  }),

  reporter('ariali-m-p25-cut341', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 25,
    cut: 341,
    magnify: 8,
    describe: "Arial Italic's M reporting point 25 after 341 bytes of its program",
  }),

  reporter('ariali-m-p26-cut341', {
    font: 'ARIALI.TTF',
    character: 'M',
    point: 26,
    cut: 341,
    magnify: 8,
    describe: "Arial Italic's M reporting point 26 after 341 bytes of its program",
  }),

  /* The bracket the bisection over Arial Italic's `M` closed on. Reading point
   * 10 after 344 bytes of its program agrees with Windows at every size and
   * after 359 disagrees at six more, so whatever differs is in those fifteen
   * bytes. The intermediate cuts that narrowed it are not kept: the two that
   * bracket it are the evidence, and the rest were scaffolding.
   */
  /* The bracket the bisection over Times New Roman's `w` closed on, which found
   * `SDPVTL`. Point 35 read after 600 bytes agrees everywhere and after 660
   * disagrees at 23 sizes; the sixty bytes between hold four `SDPVTL`
   * instructions and nothing else that touches a vector.
   */
  reporter('times-w-p35-cut600', {
    character: 'w',
    point: 35,
    cut: 600,
    magnify: 8,
    describe: "Times New Roman's w reporting point 35 after 600 bytes of its program",
  }),

  reporter('times-w-p35-cut660', {
    character: 'w',
    point: 35,
    cut: 660,
    magnify: 8,
    describe: "Times New Roman's w reporting point 35 after 660 bytes of its program",
  }),

  /* The calibration, which has to come before any reading is believed. The
   * advance phantom is put at exactly sixteen pixels and nothing else is
   * touched, so a correct channel reports sixteen at every size. Anything else
   * is an offset every other reading carries too.
   */
  reporter('ariali-m-constant', {
    font: 'ARIALI.TTF',
    character: 'M',
    constant: 16 * 64,
    cut: 504,
    describe: "Arial Italic's M reporting a fixed sixteen pixels, to calibrate",
  }),

  reporter('times-w-constant', {
    character: 'w',
    constant: 16 * 64,
    cut: 717,
    describe: "Times New Roman's w reporting a fixed sixteen pixels as its advance",
  }),

  /* The differential harness. Times New Roman's `w` is one of two letters whose
   * advance still disagrees, and it disagrees because of where point 32 ends
   * up -- everything between that point and the advance has been checked and
   * is right. This asks Windows where it puts point 32, which nothing else can.
   *
   * Magnified eight times, so an eighth of a pixel of position is a pixel of
   * answer and the sixty-fourths that decide the disagreement are visible.
   */
  reporter('times-w-point-32', {
    character: 'w',
    point: 32,
    cut: 717,
    magnify: 8,
    describe: "Times New Roman's w reporting point 32's x position as its advance",
  }),

  /* And point 35, which is what places point 32. If the two disagree the fault
   * is between them; if only 35 does, it is above.
   */
  reporter('times-w-point-35', {
    character: 'w',
    point: 35,
    cut: 717,
    magnify: 8,
    describe: "Times New Roman's w reporting point 35's x position as its advance",
  }),

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

    /* A copy per fabrication, since most edits are in place. One that has to
     * grow a table cannot be, and returns a new buffer instead -- so what gets
     * written is whatever came back, falling back on the copy.
     */
    const copy = original.slice();
    const bytes = fabrication.edit(copy) ?? copy;

    reseal(bytes);

    let changed = bytes.length === original.length ? 0 : bytes.length - original.length;

    for (let at = 0; at < Math.min(bytes.length, original.length); at++) {
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
