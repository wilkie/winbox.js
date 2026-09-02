/**
 * Reading a fabricated glyph's reports back out of a `hinting` recording.
 *
 * A fabrication that answers through the advance phantom is replayed the same
 * way every time: install the fabricated font over the face it names, run every
 * record the sweep made of the letter it rewrote, and keep what Windows said
 * beside whether we said the same.
 *
 * The sizes are kept by cell height rather than by the pixel size the record
 * reports, because two heights can report one pixel size and still scale
 * differently -- the reported size is derived from the metrics, not the input.
 */

'use strict';

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FontManager } from '../../src/win16/font-manager.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts, replayRecord } from '../oracle/replay.js';

const FONTS = 'oracle/build/fonts';

export type Reading = { windows: string; agreed: boolean };

export const fixtureFor = (name: string) => `oracle/fixtures/fabricated/hinting-${name}.json`;

/** What Windows reported as the width, which is the fabrication's answer. */
export const advanceOf = (reading: Reading) => Number(/advance=(-?\d+)/.exec(reading.windows)![1]);

/** The pixel size Windows fitted the cell to, reported alongside the width. */
export const ppemOf = (reading: Reading) => Number(/ppem=(\d+)/.exec(reading.windows)![1]);

export async function readingsOf(name: string, asked: RegExp) {
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

  const out = new Map<number, Reading>();

  try {
    for (const record of fixture.records) {
      const height = asked.exec(record.args ?? '');

      if (!height) {
        continue;
      }

      out.set(Number(height[1]), {
        windows: record.result,
        agreed: (await replayRecord(record, fixture.display ?? 'vga')).outcome === 'agreed',
      });
    }
  } finally {
    manager._outlines[face] = installed;
  }

  return out;
}
