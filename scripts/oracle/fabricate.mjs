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
export function setGlyph(bytes, font, glyph, { width, height, program, points }) {
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

  const corners = points ?? [
    [0, 0],
    [0, height],
    [width, height],
    [width, 0],
  ];

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

  put16(1);
  put16(Math.min(...xs));
  put16(Math.min(...ys));
  put16(Math.max(...xs));
  put16(Math.max(...ys));
  put16(corners.length - 1);

  put16(program.length);
  body.push(...program);

  // Every point on the curve, and every coordinate a signed two byte delta.
  for (const _ of corners) {
    body.push(0x01);
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
function reporter(name, { font = 'TIMES.TTF', character, point, constant, cut, magnify, describe }) {
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

export const FABRICATIONS = [
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

        const points = [
          [300, 0],
          [300 + base, 0],
          [300 + Math.floor(base / 2), height],
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
