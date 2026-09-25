'use strict';

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The bookkeeping of the conformance suite's shards, apart from the replay so
 * that Jest's global setup and teardown can use it without loading the
 * emulator. See `conformance.ts`.
 */

/** How many test files the replay is split into, under `conformance/`. */
export const SHARDS = 16;

const ROOT = join(__dirname, '..', '..');
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

/** The fixtures git tracks, so that a local, uncommitted recording stays out of a tracked report. */
function trackedFixtures(): Set<string> | null {
  try {
    const listed = execFileSync('git', ['ls-files', 'oracle/fixtures'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return new Set(
      listed
        .split('\n')
        .map((path) => path.replace(/^oracle\/fixtures\//, '').replace(/\.json$/, ''))
    );
  } catch {
    return null;
  }
}

/**
 * Called by `test/global-teardown.ts`: merges the shares into
 * `kb/data/conformance.json`, but only when every shard replayed every one of
 * its fixtures, so a filtered run never leaves a partial report behind. The
 * report is sorted and free of anything that varies between runs, so a green
 * run on unchanged code leaves it byte for byte as it was. See
 * `KNOWLEDGE_BASE_SPEC.md`, phase 2.
 *
 * With `WINBOX_CONFORMANCE_COSTS=1`, a complete run also rewrites
 * `fixture-costs.json` from what each fixture took, for the next split.
 */
export function mergeShares(directory: string) {
  try {
    const shares = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')));

    if (shares.length !== SHARDS || shares.some((share) => !share.complete)) {
      return;
    }

    const report = Object.assign({}, ...shares.map((share) => share.report));
    const tracked = trackedFixtures();
    const sorted = Object.fromEntries(
      Object.entries(report)
        .filter(([file]) => !tracked || tracked.has(file))
        .sort(([a], [b]) => a.localeCompare(b))
    );

    writeFileSync(
      join(ROOT, 'kb', 'data', 'conformance.json'),
      JSON.stringify(sorted, null, 1) + '\n'
    );

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
