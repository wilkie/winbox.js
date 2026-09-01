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
 * The worst of them, Courier New's bold italic `X`, is not a hinting
 * disagreement. Its program was cut at 0, 2, 4, 8, 12, 16, 20, 40, 60, 80, 95,
 * 110, 125 and 140 of its 143 instructions and recorded at each, and the letter
 * disagrees at every size in every one of them -- including with no program at
 * all. Windows draws the same `X` with the program and without it, and so do
 * we; the two differ from each other either way. So for that letter what is
 * left is the scaling and the scan conversion of a thick stroke lying at an
 * angle, and the interpreter is not involved.
 */
const RECORDS = 29;
const PIXELS = 184;

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
