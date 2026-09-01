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

/** What is left. Both are ceilings: neither may rise. */
const RECORDS = 25;
const PIXELS = 35;

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
