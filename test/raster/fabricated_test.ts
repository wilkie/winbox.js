/**
 * @jest-environment jsdom
 *
 * Replaying the fabricated recordings against the interpreter.
 *
 * The fixtures under `oracle/fixtures/fabricated/` were made against fonts we
 * built ourselves -- a real face with one glyph's program rewritten to end by
 * moving the advance phantom onto a point of interest, so that the width
 * Windows reports for that letter is that point's position, magnified. See
 * `scripts/oracle/fabricate.mjs` for why, and `FONTS.md` for what they settled.
 *
 * What makes them worth a test of their own rather than a one-off analysis is
 * that they are the only recording of an *intermediate* value. Every other
 * fixture says what came out; these say where a named point was after a named
 * byte of a named program, at ninety-nine sizes. A change to the interpreter
 * that keeps the advances right and moves an interior point is invisible
 * everywhere else and shows here at once.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { TrueTypeFont } from '../../src/raster/truetype-font.js';

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures', 'fabricated');
const FONTS = join(__dirname, '..', '..', 'oracle', 'build', 'fonts');

/** The face each fabricated file stands in for, as the probe asked for it. */
const FACES: Record<string, { face: string; italic: string }> = {
  'ARIALI.TTF': { face: 'Arial', italic: '1' },
  'ARIAL.TTF': { face: 'Arial', italic: '0' },
  'COUR.TTF': { face: 'Courier New', italic: '0' },
  'TIMES.TTF': { face: 'Times New Roman', italic: '0' },
  'TIMESI.TTF': { face: 'Times New Roman', italic: '1' },
};

interface Reading {
  ppem: number;
  windows: number;
  ours: number | null;
}

/**
 * Every reading a recording holds that can be believed.
 *
 * Three kinds have to be dropped, and none of them is a disagreement:
 *
 * - Sizes `hdmx` tabulates. The fabrication rewrites a program; it does not
 *   rewrite the table, so Windows answers from the stale table and never runs
 *   the readout. That this happens at exactly the tabulated sizes and nowhere
 *   else is itself a confirmation of the order the two are consulted in.
 * - Cells below twelve pixels, where the mapper answers with a strike rather
 *   than with this face at all, so the number is some other font's.
 * - Sizes at or above the glyph's `LTSH` threshold, where Windows scales the
 *   advance instead of running the program -- the same reason as `hdmx` and
 *   found the same way, by a control that stopped reading its constant back at
 *   exactly the tabulated threshold and not a pixel before.
 * - Readings the readout could not carry. The coordinate is multiplied by the
 *   magnification and by sixty-four before `GetTextExtent` returns it in a
 *   sixteen bit word, and past about eight thousand sixty-fourths that wraps.
 *   Windows reports the wrap as a negative number, which is how they are
 *   recognised.
 */
function readings(fixture: any, font: any) {
  const file = fixture.file as string;
  const known = FACES[file];
  const found: Reading[] = [];
  const seen = new Set<number>();

  for (const record of fixture.records) {
    const asked = /^"([^"]+)",h=(\d+),italic=(\d+),'(.)'$/.exec(record.args);
    const said = /advance=(-?\d+),ppem=(\d+)/.exec(String(record.result));

    if (!asked || !said || asked[1] !== known.face || asked[3] !== known.italic) {
      continue;
    }

    const ppem = Number(said[2]);
    const windows = Number(said[1]);
    const glyph = font.glyphFor(asked[4].charCodeAt(0));

    if (
      windows < 0 ||
      Number(asked[2]) < 12 ||
      font.deviceAdvance(ppem, glyph) !== null ||
      font.linearAdvance(glyph, ppem) !== null ||
      seen.has(ppem)
    ) {
      continue;
    }

    seen.add(ppem);
    found.push({ ppem, windows, ours: font.hintedAdvance(glyph, ppem, true) });
  }

  return found;
}

/** Every recording, with the font it was made against loaded. */
function recordings() {
  if (!existsSync(FIXTURES) || !existsSync(FONTS)) {
    return [];
  }

  return readdirSync(FIXTURES)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, entry), 'utf8'));
      const directory = join(FONTS, String(fixture.font));

      if (!existsSync(directory)) {
        return null;
      }

      const file = readdirSync(directory)[0];

      return {
        name: entry.replace(/\.json$/, ''),
        file,
        fixture: { ...fixture, file },
        font: new TrueTypeFont(new Uint8Array(readFileSync(join(directory, file)))) as any,
      };
    })
    .filter(Boolean) as any[];
}

describe('the fabricated recordings', () => {
  const all = recordings();
  const present = all.length ? it : it.skip;

  /* Arial Italic's `M` is the glyph the whole set was built for, and the one
   * that paid: its advance was a pixel out at seven of the ninety-nine sizes
   * swept, and no amount of sweeping the interpreter's arithmetic moved it.
   * Reading its interior points said the divergence was one `IP`, and reading
   * that instruction's inputs said `IP` takes its proportion from the design
   * coordinates rather than from the scaled ones.
   */
  present('agree on every interior point of Arial Italic’s M', function () {
    const wrong: string[] = [];

    let compared = 0;

    for (const recording of all) {
      if (!recording.name.includes('ariali-m')) {
        continue;
      }

      for (const reading of readings(recording.fixture, recording.font)) {
        compared++;

        if (reading.ours !== reading.windows) {
          wrong.push(
            `${recording.name} at ${reading.ppem}: Windows ${reading.windows}, ours ${reading.ours}`
          );
        }
      }
    }

    expect(wrong).toEqual([]);

    // Sixteen recordings of five points at fifty readable sizes each.
    expect(compared).toBeGreaterThan(700);
  });

  /* The glyph carried onto its side bearing, and the bearing split in two.
   *
   * `hmtx` says where a glyph's ink begins relative to the pen and `glyf` says
   * where it begins relative to the outline's own zero. For most glyphs of most
   * faces those are the same number, so which of the two the outline is laid
   * out against never comes up. Three fabrications ask directly: each gives
   * three glyphs the same four points on the baseline -- at 0, 256, 512 and 768
   * design units -- and a program that reads point one back out magnified, and
   * what differs between the three is the side bearing each inherits from the
   * letter it was written over, 27, 69 and 13 units against an `xMin` of
   * nothing.
   *
   * One glyph of each is a control that runs no instruction at all, so what it
   * reports is the bare scaling. Between them the three recordings put the
   * control on all three bearings, put `MDRP` with and without rounding on two
   * of them, and read the same control back at eight, four and twofold
   * magnification -- which is what tells apart the part of the bearing that
   * lives in the outline from the part that does not. `FONTS.md` has what they
   * settled.
   *
   * Six readings of 549 disagree and they are named here rather than excluded,
   * because they have something in common: in every one of them the value lands
   * exactly halfway between two pixels and Windows reports the lower. Where
   * that rounding lives is not known. The three places it could go have each
   * been tried and each contradicts something else already recorded -- scaling
   * every coordinate that way breaks the interior points of Arial Italic's `M`,
   * and rounding the advance that way breaks the advances `hdmx` tabulates.
   */
  const HALVES = [
    'times-magnified W ppem 80: windows 81, ours 82',
    'times-magnified o ppem 48: windows 24, ours 25',
    'times-rounding W ppem 80: windows 81, ours 82',
    'times-rounding w ppem 48: windows 50, ours 51',
    'times-swapped W ppem 80: windows 81, ours 82',
    'times-swapped w ppem 48: windows 50, ours 51',
  ];

  present('agree on a glyph carried onto its side bearing', function () {
    const wanted = ['times-rounding', 'times-swapped', 'times-magnified'];
    const found: string[] = [];

    let total = 0;

    for (const recording of all.filter((entry) => wanted.includes(entry.name.slice(8)))) {
      /* One character at a time. The reader keeps one reading per size and the
       * three glyphs are swept at the same sizes, so handing it the whole file
       * would quietly measure the first of them three times over.
       */
      for (const character of ['W', 'o', 'w']) {
        const only = {
          ...recording.fixture,
          records: recording.fixture.records.filter((record: any) =>
            String(record.args).endsWith(`'${character}'`)
          ),
        };

        for (const reading of readings(only, recording.font)) {
          total++;

          if (reading.ours !== reading.windows) {
            found.push(
              `${recording.name.slice(8)} ${character} ppem ${reading.ppem}: ` +
                `windows ${reading.windows}, ours ${reading.ours}`
            );
          }
        }
      }
    }

    expect(total).toBeGreaterThan(500);
    expect(found.sort()).toEqual(HALVES);
  });

  /* Times New Roman Italic's `j`, which was the last disagreeing record of
   * `CreateFont` and the only one of the 927 the `hinting` sweep holds. Its
   * readout is the advance phantom itself rather than an interior point, and
   * the cut that mattered was **nothing at all** -- with no instruction run,
   * the phantom was already a pixel out. What that says is in section 5: the
   * advance is rounded to the grid and the origin added afterwards, not the
   * other way round.
   */
  present('agree on the advance phantom of Times New Roman Italic’s j', function () {
    const wrong: string[] = [];

    let compared = 0;

    for (const recording of all) {
      if (!recording.name.includes('timesi-j-p50')) {
        continue;
      }

      for (const reading of readings(recording.fixture, recording.font)) {
        compared++;

        if (reading.ours !== reading.windows) {
          wrong.push(
            `${recording.name} at ${reading.ppem}: Windows ${reading.windows}, ours ${reading.ours}`
          );
        }
      }
    }

    expect(wrong).toEqual([]);

    // Eight cuts, at the sizes between a twelve pixel cell and the threshold.
    expect(compared).toBeGreaterThan(100);
  });

  /* The control, and the reason any of the rest means anything. This one's
   * program ends by reporting a constant rather than a point, so every size
   * must come back with the same number -- and if the channel were not working,
   * or the font not reaching Windows, it would come back with the letter's own
   * width instead.
   */
  present('read a constant back unchanged at every size', function () {
    const control = all.find((recording) => recording.name.endsWith('ariali-m-constant'));

    expect(control).toBeDefined();

    const values = readings(control.fixture, control.font);

    expect(values.length).toBeGreaterThan(40);
    expect([...new Set(values.map((reading) => reading.windows))]).toEqual([16]);
  });

  /* Four recordings in the set say nothing, and it is worth them saying so out
   * loud rather than being quietly skipped. `cour-one-p17`, `p18`, `p22` and
   * `p27` report Courier New's `1` at exactly the widths the unfabricated font
   * gives, at every size -- so the font never reached the rasteriser and there
   * is no reading in them. They are kept because a recording that failed is
   * worth knowing about, and because the failure is not obvious from the file.
   */
  present('know which recordings did not take', function () {
    const stock = JSON.parse(
      readFileSync(join(FIXTURES, '..', 'hinting.json'), 'utf8')
    ).records.reduce((into: any, record: any) => {
      into[`${record.function}|${record.args}`] = record.result;

      return into;
    }, {});

    const dead = all
      .filter((recording) => {
        const touched = recording.fixture.records.filter(
          (record: any) => stock[`${record.function}|${record.args}`] !== record.result
        );

        return recording.fixture.probe === 'hinting' && touched.length === 0;
      })
      .map((recording) => recording.name);

    expect(dead.sort()).toEqual([
      'hinting-cour-one-p17',
      'hinting-cour-one-p18',
      'hinting-cour-one-p22',
      'hinting-cour-one-p27',
    ]);
  });
});
