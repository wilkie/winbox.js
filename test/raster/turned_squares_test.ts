/**
 * @jest-environment jsdom
 *
 * Replaying the turned-square recordings, 8u.
 *
 * `rotsq` and `rotpen` were recorded against `rot-square`, Symbol with every
 * letter replaced by one plain square and no hint program, so that a turned
 * glyph's ink is the transform and the pen walk and nothing else. They are the
 * instruments that settled how an oblique angle is drawn -- the matrix with
 * whole-pixel entries, the origin carried along the exact angle and rounded,
 * and the font's own `prep` switching fitting off -- and like the other shape
 * fonts they live under `fabricated/`, which the conformance suite does not
 * replay. So this does, as a ratchet: the totals may improve and must not
 * quietly get worse.
 *
 * Symbol's strikes are taken out of the mapper while they replay. At a cell of
 * sixteen Windows answers a *turned* request with the outline and this answers
 * it with the strike -- the mapper's own gap, `rotsize` in `KNOWN_GAPS` -- and
 * the question here is the drawing, not the choice.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures', 'fabricated');
const FONTS = join(__dirname, '..', '..', 'oracle', 'build', 'fonts', 'rot-square');

function fixture(name: string) {
  const path = join(FIXTURES, name);

  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

const oblique = (args: string) => {
  const escapement = Number((args.match(/esc=(-?\d+)/) ?? [])[1] ?? 0);

  return ((escapement % 3600) + 3600) % 3600 % 900 !== 0;
};

/** How many pixels two recorded bitmaps disagree about. */
function wrong(expected: string, actual: string) {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(actual, 'hex');

  let count = 0;

  for (let index = 0; index < a.length; index++) {
    let bits = a[index] ^ (b[index] ?? 0xff);

    while (bits) {
      count += bits & 1;
      bits >>= 1;
    }
  }

  return count;
}

async function withSquares(run: () => Promise<void>) {
  const manager: any = await prepareFonts();
  const font: any = new TrueTypeFont(new Uint8Array(readFileSync(join(FONTS, readdirSync(FONTS)[0]))));
  const face = font.faceName;
  const installed = manager._outlines[face];
  const strikes = manager._fonts[face];

  manager._outlines[face] = {
    ...(installed ?? {}),
    [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
  };
  delete manager._fonts[face];

  try {
    await run();
  } finally {
    manager._outlines[face] = installed;
    manager._fonts[face] = strikes;
  }
}

describe('the turned-square recordings', () => {
  const squares = fixture('rotsq-rot-square.json');
  const pens = fixture('rotpen-rot-square.json');
  const present = squares && pens && existsSync(FONTS) ? it : it.skip;

  /* One square at every ten degrees and a tenth of a degree at a time across
   * half a right angle, at a cell of thirty-two.
   *
   * 70 of the 91 oblique squares are exact. Every one that is not is out by a
   * pixel at a tip or a corner, where the edge the scan converter walks passes
   * within a sixty-fourth or two of a pixel centre -- at 43.0 to 43.5 degrees
   * the right-hand tip is lit a row high, six times over, because the matrix
   * does not change across that range. That is the scan converter's own
   * arithmetic and not the transform's, and it is where this stops.
   */
  const SQUARES_EXACT = 70;
  const SQUARES_WRONG = 38;

  /* The same square at a cell of sixteen, thirteen per em, whose ascent and
   * size give every carry a different fraction. */
  const SMALL_EXACT = 25;

  /* One, two and three squares at every five degrees off the axes, at four
   * sizes. The walk is exact: every record that disagrees does so in its first
   * square, so one, two and three squares fail at the same angles. */
  const PEN_EXACT = 236;

  present('draws a turned square where Windows does', async function () {
    let exact = 0;
    let pixels = 0;
    let small = 0;

    await withSquares(async () => {
      for (const record of squares.records) {
        if (record.function !== 'square ink' || !oblique(record.args) || record.args.includes('"AB"')) {
          continue;
        }

        const replayed: any = await replayRecord(record, squares.display ?? 'vga');
        const missed = wrong(record.result, String(replayed.actual));

        if (record.args.startsWith('h=32')) {
          exact += missed ? 0 : 1;
          pixels += missed;
        } else if (!missed) {
          small++;
        }
      }
    });

    expect(exact).toBeGreaterThanOrEqual(SQUARES_EXACT);
    expect(pixels).toBeLessThanOrEqual(SQUARES_WRONG);
    expect(small).toBeGreaterThanOrEqual(SMALL_EXACT);
  });

  present('walks the pen along a turned baseline where Windows does', async function () {
    const agreed: Record<string, number> = {};

    await withSquares(async () => {
      for (const record of pens.records) {
        if (record.function !== 'pen ink') {
          continue;
        }

        const replayed: any = await replayRecord(record, pens.display ?? 'vga');
        const text = (record.args.match(/text="(\w+)"/) ?? [])[1];

        agreed[text] = (agreed[text] ?? 0) + (replayed.outcome === 'agreed' ? 1 : 0);
      }
    });

    expect(agreed.A).toBeGreaterThanOrEqual(PEN_EXACT);
    expect(agreed.AB).toBeGreaterThanOrEqual(PEN_EXACT);
    expect(agreed.ABA).toBeGreaterThanOrEqual(PEN_EXACT);
  });
});
