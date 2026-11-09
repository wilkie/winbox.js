'use strict';

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The bookkeeping of the conformance suite's shards, apart from the replay so
 * that Jest's global setup and teardown can use it without loading the
 * emulator. See `conformance.ts`.
 */

/** How many test files the replay is split into, under `conformance/`. */
export const SHARDS = 16;

const COSTS = join(__dirname, 'fixture-costs.json');

/**
 * The shards of one run write their shares here: the global setup names a
 * fresh directory, and the global teardown merges it and removes it.
 */
export const shareDirectory = () => process.env.WINBOX_CONFORMANCE_SHARES ?? null;

/** Called by `test/global-setup.ts`. */
export function prepareShares(directory: string) {
  mkdirSync(directory, { recursive: true });
  process.env.WINBOX_CONFORMANCE_SHARES = directory;
}

/**
 * Called by `test/global-teardown.ts`. With `WINBOX_CONFORMANCE_COSTS=1`, a
 * run in which every shard replayed every one of its fixtures rewrites
 * `fixture-costs.json` from what each fixture took, for the next split.
 *
 * The shares' reports are not merged into `kb/data/conformance.json`: since
 * 2026-11-08 the Rust replay (`cargo test --release -p winbox-win16 --test
 * conformance`) is that report's only writer.
 */
export function mergeShares(directory: string) {
  try {
    const shares = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));

    if (shares.length !== SHARDS || shares.some((share) => !share.complete)) {
      return;
    }

    if (process.env.WINBOX_CONFORMANCE_COSTS === '1') {
      const costs = Object.assign({}, ...shares.map((share) => share.costs));

      writeFileSync(
        COSTS,
        JSON.stringify(
          Object.fromEntries(Object.entries(costs).sort(([a], [b]) => a.localeCompare(b))),
          null,
          1
        ) + '\n'
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
