/**
 * @jest-environment jsdom
 *
 * Replaying the fabricated *glyph* recordings -- the pixels, not the advances.
 *
 * Sixteen of the recordings under `oracle/fixtures/fabricated/` were made with
 * the glyph probe rather than the hinting one, so each holds 846 monochrome
 * cells drawn by Windows from a font we built. Twelve of them replace Courier
 * New's letters with shapes chosen to isolate one variable of dropout control
 * -- bars of known width and phase, wedges, slants in both directions, a
 * mirrored pair, a phase sweep -- and four alter Times New Roman's `cvt`.
 *
 * Every cell of every one of them now agrees. They had been read once each by
 * hand and then left, which is the wrong place for three thousand records of
 * pixel truth to sit. What makes them worth more
 * than the 846 recorded letters is that **nothing in them is hinted**: a shape
 * font carries no glyph program, so the outline the rasteriser is handed is
 * exactly the outline that was drawn, to the design unit. A disagreement here
 * cannot be blamed on the interpreter, which is the one thing a disagreement
 * about a letter can always be blamed on.
 *
 * That is what decided the column sweep, which is now gone: scored here at the
 * time, deleting it was better on both counts -- 1,816 cells exact against 1,776 and
 * 6,892 wrong pixels against 7,171 -- while on the recorded letters deleting it
 * is worse, 369 wrong pixels against 307. The two only look contradictory until
 * the difference between them is named: the letters are hinted and these are
 * not. A rule that helps where the outline came through an interpreter and
 * hurts where it did not is not a rule about scan conversion, and the bars
 * settled it outright -- of the 27 sideways bars that miss every scanline, not
 * one is inked by Windows at any height up to a full pixel or at any phase.
 * `FONTS.md` section 6 has the rest.
 *
 * Four of them -- `cour-crowd`, `cour-boxes`, `cour-lies` and `cour-sides` --
 * answer a different question: it draws the
 * same bar three ways -- plain, subdivided into three times as many collinear
 * points, and beside a second contour down in the descender that shares no row
 * and no column with it. Windows draws the first two identically in all 84
 * comparisons and the third differently in 29 of them. Outline complexity is
 * therefore something the rasteriser notices, and the three that follow narrow
 * it to the glyph's width in x, measured from the points rather than from the
 * header. Section 6 of `FONTS.md` has the matrix.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures', 'fabricated');
const FONTS = join(__dirname, '..', '..', 'oracle', 'build', 'fonts');

/** Every fabricated recording made with the glyph probe. */
function recordings() {
  if (!existsSync(FIXTURES) || !existsSync(FONTS)) {
    return [];
  }

  return readdirSync(FIXTURES)
    .filter((name) => name.startsWith('glyphs-') && name.endsWith('.json'))
    .sort()
    .map((name) => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
      const directory = join(FONTS, String(fixture.font));

      if (!existsSync(directory)) {
        return null;
      }

      return {
        name: name.replace(/^glyphs-|\.json$/g, ''),
        fixture,
        file: join(directory, readdirSync(directory)[0]),
      };
    })
    .filter(Boolean) as any[];
}

/**
 * The longest run of inked pixels on any row of a recorded cell.
 *
 * A cell is recorded as a thirty-two square of bits with a set bit for the
 * background, which is what the probe's monochrome bitmap handed back.
 */
function widestRun(cell: string) {
  const bytes = Buffer.from(cell, 'hex');

  let widest = 0;

  for (let row = 0; row < 32; row++) {
    const inked = ~bytes.readUInt32BE(row * 4) >>> 0;

    let run = 0;

    for (let bit = 31; bit >= 0; bit--) {
      run = (inked >>> bit) & 1 ? run + 1 : 0;
      widest = Math.max(widest, run);
    }
  }

  return widest;
}

describe('the fabricated glyph recordings', () => {
  const all = recordings();
  const present = all.length ? it : it.skip;

  /* Where this stands, so that a change which moves it says so.
   *
   * The wrong pixels are the instruments rather than the fonts, and most of
   * them are collateral rather than measurement.
   *
   * `symbol-slant` and `symbol-shapes` put known shapes in place of Symbol's
   * letters, upright and slanted, so that the difference between the two cells
   * is the synthesised slant and nothing else. Upright every one of their cells
   * is exact; slanted they are wrong by about a pixel each, and that is a
   * measurement -- see `Surface.SLANT`.
   *
   * `slope-sweep` puts a leaning edge in place of Times New Roman's letters,
   * and the 264 cells it exists to measure all agree; the test above says so
   * with a ceiling of nought. Most of its wrong pixels are the accented
   * letters, which are composites referencing the very glyphs it overwrote, so
   * they draw a parallelogram with an accent on it. That is not a
   * disagreement about anything, and it is the reason this total is a ratchet
   * rather than a target.
   *
   * These are not a target -- more than a third of the cells disagree, and the
   * shape fonts were built to disagree informatively rather than to pass. They
   * are a ratchet: the totals may improve and must not quietly get worse, which
   * is the property the recordings had lost by not being replayed at all.
   */
  const EXACT = 22052;
  const WRONG = 5191;

  /* The one place an unhinted outline is drawn differently.
   *
   * `edge-sweep` exists to take the interpreter out of the question. Its
   * glyphs have no program at all, so the outline Windows rasterises is the one
   * written into the font and scaled once, and that scaling is already known to
   * agree -- it is what the `hdmx` advances and Arial Italic's `M` measure.
   * Every one of the thirty-six is a rectangle on a bearing of nothing whose
   * right edge is three font units further out than the last, eighteen of them
   * straight and eighteen with a gently curved right side, so the sweep carries
   * an edge across a column of sample points twice over the same ground.
   *
   * All 216 agree. Ten used to differ and every one of them was a curved
   * variant -- the straight edges, walked by `CalcLine`, agreed at every size
   * and every step of the sweep throughout -- so what was left had been
   * narrowed to `CalcSpline` before it closed.
   *
   * An earlier reading of this recording said the sweep agreed everywhere. It
   * did not. That reading compared the rightmost lit column rather than the
   * cell, and the test written to compare the cell looked the recording up by a
   * name it does not have, so it returned before asserting anything. Both are
   * fixed; a recording that cannot be found now fails rather than passes.
   */
  /* And the same sweep aimed at a curve's turning point rather than its edge.
   *
   * `edge-sweep` crossed the turning-point case once, by accident. `turn-sweep`
   * asks for it: each glyph is a rectangle with one curved side whose control
   * point is a font unit further out than the last, so the extreme -- the
   * average of the two scaled ends and the scaled control -- steps across a
   * sample column in halves of a sixty-fourth. Eighteen bulge right, where the
   * turn is a maximum, and eighteen left, where it is a minimum, and each is
   * given a bearing equal to its own `xMin` so the outline is carried onto
   * nothing.
   *
   * All 216 agree, and the ceiling is nought so that one which stops agreeing
   * says so.
   *
   * It did not always. Nineteen used to differ in two distinct ways -- the
   * extreme reaching a sample column two steps early on the right and one on
   * the left at a sixteen pixel cell, and sixteen variants a pixel out on the
   * bottom row at eighteen, which is the end of the curve rather than its
   * extreme. Both are gone. Which change closed them has not been bisected:
   * the delta fix that closed the last recorded letters is not it, because the
   * sweep already agreed without that.
   */
  const TURNS = 0;

  present('sweep a turning point across a sample column', async function () {
    const recording = all.find((entry) => entry.name === 'turn-sweep');

    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = {
      ...(installed ?? {}),
      [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
    };

    const wide = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';
    const seen = new Set<string>();

    let differing = 0;

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"([^"]+)",h=(\d+),weight=(\d+),italic=(\d+),'(.)'$/.exec(record.args);

        if (!asked || asked[1] !== face || asked[3] !== '400' || asked[4] !== '0') {
          continue;
        }

        const index = wide.indexOf(asked[5]);

        if (index < 0 || Number(asked[2]) < 12 || seen.has(`${asked[2]}|${asked[5]}`)) {
          continue;
        }

        seen.add(`${asked[2]}|${asked[5]}`);

        const replayed = await replayRecord(record, recording.fixture.display ?? 'vga');

        if (replayed.outcome !== 'agreed') {
          differing++;
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(seen.size).toBeGreaterThan(200);
    expect(differing).toBeLessThanOrEqual(TURNS);
  });

  /* And the same edge leaning.
   *
   * `edge-sweep` walks a vertical edge and agrees everywhere. What was left of
   * Symbol's synthesised slant looked like a scan converter that answers an
   * *oblique* edge differently -- our sheared edge covering three columns of a
   * row where Windows' covers two -- so this asks with no slant in the
   * question at all. Every character is a parallelogram rather than a
   * rectangle, both sides leaning by the same amount, and the right side three
   * font units further out than the last. A leaning edge crosses a different
   * phase of the sample grid on every row, so one glyph is already a sweep.
   *
   * All 264 agree, at both a third and two thirds of a lean. So the scan
   * converter is not the difference, and whatever is left of the slant is in
   * the shear rather than in the walk.
   *
   * Only the simple glyphs are counted. The accented letters in the same
   * recording are composites that reference the ones this overwrote, so they
   * are drawing a parallelogram with an acute accent on it -- collateral of the
   * fabrication rather than anything measured.
   */
  const SLOPES = 0;

  present('walk a leaning edge across a column of sample points', async function () {
    const recording = all.find((entry) => entry.name === 'slope-sweep');

    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = {
      ...(installed ?? {}),
      [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
    };

    const wide = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';
    const seen = new Set<string>();

    let differing = 0;

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"([^"]+)",h=(\d+),weight=(\d+),italic=(\d+),'(.)'$/.exec(record.args);

        if (!asked || asked[1] !== face || asked[3] !== '400' || asked[4] !== '0') {
          continue;
        }

        const index = wide.indexOf(asked[5]);

        if (index < 0 || Number(asked[2]) < 12 || seen.has(`${asked[2]}|${asked[5]}`)) {
          continue;
        }

        seen.add(`${asked[2]}|${asked[5]}`);

        if ((await replayRecord(record, recording.fixture.display ?? 'vga')).outcome !== 'agreed') {
          differing++;
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(seen.size).toBeGreaterThan(200);
    expect(differing).toBeLessThanOrEqual(SLOPES);
  });

  /* Where the synthesised slant is measured rather than guessed at.
   *
   * A cell whose widest inked run is four pixels or more has an edge the scan
   * converter can find on its own, with no dropout control deciding anything.
   * Of the slanted Symbol cells in the two instruments, twenty-four are that
   * wide, and at three tenths every one of them is exact. Every wrong pixel in
   * either instrument is in a cell three pixels across or narrower.
   *
   * That is what pins the constant. Swept over the wide cells alone the minimum
   * is sharp and it is single: 0.29 costs sixteen pixels, 0.30 costs none, and
   * 0.31 costs sixteen again. Fitting a slope to the leftmost inked column of
   * the narrow bars instead gives ranges that do not intersect, which was read
   * for a while as the lean not being a constant slope at all -- but a bar one
   * pixel wide is drawn by dropout control, which places its pixel a column to
   * the left of the run rather than at the edge, so the column being fitted was
   * not the edge. The instruments were measuring the dropout rule.
   */
  /* The instrument that walks the corner, whose upright half is the control.
   *
   * `corner-phase` is `symbol-slant`'s bar again with its top corner walked
   * through a pixel: twelve steps of the side bearing across, three of the
   * bar's height down, every pair. Upright, every cell it writes is exact --
   * which is what says the sweep is a sweep of phase and nothing else, and
   * that whatever the slanted half disagrees about is the slant.
   *
   * Only the letters it writes are counted. The probe also asks for `.`, which
   * this fabrication does not replace, so that cell is Symbol's own period and
   * carries Symbol's own residual: at eight pixels Windows draws one pixel of
   * it and we draw none, which was true before this font existed.
   */
  // The letters `corner-phase` writes its bar into; see `cornerPhase`.
  const WALKED = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';

  present('walk a slanted corner through a pixel, and stand its upright still', async function () {
    const recording = all.find((entry) => entry.name === 'corner-phase');

    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = {
      ...(installed ?? {}),
      [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
    };

    let upright = 0;
    let differing = 0;

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"Symbol",h=\d+,weight=400,italic=0,'(.)'$/.exec(record.args);

        if (!asked || !WALKED.includes(asked[1])) {
          continue;
        }

        upright++;

        if ((await replayRecord(record, recording.fixture.display ?? 'vga')).outcome !== 'agreed') {
          differing++;
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(upright).toBeGreaterThanOrEqual(88);
    expect(differing).toBe(0);
  });

  /* And the same bar with its top edge tilted off the horizontal.
   *
   * `corner-phase` left the stray looking like something the horizontal top
   * edge contributes, since the scan converter has a branch for a horizontal
   * line that emits no horizontal crossings at all. `corner-cap` tilts that
   * edge -- level, up four font units, down four, up forty -- which is a
   * fiftieth of a pixel at these sizes, far too little to move a crossing but
   * enough to leave the horizontal branch. The stray survives every tilt at the
   * same rate, so the branch is not it.
   *
   * What the tilt did settle is the shape of the thing. Across the recording
   * every stray on the glyph's first inked row is to the *right* of our ink and
   * every stray on its last is to the *left* -- twenty and eight of them,
   * without exception -- and the bar leans right going up. So it lies toward
   * whichever end the shape reaches past that scanline, at both ends, whatever
   * the edge that closes it is doing.
   *
   * Its upright half is exact, which is the control.
   */
  present('tilt the top edge off the horizontal', async function () {
    const recording = all.find((entry) => entry.name === 'corner-cap');

    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = {
      ...(installed ?? {}),
      [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
    };

    let upright = 0;
    let differing = 0;

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"Symbol",h=\d+,weight=400,italic=0,'(.)'$/.exec(record.args);

        if (!asked || !WALKED.includes(asked[1])) {
          continue;
        }

        upright++;

        if ((await replayRecord(record, recording.fixture.display ?? 'vga')).outcome !== 'agreed') {
          differing++;
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(upright).toBeGreaterThanOrEqual(88);
    expect(differing).toBe(0);
  });

  /* The shear written into the outline, which is the control that closes the
   * question of whose fault the synthesised slant is.
   *
   * `slant-baked` is `symbol-slant`'s bar with the lean baked in: each glyph is
   * the same parallelogram `Surface.slant` builds, to the font unit, and the
   * probe asks for it upright so Windows synthesises nothing. Every one of the
   * 88 cells is exact, to the pixel.
   *
   * So a narrow oblique hairline is scan-converted the same way by both sides,
   * and the fill is not what the slant instruments are complaining about. What
   * they are complaining about is the synthesis: Windows drawing this very
   * shape by shearing the letter differs from Windows drawing it out of the
   * outline, and the second is what we do. See `FONTS.md` section 3.
   */
  present('rasterise a hairline that leans in the outline', async function () {
    await bakedLeans('slant-baked');
  });

  /* And the same at a dozen leans, which is what turns the control into a
   * measuring instrument.
   *
   * `slant-angle` bakes the bar at twelve leans from a fifth to nine twentieths
   * and asks for each upright. All 88 cells are exact, so a recording of a baked
   * shape is a direct readout of what Windows draws for that shape, with none of
   * our pipeline in the way. Comparing those readouts against `symbol-slant`'s
   * *slanted* cells then says which lean Windows' own synthesis is drawing --
   * and at twelve and fifteen pixels the answer is none of them. See `FONTS.md`
   * section 3.
   */
  present('rasterise that hairline at a dozen leans', async function () {
    await bakedLeans('slant-angle');
  });

  /* And at a dozen widths, which is what rules the last shape out.
   *
   * Windows' synthesised glyph is wider than the bar it came from, and a shear
   * does not widen anything, so `slant-width` bakes the leaning bar at twelve
   * widths from 160 font units to 380 and asks for each upright. All 88 are
   * exact. Set beside `symbol-slant`'s slanted cells, twelve and fifteen and
   * twenty pixels match no width at all -- as they matched no lean -- which
   * between them say the synthesised glyph is not a parallelogram. See
   * `FONTS.md` section 3.
   */
  present('rasterise that hairline at a dozen widths', async function () {
    await bakedLeans('slant-width');
  });

  async function bakedLeans(name: string) {
    const recording = all.find((entry) => entry.name === name);

    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = {
      ...(installed ?? {}),
      [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
    };

    let upright = 0;
    let differing = 0;

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"Symbol",h=\d+,weight=400,italic=0,'(.)'$/.exec(record.args);

        if (!asked || !WALKED.includes(asked[1])) {
          continue;
        }

        upright++;

        if ((await replayRecord(record, recording.fixture.display ?? 'vga')).outcome !== 'agreed') {
          differing++;
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(upright).toBeGreaterThanOrEqual(88);
    expect(differing).toBe(0);
  }

  const NARROW = 4;

  present('slant a feature wide enough that dropout control decides nothing', async function () {
    let wide = 0;
    let differing = 0;

    for (const name of ['symbol-slant', 'symbol-shapes']) {
      const recording = all.find((entry) => entry.name === name);

      expect(recording).toBeTruthy();

      const manager: any = await prepareFonts();
      const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
      const face = font.faceName;
      const installed = manager._outlines[face];

      manager._outlines[face] = {
        ...(installed ?? {}),
        [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
      };

      try {
        for (const record of recording.fixture.records) {
          if (!/^"Symbol",h=\d+,weight=\d+,italic=1,/.test(record.args)) {
            continue;
          }

          if (widestRun(record.result) < NARROW) {
            continue;
          }

          wide++;

          if (
            (await replayRecord(record, recording.fixture.display ?? 'vga')).outcome !== 'agreed'
          ) {
            differing++;
          }
        }
      } finally {
        manager._outlines[face] = installed;
      }
    }

    expect(wide).toBeGreaterThanOrEqual(24);
    expect(differing).toBe(0);
  });

  const EDGES = 0;

  present('draw an unhinted edge the same except where it grazes a sample', async function () {
    const recording = all.find((entry) => entry.name === 'edge-sweep');

    // Not `return`: a name that stops matching would pass without running.
    expect(recording).toBeTruthy();

    const manager: any = await prepareFonts();
    const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
    const face = font.faceName;
    const installed = manager._outlines[face];

    manager._outlines[face] = {
      ...(installed ?? {}),
      [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
    };

    const wide = 'ABEKMNRSWXZabdefgjkmnostwy0123456789';
    const seen = new Set<string>();
    const differing: string[] = [];

    try {
      for (const record of recording.fixture.records) {
        const asked = /^"([^"]+)",h=(\d+),weight=(\d+),italic=(\d+),'(.)'$/.exec(record.args);

        if (!asked || asked[1] !== face || asked[3] !== '400' || asked[4] !== '0') {
          continue;
        }

        const index = wide.indexOf(asked[5]);

        // Below twelve the mapper answers with a strike rather than this face.
        if (index < 0 || Number(asked[2]) < 12 || seen.has(`${asked[2]}|${asked[5]}`)) {
          continue;
        }

        seen.add(`${asked[2]}|${asked[5]}`);

        const replayed = await replayRecord(record, recording.fixture.display ?? 'vga');

        if (replayed.outcome !== 'agreed') {
          differing.push(
            `${index >= 18 ? 'curved' : 'straight'} h=${asked[2]} at=${200 + (index % 18) * 3}`
          );
        }
      }
    } finally {
      manager._outlines[face] = installed;
    }

    expect(seen.size).toBeGreaterThan(200);
    expect(differing.length).toBeLessThanOrEqual(EDGES);
  });

  present(
    'agree with Windows on three thousand cells of chosen geometry',
    async function () {
      const manager: any = await prepareFonts();

      let exact = 0;
      let wrong = 0;
      let total = 0;

      const report: string[] = [];

      for (const recording of all) {
        const font: any = new TrueTypeFont(new Uint8Array(readFileSync(recording.file)));
        const face = font.faceName;

        /* The fabricated file stands in for the face it was cut from, so the
         * mapper has to answer with it and not with the installed one. Putting
         * it back afterwards keeps the recordings independent of each other.
         */
        const installed = manager._outlines[face];

        manager._outlines[face] = {
          ...(installed ?? {}),
          [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
        };

        let fileExact = 0;
        let fileWrong = 0;
        let fileTotal = 0;

        try {
          for (const record of recording.fixture.records) {
            if (!record.args.startsWith(`"${face}"`)) {
              continue;
            }

            fileTotal++;

            const replayed = await replayRecord(record, recording.fixture.display ?? 'vga');
            const wanted = String(replayed.expected);
            const drawn = replayed.actual === null ? '' : String(replayed.actual);

            if (replayed.outcome === 'agreed') {
              fileExact++;
            }

            if (wanted.length !== drawn.length) {
              fileWrong += wanted.length * 4;

              continue;
            }

            for (let at = 0; at < wanted.length; at++) {
              const differing = parseInt(wanted[at], 16) ^ parseInt(drawn[at], 16);

              fileWrong +=
                (differing & 1) +
                ((differing >> 1) & 1) +
                ((differing >> 2) & 1) +
                ((differing >> 3) & 1);
            }
          }
        } finally {
          manager._outlines[face] = installed;
        }

        exact += fileExact;
        wrong += fileWrong;
        total += fileTotal;

        report.push(
          `  ${recording.name.padEnd(18)} ${String(fileExact).padStart(4)}/${String(fileTotal).padStart(4)} cells  ${String(fileWrong).padStart(5)} wrong pixels`
        );
      }

      report.push(`  ${'TOTAL'.padEnd(18)} ${exact}/${total} cells  ${wrong} wrong pixels`);

      console.log(report.join('\n'));

      // Sixteen recordings of 846 cells, of which those naming the face count.
      expect(total).toBeGreaterThan(3000);

      expect(exact).toBeGreaterThanOrEqual(EXACT);
      expect(wrong).toBeLessThanOrEqual(WRONG);
    },
    1800000
  );
});
