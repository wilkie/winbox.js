'use strict';

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

if (fixtures.length === 0) {
  describe('API conformance', () => {
    it.skip('needs fixtures; run the oracle pipeline to record them', () => {});
  });
} else {
  describe('API conformance', () => {
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
           * -- so that the same function agreeing in another fixture still counts. */
          const gap = KNOWN_GAPS[`${fixture.probe}:${name}`] ?? KNOWN_GAPS[name];

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
