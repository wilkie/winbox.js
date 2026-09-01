/**
 * @jest-environment jsdom
 */
'use strict';
import { readFileSync } from 'node:fs';
import { prepareFonts, replayRecord } from '../oracle/replay.js';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';

const span = (hex: string) => {
  let lo = 99, hi = -1;
  for (let row = 0; row < 32; row++)
    for (let col = 0; col < 32; col++) {
      const bit = row * 4 + (col >> 3);
      const byte = parseInt(hex.slice(bit * 2, bit * 2 + 2), 16);
      if (!(byte & (0x80 >> (col & 7)))) { lo = Math.min(lo, col); hi = Math.max(hi, col); }
    }
  return [lo, hi];
};

it('measures the shift at each size', async () => {
  await prepareFonts();
  const fixture = JSON.parse(readFileSync('oracle/fixtures/glyphs.json', 'utf8'));
  const seen: number[] = [];
  const original = TrueTypeFont.prototype.hintedOutline;
  (TrueTypeFont.prototype as any).hintedOutline = function (glyph: number, ppem: number, ...rest: any[]) {
    seen.push(ppem);
    return original.call(this, glyph, ppem, ...rest);
  };
  try {
    for (const character of ['X', 'Z', 'A']) {
      for (const h of [12, 16, 24]) {
        const record = fixture.records.find(
          (r: any) => r.args === `"Courier New",h=${h},weight=700,italic=1,'${character}'`
        );
        if (!record) continue;
        seen.length = 0;
        const replayed: any = await replayRecord(record, 'vga');
        const w = span(record.result);
        const o = span(String(replayed.actual ?? ''));
        console.log(`'${character}' h=${String(h).padStart(2)} ppem ${seen[0]} | windows cols ${w[0]}..${w[1]} | ours ${o[0]}..${o[1]} | ${replayed.outcome}`);
      }
    }
  } finally {
    (TrueTypeFont.prototype as any).hintedOutline = original;
  }
}, 300000);
