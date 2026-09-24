'use strict';

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWN_GAPS, loadFixtures, prepareFonts, replayFixture, type Outcome } from './replay.js';

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
 */

const LABEL: Record<Outcome, string> = {
  agreed: 'agree',
  disagreed: 'DISAGREE',
  unimplemented: 'stub',
  unsupported: 'no adapter',
};

const fixtures = loadFixtures();

/**
 * The report the knowledge base reads: for every fixture, every probe
 * function, how many records came out each way. Sorted and free of anything
 * that varies between runs, so a green run on unchanged code leaves it byte
 * for byte as it was, and a change in agreement shows up as a change to a
 * tracked file. Written only when every fixture was replayed, so a filtered
 * run never leaves a partial report behind. See `KNOWLEDGE_BASE_SPEC.md`,
 * phase 2.
 */
const REPORT = join(__dirname, '..', '..', 'kb', 'data', 'conformance.json');
const report: Record<string, any> = {};

function recordReport(fixture: any, replayed: { function: string; outcome: Outcome }[]) {
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

  report[fixture.file] = {
    probe: fixture.probe,
    display: fixture.display ?? null,
    windows: fixture.source?.windows ?? null,
    records: replayed.length,
    functions: Object.fromEntries(Object.entries(functions).sort(([a], [b]) => a.localeCompare(b))),
    gaps,
  };
}

/** The fixtures git tracks, so that a local, uncommitted recording stays out of a tracked report. */
function trackedFixtures(): Set<string> | null {
  try {
    const listed = execFileSync('git', ['ls-files', 'oracle/fixtures'], {
      cwd: join(__dirname, '..', '..'),
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

function writeReport() {
  if (Object.keys(report).length !== fixtures.length) {
    return;
  }

  const tracked = trackedFixtures();
  const sorted = Object.fromEntries(
    Object.entries(report)
      .filter(([file]) => !tracked || tracked.has(file))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  writeFileSync(REPORT, JSON.stringify(sorted, null, 1) + '\n');
}

if (fixtures.length === 0) {
  describe('API conformance', () => {
    it.skip('needs fixtures; run the oracle pipeline to record them', () => {});
  });
} else {
  describe('API conformance', () => {
    afterAll(writeReport);

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

          ({ replayed, summary } = await replayFixture(fixture));
          recordReport(fixture, replayed);
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

            expect(wrong.map((record) => `${name}(${record.args}) = ${record.actual}`)).toEqual(
              wrong.map((record) => `${name}(${record.args}) = ${record.expected}`)
            );
          });
        }
      });
    }
  });
}
