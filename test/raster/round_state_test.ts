/**
 * @jest-environment jsdom
 *
 * `SROUND` and `S45ROUND`, measured rather than read from the specification.
 *
 * Both pack a period, a phase and a threshold into one byte, and both have
 * corners that no font in the recorded set reaches: the fourth period selector,
 * which the reference marks illegal and gives a period of 999, and the
 * forty-five degree period, which is a square root and so not a power of two.
 *
 * Each fabrication sets one round state and then rounds a single point with
 * `MDAP[r]`, reporting where it landed. The point's own position moves a
 * sixty-fourth at a time as the size changes, so the size sweep walks the value
 * across every period and phase the argument describes -- one argument, ninety
 * nine samples of what it does.
 *
 * Arial Italic has an `hdmx`, and a size it covers is answered from that without
 * the program running at all. Those sizes report the letter's own width for
 * every fabrication alike, so a size counts as read only where two of them
 * disagree.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts } from '../oracle/replay.js';

const CASES = ['sround-illegal', 'sround-quarter', 's45round-half'] as const;

/** What is left. The forty-five degree period is a root, and rounds two ways. */
const DIFFER: Record<string, number> = {
  'sround-illegal': 0,
  'sround-quarter': 0,
  's45round-half': 2,
};

function readingsOf(name: string) {
  const dir = join('oracle/build/fonts', name);
  const font: any = new TrueTypeFont(new Uint8Array(readFileSync(join(dir, readdirSync(dir)[0]))));
  const fixture = JSON.parse(
    readFileSync(`oracle/fixtures/fabricated/hinting-${name}.json`, 'utf8')
  );
  const glyph = font.glyphFor('m'.charCodeAt(0));
  const out = new Map<number, { windows: number; ours: number }>();

  for (const record of fixture.records) {
    if (!/^"Arial",h=\d+,italic=1,'m'$/.test(record.args ?? '')) {
      continue;
    }

    const answer = /advance=(-?\d+),ppem=(\d+)/.exec(record.result);

    if (!answer || out.has(Number(answer[2]))) {
      continue;
    }

    font._hinters = undefined;

    out.set(Number(answer[2]), {
      windows: Number(answer[1]),
      ours: font.hintedAdvance(glyph, Number(answer[2])),
    });
  }

  return out;
}

if (!CASES.every((name) => existsSync(`oracle/fixtures/fabricated/hinting-${name}.json`))) {
  describe('the round state a byte describes', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the round state a byte describes', () => {
    let all: Map<string, Map<number, { windows: number; ours: number }>>;
    let live: number[];

    beforeAll(async () => {
      await prepareFonts();

      all = new Map(CASES.map((name) => [name, readingsOf(name)]));

      const illegal = all.get('sround-illegal')!;
      const quarter = all.get('sround-quarter')!;

      live = [...illegal.keys()].filter(
        (ppem) => illegal.get(ppem)!.windows !== quarter.get(ppem)?.windows
      );
    }, 180000);

    it('rounds with a mask, so an illegal period is not a whole pixel', () => {
      expect(live.length).toBeGreaterThan(20);

      const illegal = all.get('sround-illegal')!;

      /* A period of 999 masked with `~998` lands nowhere near a pixel boundary
       * and the answer moves with the input, which is how the mask shows itself:
       * a division by 999 would give the same answer every time.
       */
      expect(new Set(live.map((ppem) => illegal.get(ppem)!.windows)).size).toBeGreaterThan(1);
    });

    for (const name of CASES) {
      it(`agrees with Windows on ${name}`, () => {
        const readings = all.get(name)!;
        const differ = live.filter(
          (ppem) => readings.get(ppem)!.ours !== readings.get(ppem)!.windows
        );

        expect(differ.length).toBeLessThanOrEqual(DIFFER[name]);
      });
    }
  });
}
