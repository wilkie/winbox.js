'use strict';

import { STAMP } from '../../src/assets/compose.js';
import { baseLayer, flatLines, flattenStack } from '../../src/layers/layer.js';
import { bundle } from '../assets/built.js';
import { layeredBase, splitBase } from './split.js';

/**
 * The layered base (`WINBOX_BASE=layers`, `split.ts`): the stack flattens
 * to the asset bundle's base, the decoy nowhere. Page code alone; what the
 * probes write on it is held by `crates/winbox-win16/tests/layers_sweep.rs`.
 * Skipped without the bundle (`pnpm assets`).
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
});
