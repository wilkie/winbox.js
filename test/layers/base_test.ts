'use strict';

import { STAMP } from '../../src/assets/compose.js';
import { baseLayer, flatLines, flattenStack } from '../../src/layers/layer.js';
import { bundle } from '../win16/run-probe.js';
import { difference, runs } from './runs.js';
import { layeredBase, splitBase } from './split.js';

/**
 * The layered base (`WINBOX_BASE=layers`, `split.ts`) on every run: the
 * stack flattens to the asset bundle's base, the decoy nowhere; and a
 * handful of probes that list folders, open, search and write files and
 * read and write the profiles write on it exactly what they write on the
 * base made directly. The whole sweep is `sweep_test.ts`. Skipped without
 * the bundle (`pnpm assets`) or the probes.
 */

const ready = bundle() !== null;

(ready ? describe : describe.skip)('the layered base', () => {
  it('flattens to the base on each display', async () => {
    const assets = bundle()!;

    for (const display of assets.displays) {
      const base = await baseLayer(assets.compose(display), assets.id, display);
      const { stack, flat } = await layeredBase(assets, display);

      expect(stack.length).toBe(7);
      expect(stack[3].manifest.over).toEqual(stack.slice(0, 3).map((layer) => layer.manifest.id));
      expect(flatLines(flat)).toEqual(flatLines(flattenStack([base])));
      expect(flat.folders.every(({ modified }) => modified === STAMP)).toBe(true);
      expect((await splitBase(base)).map((layer) => layer.manifest.id)).toEqual(
        stack.map((layer) => layer.manifest.id)
      );
    }
  });

  for (const each of runs([
    'dirorder',
    'diskfree',
    'filecdr',
    'loadpath',
    'openfile',
    'profile',
    'profnew',
  ])) {
    it(`${each.fixture} writes on it what it writes on the base made directly`, async () => {
      expect(await difference(each, true)).toBeNull();
    }, 300_000);
  }
});
