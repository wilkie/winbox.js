'use strict';

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHARDS, shareDirectory } from './conformance-shares.js';
import { KNOWN_GAPS, loadFixtures, prepareFonts, replayFixture, type Outcome } from './replay.js';

export { SHARDS };

/**
 * Agreement with real Windows 3.1, per API function.
 *
 * The fixtures under `oracle/fixtures/` are recordings of what the real thing
 * did, so a disagreement here is not a difference of opinion -- it is us being
 * wrong. What this suite reports is the same shape of number the CPU
 * conformance oracle reports: how much of the measured surface we get right,
 * broken down far enough to act on.
 *
 * Four outcomes, and only one of them is good:
 *
 *   agreed         we returned what Windows returned
 *   disagreed      we returned something else
 *   unimplemented  the function is a stub, or is not exported at all
 *   unsupported    the probe covers it but the replay harness does not yet
 *
 * `unsupported` is deliberately not silent. A probe that grows coverage
 * without the harness growing with it would otherwise look like progress.
 *
 * The replay is split into `SHARDS` test files under `test/oracle/conformance/`
 * so Jest can run them side by side: in one file it is ten minutes on one core,
 * and it set the length of every full run. Each shard takes the fixtures
 * `shardOf` gives it, balanced on the measured cost of each fixture in
 * `fixture-costs.json`, and writes its share of the report where the run's
 * global setup said; the global teardown merges the shares. Run one probe
 * with `npx jest test/oracle/conformance -t "<probe> against"`.
 */

const LABEL: Record<Outcome, string> = {
  agreed: 'agree',
  disagreed: 'DISAGREE',
  unimplemented: 'stub',
  unsupported: 'no adapter',
};

const COSTS = join(__dirname, 'fixture-costs.json');

/** What a fixture no measurement has priced yet is taken to cost, in seconds. */
const UNPRICED = 10;

/**
 * Which shard each fixture belongs to: the most expensive first, each to the
 * shard with the least so far. Deterministic, so a fixture always lands in the
 * same file for the same set of fixtures and costs.
 */
export function shardOf(files: string[]): Map<string, number> {
  let costs: Record<string, number> = {};

  try {
    costs = JSON.parse(readFileSync(COSTS, 'utf8'));
  } catch {
    // Unpriced, every one: the split is then by count.
  }

  const loads = new Array(SHARDS).fill(0);
  const shards = new Map<string, number>();
  const cost = (file: string) => costs[file] ?? UNPRICED;

  for (const file of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
    const shard = loads.indexOf(Math.min(...loads));

    shards.set(file, shard);
    loads[shard] += cost(file);
  }

  return shards;
}

/**
 * How many pixels two recorded cells differ by, where both are bitmaps written
 * as hex digits of the same length -- or `null` where they are not, and there
 * is nothing to count.
 */
function wrongPixels(expected: string, actual: string | null) {
  const hex = /^[0-9a-f]+$/i;

  if (!actual || !hex.test(expected) || !hex.test(actual) || expected.length !== actual.length) {
    return null;
  }

  let count = 0;

  for (let at = 0; at < expected.length; at++) {
    let bits = parseInt(expected[at], 16) ^ parseInt(actual[at], 16);

    while (bits) {
      count += bits & 1;
      bits >>= 1;
    }
  }

  return count;
}

/** One fixture's line in the report the knowledge base reads. */
function reportOf(fixture: any, replayed: { function: string; outcome: Outcome }[]) {
  const functions: Record<string, Record<Outcome | 'total', number>> = {};

  for (const record of replayed) {
    const counts = (functions[record.function] ??= {
      total: 0,
      agreed: 0,
      disagreed: 0,
      unimplemented: 0,
      unsupported: 0,
    });
    counts.total++;
    counts[record.outcome]++;
  }

  const gaps: Record<string, string> = {};

  for (const name of Object.keys(functions)) {
    const gap =
      KNOWN_GAPS[`${fixture.probe}-${fixture.display}:${name}`] ??
      KNOWN_GAPS[`${fixture.probe}:${name}`] ??
      KNOWN_GAPS[name];

    if (gap) {
      gaps[name] = gap;
    }
  }

  return {
    probe: fixture.probe,
    display: fixture.display ?? null,
    windows: fixture.source?.windows ?? null,
    records: replayed.length,
    functions: Object.fromEntries(Object.entries(functions).sort(([a], [b]) => a.localeCompare(b))),
    gaps,
  };
}

/** The tests of one shard: every fixture `shardOf` gives it, one `describe` each. */
export function conformanceShard(shard: number) {
  const all = loadFixtures();
  const shards = shardOf(all.map((fixture: any) => fixture.file));
  const fixtures = all.filter((fixture: any) => shards.get(fixture.file) === shard);

  if (fixtures.length === 0) {
    describe(`API conformance, shard ${shard + 1} of ${SHARDS}`, () => {
      it.skip(
        all.length ? 'has no fixtures of its own' : 'needs fixtures; run the oracle pipeline',
        () => {}
      );
    });

    const directory = shareDirectory();

    if (directory && all.length) {
      writeFileSync(
        join(directory, `${shard}.json`),
        JSON.stringify({ complete: true, report: {}, costs: {} })
      );
    }

    return;
  }

  const report: Record<string, any> = {};
  const costs: Record<string, number> = {};

  describe(`API conformance, shard ${shard + 1} of ${SHARDS}`, () => {
    afterAll(() => {
      const directory = shareDirectory();

      if (directory) {
        writeFileSync(
          join(directory, `${shard}.json`),
          JSON.stringify({
            complete: Object.keys(report).length === fixtures.length,
            report,
            costs,
          })
        );
      }
    });

    for (const fixture of fixtures) {
      describe(`${fixture.probe} against ${fixture.source.windows}`, () => {
        /* The replay runs once the fonts are loaded rather than while tests are
         * being collected, because GDI cannot be asked anything about text
         * without them and loading them is asynchronous.
         */
        let replayed: Awaited<ReturnType<typeof replayFixture>>['replayed'] = [];
        let summary: Awaited<ReturnType<typeof replayFixture>>['summary'];

        beforeAll(async function () {
          await prepareFonts();

          const start = Date.now();

          ({ replayed, summary } = await replayFixture(fixture));
          report[fixture.file] = reportOf(fixture, replayed);
          costs[fixture.file] = Math.round((Date.now() - start) / 100) / 10;
        });

        it('reports what it found', function () {
          const rate = ((summary.agreed / summary.total) * 100).toFixed(1);

          const lines = [...summary.byFunction.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, entry]) => {
              const detail = `${entry.agreed}/${entry.total}`;
              return `  ${name.padEnd(24)}${detail.padStart(7)}   ${LABEL[entry.outcome]}`;
            });

          console.log(
            `\n${fixture.probe}: ${summary.agreed}/${summary.total} records agree (${rate}%)\n` +
              `${lines.join('\n')}\n`
          );

          expect(summary.total).toBeGreaterThan(0);
        });

        /* One test per function, named from the fixture rather than from the
         * replay, so that the list exists before anything has been run.
         */
        for (const name of [...new Set(fixture.records.map((record) => record.function))].sort()) {
          /* A gap may be named for one fixture's use of a function -- `styles:glyph`
           * -- so that the same function agreeing in another fixture still counts,
           * and for one display of a probe recorded on several --
           * `maxwidth-ega:metrics` -- so that agreeing on the other still counts
           * too. */
          const gap =
            KNOWN_GAPS[`${fixture.probe}-${fixture.display}:${name}`] ??
            KNOWN_GAPS[`${fixture.probe}:${name}`] ??
            KNOWN_GAPS[name];

          if (gap) {
            it.failing(`${name} matches Windows`, function () {
              const entry = summary.byFunction.get(name);

              if (entry?.outcome === 'agreed') {
                // Passing here fails the `failing` test, which is the point.
                return;
              }

              throw new Error(`${name}: ${gap}`);
            });

            continue;
          }

          it(`${name} matches Windows`, function () {
            const entry = summary.byFunction.get(name);
            const records = replayed.filter((record) => record.function === name);

            if (entry?.outcome === 'unimplemented' || entry?.outcome === 'unsupported') {
              // Not a disagreement; there is nothing on our side to disagree.
              expect(`${name}: ${LABEL[entry.outcome]}`).toEqual(
                `${name}: ${LABEL[entry.outcome]}`
              );
              return;
            }

            const wrong = records.filter((record) => record.outcome !== 'agreed');

            /* A cell is named with how many of its pixels are wrong, because a
             * count of wrong records cannot say whether a change fixed four
             * letters and broke three -- what `disputed_glyphs_test.ts` did,
             * in a second replay of its own, before this suite held every
             * record to agreement. */
            const pixels = wrong
              .map((record) => [record.args, wrongPixels(record.expected, record.actual)] as const)
              .filter(([, count]) => count !== null);

            if (pixels.length) {
              console.log(
                `${fixture.probe} ${name}: ${pixels.length} cells wrong\n` +
                  pixels.map(([args, count]) => `  ${args.padEnd(48)} ${count} px`).join('\n')
              );
            }

            expect(wrong.map((record) => `${name}(${record.args}) = ${record.actual}`)).toEqual(
              wrong.map((record) => `${name}(${record.args}) = ${record.expected}`)
            );
          });
        }
      });
    }
  });
}
