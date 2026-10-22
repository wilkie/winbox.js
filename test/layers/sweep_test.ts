'use strict';

import { bundle } from '../win16/run-probe.js';
import { difference, runs } from './runs.js';

/**
 * The layered base's sweep: every probe, run on the asset bundle's base and
 * on it in layers (`runs.ts`), writes the same records on both, exactly.
 * Runs only with `LAYERS_SWEEP=1`; `LAYERS_SWEEP_PROBES=a,b` runs those
 * fixtures alone, `LAYERS_SWEEP_SHARD=k/n` the k-th of n shares of them, and
 * `LAYERS_SWEEP_LOG=1` tells each as it is run.
 */

const sweeping = process.env.LAYERS_SWEEP === '1' && bundle() !== null;

(sweeping ? describe : describe.skip)('the layered base, every probe', () => {
  it('writes what the base in one folder writes', async () => {
    const all = runs((process.env.LAYERS_SWEEP_PROBES ?? '').split(',').filter(Boolean));
    const [k, n] = (process.env.LAYERS_SWEEP_SHARD ?? '1/1').split('/').map(Number);
    const swept = all.filter((_, index) => index % n === k - 1);
    const found: string[] = [];
    const started = Date.now();

    for (const each of swept) {
      const begun = Date.now();
      const differing = await difference(each);

      if (process.env.LAYERS_SWEEP_LOG) {
        process.stderr.write(
          `${each.fixture}: ${differing ? 'differs' : 'same'}, ${Date.now() - begun} ms\n`
        );
      }

      if (differing) {
        found.push(differing);
      }
    }

    process.stderr.write(
      `${swept.length} fixtures on the layers and the folder in ${Math.round((Date.now() - started) / 1000)} s: ${found.length} differ\n`
    );
    expect(found).toEqual([]);
  }, 86_400_000);
});
