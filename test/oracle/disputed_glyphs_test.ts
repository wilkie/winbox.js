/**
 * @jest-environment jsdom
 *
 * The outline glyphs that still disagree, named rather than counted.
 *
 * `api_conformance_test.ts` reports the rate; this reports the list, because a
 * rate cannot say whether a change fixed four letters and broke three. Every
 * row is a recorded call whose bitmap we do not reproduce, with how many pixels
 * of the thirty-two by thirty-two cell are wrong.
 *
 * Section 6 of FONTS.md records what has been ruled out for these.
 */

'use strict';

import { loadFixtures, prepareFonts, replayFixture, type Replayed } from './replay.js';

/* What is left. Both are ceilings: neither may rise.
 *
 * Twenty-nine cells, all of them in the bold and italic files, which the probe
 * had never drawn until now: it asked the three outline faces in their plain
 * weight and upright, and those still agree everywhere. Nine hundred and
 * seventy-two cells of the other three styles came in and nine hundred and
 * forty-three of them were right.
 *
 * The twenty-nine fall in two shapes. Eleven are ink we add and nothing we
 * miss -- one to five pixels on a diagonal, which is the scan converter
 * keeping a stroke Windows drops. Fifteen add and miss in roughly equal
 * numbers, which is a shape landing a column over; Courier New's bold italic
 * `X` and `Z` are the worst of those and are the whole letter shifted. Three
 * are ink we miss.
 *
 * Two thirds are Courier New and two thirds are bold italic, and every letter
 * involved has a diagonal in it -- K, X, Z, k, 7, M, N, t, y, m, 4, B.
 *
 * Thirteen of the twenty-nine came right when the advance phantom was made to
 * remember where the scaling left it rather than where the rounding put it; see
 * `Hinter.hint`. Bisecting Courier New's bold italic `X` is what found it -- the
 * letter agrees with no program at all, and starts disagreeing across a single
 * `SHP` that shifts against that phantom.
 *
 * What is left is sixteen cells and forty-eight pixels, still every one of them
 * a letter with a diagonal, still two thirds Courier New, and now led by `K`,
 * which is six of them.
 *
 * The `K` has been bisected too, and stops where the `w` did. Courier New's
 * bold `K` agrees with no program at all and through eighty-eight of its
 * hundred and thirty-three instructions; by ninety-two it does not. The
 * instruction between them is a `CALL`, and what that function does is set the
 * projection vector along the arm with `SDPVTL`, read it back with `RPV`, and
 * work a factor out of the angle -- so a fraction of a pixel in either of the
 * two points that define the arm becomes a whole row in where the arm meets the
 * stem. `RPV` and `RFV` were read against the scaler and match.
 *
 * That is the same wall the `w` reached: a sub-pixel difference upstream,
 * amplified, with no oracle for the intermediate positions. Cutting the program
 * says where the amplifier is, not what feeds it.
 *
 * The obvious way past it does not work here. The `hinting` probe now sweeps
 * Courier New bold, so a fabrication of that file can be recorded; but a glyph
 * rewritten to report one of its points through the advance is not read back.
 * With the `K`'s program cut at eighty-eight and a reading appended, Windows
 * answers the letter's plain width while we answer the point; with the program
 * kept almost whole, both answer the plain width. It is not `hdmx` or `LTSH` --
 * Courier New has neither -- nor the fixed-pitch flag, which is clear. Why the
 * advance stops carrying a reading for this face is not known, and until it is
 * the intermediate positions cannot be compared.
 */
const RECORDS = 16;
const PIXELS = 48;

/** The recorded bitmap is one bit per pixel, set where the probe left white. */
function inkOf(hex: string) {
  return [...hex.replace(/[^0-9a-f]/gi, '')].flatMap((digit) =>
    [...parseInt(digit, 16).toString(2).padStart(4, '0')].map((bit) => bit === '0')
  );
}

function disagreementsIn(replayed: Replayed[]) {
  const rows: { args: string; wrong: number }[] = [];

  for (const one of replayed) {
    if (one.function !== 'glyph' || one.outcome !== 'disagreed') {
      continue;
    }

    const want = inkOf(one.expected);
    const got = inkOf(one.actual ?? '');
    let wrong = 0;

    for (let at = 0; at < Math.max(want.length, got.length); at++) {
      if (want[at] !== got[at]) {
        wrong++;
      }
    }

    rows.push({ args: one.args, wrong });
  }

  return rows;
}

const fixtures = loadFixtures();

if (fixtures.length === 0) {
  describe('the outline glyphs still in dispute', () => {
    it.skip('needs fixtures; run the oracle pipeline to record them', () => {});
  });
} else {
  describe('the outline glyphs still in dispute', () => {
    let rows: { args: string; wrong: number }[] = [];

    beforeAll(async () => {
      await prepareFonts();

      rows = [];

      for (const fixture of fixtures) {
        rows.push(...disagreementsIn((await replayFixture(fixture)).replayed));
      }
    }, 120000);

    it('names them', () => {
      const pixels = rows.reduce((sum, row) => sum + row.wrong, 0);

      console.log(
        [
          `${rows.length} records, ${pixels} pixels`,
          ...rows.map((row) => `  ${row.args.padEnd(48)} ${String(row.wrong).padStart(2)} px`),
        ].join('\n')
      );

      expect(rows.length).toBeLessThanOrEqual(RECORDS);
      expect(pixels).toBeLessThanOrEqual(PIXELS);
    });
  });
}
