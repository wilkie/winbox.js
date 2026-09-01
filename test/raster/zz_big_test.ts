/** @jest-environment jsdom */
'use strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TrueTypeFont } from '../../src/raster/truetype-font.js';
import { prepareFonts } from '../oracle/replay.js';

it('finds the big moves', async () => {
  await prepareFonts();
  const dir = 'oracle/build/fonts/cour-no-instctrl';
  const font: any = new TrueTypeFont(new Uint8Array(readFileSync(join(dir, readdirSync(dir)[0]))));
  (globalThis as any).__big = [];
  font._hinters = undefined;
  font.hintedOutline(font.glyphFor('w'.charCodeAt(0)), 8);
  console.log((globalThis as any).__big.slice(0, 10).join('\n') || '(no large moves)');
  expect(true).toBe(true);
}, 60000);
