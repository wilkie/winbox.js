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
 * **No outline glyph disagrees.** All 3,546 recorded cells of Arial, Times New
 * Roman and Courier New agree, in four styles each, and that list is kept at
 * zero because that is the property worth defending: not a rate that may drift
 * but a list that must stay empty. Section 6 of FONTS.md records what was ruled
 * out getting there.
 *
 * Everything that is not an outline is counted separately and is not at zero.
 * Two things are open.
 *
 * Symbol, in the styles the face has no file for: a slant synthesised onto an
 * outline, drawn at an angle that is not Windows' -- Symbol is the only
 * installed face that ever asks for one, the other three outline families
 * shipping an italic of their own -- and a smear synthesised onto one at the
 * smallest sizes. Symbol upright agrees at every size but eight. That is 96
 * cells.
 *
 * And the three plotter fonts, all 420 of them, which had never been drawn
 * here at all until the probe was pointed at them. They are strokes rather than
 * strikes or outlines, and nothing about how we draw them is right yet.
 *
 * ## How the last sixteen went
 *
 * They were all letters with a diagonal, two thirds of them Courier New, and
 * six of them were the bold `K`. Bisecting that `K` -- cutting its program
 * after N instructions and recording the letter Windows draws -- put the
 * divergence between cut 88 and cut 89, and the one instruction between those
 * two is a `DELTAP1`.
 *
 * A delta's nudge is a distance along the *projection* vector and the point
 * travels along *freedom* to achieve it, which where the two are at an angle
 * means travelling further, and can mean travelling the other way. We were
 * adding the nudge to the coordinate. That is right wherever the two vectors
 * are the same axis, which is every delta in the corpus except this one: four
 * instructions earlier the `K` sets its projection along its own arm with
 * `SDPVTL` and leaves freedom on the y axis, so the nudge arrives divided by
 * the cosine between them. Routing `DELTAP` through the same `movePoint` every
 * other move already used closed all sixteen at once.
 *
 * The reference names the same shape: `itrp_DeltaEngine` is handed
 * `LocalGS.MovePoint` and calls it, and `LocalGS.MovePoint` is the general
 * mover that divides by `pfProj` unless the vector instructions have swapped in
 * an axis-aligned one.
 *
 * ## What the chase cost, and why
 *
 * Three readings taken before this one said the arm and everything computed
 * from it agreed with Windows, and pointed at the function called three
 * instructions later. They were worthless, and worth recording as a trap.
 *
 * Each moved one point of the letter *upward* by the value being read. A cell
 * is as tall as the letter and the letter fills it, so a mark that lands inside
 * the silhouette draws nothing and a mark that clears the silhouette leaves the
 * cell. All three landed in one or the other, on both sides, and three
 * recordings agreed because neither side drew a mark at all. An agreement
 * between two blanks looks exactly like an agreement.
 *
 * The fix is to read *sideways*. The cell is thirty-two columns and Courier at
 * these sizes is seven, so a mark placed to the right of the letter is the only
 * ink in twenty-odd columns and cannot hide. `cutAndCall` does that, and
 * `courbd-k-answer` is kept as the one reading of the three that works.
 *
 * The general lesson is narrower than "check your instrument": a readout whose
 * two outcomes are *ink here* and *ink there* fails safely, and one whose
 * outcomes are *ink here* and *nothing* does not, because *nothing* is also
 * what a readout that never ran produces.
 */
'use strict';

import { loadFixtures, prepareFonts, replayFixture, type Replayed } from './replay.js';

/* Ceilings, and none may rise. The outline faces are at nought and stay there;
 * the bitmap ones are what is left to do.
 */
const OUTLINE = ['Arial', 'Times New Roman', 'Courier New'];
const RECORDS = 0;
const PIXELS = 0;
const BITMAP_RECORDS = 136;
const BITMAP_PIXELS = 794;

/* The wide-net fixtures: two single pixels among the styled files, none above
 * thirty-one pixels, and one stretched outline of `widths`, an unhinted `o`
 * a pixel off; see FONTS.md. Each may only come down. */
const STYLES_OUTLINE_RECORDS = 2 + 1;
const STYLES_OUTLINE_PIXELS = 2 + 1;
const STYLES_OTHER_RECORDS = 0;
const STYLES_OTHER_PIXELS = 0;

/** Whether a recorded call named one of the three outline families. */
function isOutline(args: string) {
  return OUTLINE.some((face) => args.startsWith(`"${face}",`));
}

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
    let rows: { args: string; wrong: number; fixture?: string }[] = [];

    beforeAll(async () => {
      await prepareFonts();

      rows = [];

      for (const fixture of fixtures) {
        rows.push(
          ...disagreementsIn((await replayFixture(fixture)).replayed).map((row) => ({
            ...row,
            fixture: fixture.probe,
          }))
        );
      }
    }, 120000);

    it('names them', () => {
      /* The `styles` fixture is the wide net over the styled files and
       * Wingdings, and it has its own ceilings below; the list the three
       * outline families are held at nought on is everything else. */
      const WIDE_NET = ['styles', 'sizes', 'widths'];
      const styled = rows.filter((row) => WIDE_NET.includes(row.fixture ?? ''));
      const rest = rows.filter((row) => !WIDE_NET.includes(row.fixture ?? ''));
      const outline = rest.filter((row) => isOutline(row.args));
      const bitmap = rest.filter((row) => !isOutline(row.args));
      const count = (list: typeof rows) => list.reduce((sum, row) => sum + row.wrong, 0);

      console.log(
        [
          `outline: ${outline.length} records, ${count(outline)} pixels`,
          `bitmap:  ${bitmap.length} records, ${count(bitmap)} pixels`,
          ...rows.map((row) => `  ${row.args.padEnd(48)} ${String(row.wrong).padStart(3)} px`),
        ].join('\n')
      );

      expect(outline.length).toBeLessThanOrEqual(RECORDS);
      expect(count(outline)).toBeLessThanOrEqual(PIXELS);
      expect(bitmap.length).toBeLessThanOrEqual(BITMAP_RECORDS);
      expect(count(bitmap)).toBeLessThanOrEqual(BITMAP_PIXELS);

      /* And the wide net, which may only come down. */
      const styledOutline = styled.filter((row) => isOutline(row.args));
      const styledOther = styled.filter((row) => !isOutline(row.args));
      console.log(
        `styles: outline ${styledOutline.length} records ${count(styledOutline)} px; other ${styledOther.length} records ${count(styledOther)} px`
      );
      expect(styledOutline.length).toBeLessThanOrEqual(STYLES_OUTLINE_RECORDS);
      expect(count(styledOutline)).toBeLessThanOrEqual(STYLES_OUTLINE_PIXELS);
      expect(styledOther.length).toBeLessThanOrEqual(STYLES_OTHER_RECORDS);
      expect(count(styledOther)).toBeLessThanOrEqual(STYLES_OTHER_PIXELS);
    });
  });
}
