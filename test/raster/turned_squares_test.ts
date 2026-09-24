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
 * At a cell of sixteen the turned squares are Symbol's outline and not its
 * sixteen row strike, because the exact-strike arm refuses any request with an
 * angle; see `FontManager.map`. These replay through the mapper as it is.
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

  manager._outlines[face] = {
    ...(installed ?? {}),
    [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
  };

  try {
    await run();
  } finally {
    manager._outlines[face] = installed;
  }
}

describe('the turned-square recordings', () => {
  const squares = fixture('rotsq-rot-square.json');
  const pens = fixture('rotpen-rot-square.json');
  const present = squares && pens && existsSync(FONTS) ? it : it.skip;

  /* Every one of them is exact, and the ceilings are nought so that one which
   * stops agreeing says so. They were 70 of 91, 25 of 32 and 236 of 272 until
   * the transform was read out of `GDI.EXE` rather than fitted; see
   * `Surface.turnOutline` and FONTS.md 8u.
   *
   * One square at every ten degrees and a tenth of a degree at a time across
   * half a right angle, at a cell of thirty-two; the same at sixteen; and one,
   * two and three squares at every five degrees off the axes at four sizes.
   */
  const SQUARES_EXACT = 91;
  const SQUARES_WRONG = 0;
  const SMALL_EXACT = 32;
  const PEN_EXACT = 272;

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
