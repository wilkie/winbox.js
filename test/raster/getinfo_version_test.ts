/**
 * @jest-environment jsdom
 *
 * What the scaler answers when a font asks what is running it.
 *
 * `GETINFO` takes a selector and returns a word. Bit zero asks for the version,
 * and the version is not a flag but a small number or-ed into the low end of
 * the reply, so a font that compares it against two or three takes a different
 * path depending on the answer. Nothing in the recorded set asks, which is why
 * the number had been assumed.
 *
 * `getinfo-version` asks, multiplies the reply into a coordinate and puts it on
 * the advance phantom, so Windows' own answer comes back through the width.
 * `getinfo-nothing` asks with no bits set and is the control: its reply is
 * nought, which pins the phantom at the origin and shows the width is carrying
 * the instruction's answer rather than the letter's own measurements.
 *
 * Arial Italic has an `hdmx`, and a size it covers is answered from that with
 * no program run at all. Those sizes report the letter's width for both alike,
 * so a size counts as read only where the two disagree.
 */

'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const CASES = ['getinfo-version', 'getinfo-nothing'] as const;
const FONTS = 'oracle/build/fonts';

const fixtureFor = (name: string) => `oracle/fixtures/fabricated/hinting-${name}.json`;

const ASKED = /^"Arial",h=(\d+),italic=1,'m'$/;

/** The reply is multiplied by this before it becomes a coordinate. */
const MAGNIFY = 8;

async function readingsOf(name: string) {
  const fixture = JSON.parse(readFileSync(fixtureFor(name), 'utf8'));
  const dir = join(FONTS, String(fixture.font));
  const manager: any = await prepareFonts();
  const font: any = new TrueTypeFont(new Uint8Array(readFileSync(join(dir, readdirSync(dir)[0]))));
  const face = font.faceName;
  const installed = manager._outlines[face];

  manager._outlines[face] = {
    ...(installed ?? {}),
    [FontManager.styleKey(font.boldFace, font.italicFace)]: font,
  };

  const out = new Map<number, { windows: string; agreed: boolean }>();

  try {
    for (const record of fixture.records) {
      const asked = ASKED.exec(record.args ?? '');

      if (!asked) {
        continue;
      }

      out.set(Number(asked[1]), {
        windows: record.result,
        agreed: (await replayRecord(record, fixture.display ?? 'vga')).outcome === 'agreed',
      });
    }
  } finally {
    manager._outlines[face] = installed;
  }

  return out;
}

if (!CASES.every((name) => existsSync(fixtureFor(name)))) {
  describe('the version GETINFO answers', () => {
    it.skip('needs the recordings; run the oracle pipeline', () => {});
  });
} else {
  describe('the version GETINFO answers', () => {
    let all: Map<string, Map<number, { windows: string; agreed: boolean }>>;
    let live: number[];

    beforeAll(async () => {
      all = new Map();

      for (const name of CASES) {
        all.set(name, await readingsOf(name));
      }

      const asked = all.get('getinfo-version')!;
      const none = all.get('getinfo-nothing')!;

      live = [...asked.keys()].filter(
        (height) => asked.get(height)!.windows !== none.get(height)?.windows
      );
    }, 300000);

    it('is three, and the same three at every size', () => {
      expect(live.length).toBeGreaterThan(4);

      const asked = all.get('getinfo-version')!;
      const none = all.get('getinfo-nothing')!;

      const replies = new Set(
        live.map((height) => Number(/advance=(-?\d+)/.exec(asked.get(height)!.windows)![1]))
      );

      /* One answer, whatever the size: the version does not depend on how big
       * the letter is, which is what tells a reply from a leftover width.
       */
      expect(replies.size).toBe(1);
      expect([...replies][0] / MAGNIFY).toBe(3);

      // And with no bit asked for, nothing is answered.
      for (const height of live) {
        expect(/advance=(-?\d+)/.exec(none.get(height)!.windows)![1]).toBe('0');
      }
    });

    for (const name of CASES) {
      it(`agrees with Windows on ${name}`, () => {
        const readings = all.get(name)!;

        expect([...readings.values()].filter((reading) => !reading.agreed).length).toBe(0);
      });
    }
  });
}
