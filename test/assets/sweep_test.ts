'use strict';

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOX_KEYS } from '../oracle/replay.js';
import {
  PROBES,
  bundle,
  imageFor,
  outputOf,
  recordsFrom,
  runProbe,
  type Base,
} from '../win16/run-probe.js';

/**
 * The fidelity sweep of the asset bundle's base, as the Rust engine's
 * `tests/assets_sweep.rs`: every probe run whole on the oracle's
 * installation and on the base the bundle composes for its display, each on
 * the virtual clock, and each record the two runs write differently held to
 * `test/oracle/assets-differences.json`, where each has its reason
 * (`kb/topics/asset-bundle.md`). A difference it does not list fails, and so
 * does one it lists that no longer comes.
 *
 * Every probe twice is an hour and more of this engine: the sweep runs only
 * with `ASSETS_SWEEP=1`, and the bundle (`pnpm assets`) and the probes built.
 * `ASSETS_SWEEP_PROBES=a,b` runs those fixtures alone, `ASSETS_SWEEP_SHARD=k/n`
 * the k-th of n shares of them, and `ASSETS_SWEEP_OUT=file` writes every
 * difference found there as JSON.
 *
 * A probe recorded with a sound card (`vgasound`) is not run: this engine has
 * none, and its sound is the Rust engine's.
 */

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

interface Run {
  fixture: string;
  probe: string;
  display: string;
  ini: string | null;
}

/** Each fixture this engine can run whole on both bases. */
function runs(): Run[] {
  const only = (process.env.ASSETS_SWEEP_PROBES ?? '').split(',').filter(Boolean);
  const all = readdirSync(FIXTURES)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
      /* `vgaprint` is the VGA's installation with a printer, which the run
       * puts in itself (`run-probe.ts`). */
      const display = fixture.display === 'vgaprint' ? 'vga' : (fixture.display ?? 'vga');

      return {
        fixture: file.replace(/\.json$/, ''),
        probe: fixture.probe as string,
        display,
        ini: (fixture.source?.ini as string | undefined) ?? null,
      };
    })
    .filter(({ fixture }) => !only.length || only.includes(fixture))
    .filter(({ display }) => display !== 'vgasound' && existsSync(imageFor(display)))
    .filter(({ probe }) => existsSync(join(PROBES, `${probe.toUpperCase()}.EXE`)));
  const [k, n] = (process.env.ASSETS_SWEEP_SHARD ?? '1/1').split('/').map(Number);

  return all.filter((_, index) => index % n === k - 1);
}

/** A probe's run on a base: how it ended, and what it wrote. */
async function run({ probe, display, ini }: Run, base: Base) {
  const { fileSystem, failure } = await runProbe(probe, 4000, false, true, 30, {
    boxKeys: BOX_KEYS[probe] ?? [],
    display,
    iniPreset: ini,
    virtual: true,
    keepCalls: 0,
    base,
  });

  return {
    stop: failure ? `failed: ${failure?.message ?? failure}` : 'ran',
    records: recordsFrom((await outputOf(fileSystem, probe)) ?? ''),
  };
}

/** A record's key, `function(args)`, and what each run wrote for it. */
type Difference = [string, string | null, string | null];

/**
 * The records two runs write differently, each occurrence of a call held to
 * the same occurrence in the other; and how they ended, as the key `stop`,
 * where that differs.
 */
function differences(
  installed: Awaited<ReturnType<typeof run>>,
  assets: Awaited<ReturnType<typeof run>>
): Difference[] {
  const found: Difference[] = [];

  if (installed.stop !== assets.stop) {
    found.push(['stop', installed.stop, assets.stop]);
  }

  const byKey = (records: string[]) => {
    const keyed = new Map<string, string[]>();

    for (const line of records) {
      const at = line.indexOf(') = ');
      const key = line.slice(0, at + 1);

      keyed.set(key, [...(keyed.get(key) ?? []), line.slice(at + 4)]);
    }

    return keyed;
  };
  const theirs = byKey(installed.records);
  const ours = byKey(assets.records);

  for (const key of new Set([...theirs.keys(), ...ours.keys()])) {
    const a = theirs.get(key) ?? [];
    const b = ours.get(key) ?? [];

    for (let at = 0; at < Math.max(a.length, b.length); at++) {
      if (a[at] !== b[at]) {
        found.push([key, a[at] ?? null, b[at] ?? null]);
      }
    }
  }

  return found;
}

/** Whether a listed record matches a key: the key itself, or, ending in `*`, every key it begins. */
const matches = (listed: string, key: string) =>
  listed.endsWith('*') ? key.startsWith(listed.slice(0, -1)) : listed === key;

const sweeping = process.env.ASSETS_SWEEP === '1' && bundle() !== null;

(sweeping ? describe : describe.skip)('the asset bundle base, every probe', () => {
  it('differs from the installation only where the list says', async () => {
    const listed = JSON.parse(
      readFileSync(join(ROOT, 'test', 'oracle', 'assets-differences.json'), 'utf8')
    ).probes as Record<string, { engine?: string; records: string[]; reason: string }[]>;
    const found: Record<string, Difference[]> = {};
    const failures: string[] = [];
    const swept = runs();

    for (const each of swept) {
      const started = Date.now();
      const differing = differences(await run(each, 'installed'), await run(each, 'assets'));

      if (process.env.ASSETS_SWEEP_LOG) {
        process.stderr.write(
          `${each.fixture}: ${differing.length} differing, ${Date.now() - started} ms\n`
        );
      }

      if (differing.length) {
        found[each.fixture] = differing;
      }
    }

    if (process.env.ASSETS_SWEEP_OUT) {
      writeFileSync(process.env.ASSETS_SWEEP_OUT, JSON.stringify(found, null, 2));
    }

    for (const { fixture } of swept) {
      const entries = (listed[fixture] ?? []).filter(
        ({ engine }) => !engine || engine === 'typescript'
      );
      const differing = found[fixture] ?? [];

      for (const [key, a, b] of differing) {
        if (!entries.some(({ records }) => records.some((each) => matches(each, key)))) {
          failures.push(
            `${fixture}: ${key} differs, not listed: installation ${JSON.stringify(a)}, base ${JSON.stringify(b)}`
          );
        }
      }

      for (const { records, reason } of entries) {
        for (const each of records) {
          if (!differing.some(([key]) => matches(each, key))) {
            failures.push(`${fixture}: ${each} is listed (${reason}) and no longer differs`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  }, 86_400_000);
});
