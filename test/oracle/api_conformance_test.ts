'use strict';

import { KNOWN_GAPS, loadFixtures, replayFixture, type Outcome } from './replay.js';

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
        const { replayed, summary } = replayFixture(fixture);

        it('reports what it found', function () {
          const rate = ((summary.agreed / summary.total) * 100).toFixed(1);

          const lines = [...summary.byFunction.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, entry]) => {
              const detail = `${entry.agreed}/${entry.total}`;
              return `  ${name.padEnd(12)}${detail.padStart(7)}   ${LABEL[entry.outcome]}`;
            });

          console.log(
            `\n${fixture.probe}: ${summary.agreed}/${summary.total} records agree (${rate}%)\n` +
              `${lines.join('\n')}\n`
          );

          // Recording nothing would otherwise look like agreeing about nothing.
          expect(summary.total).toBeGreaterThan(0);
        });

        /* Every function gets its own test so that the report names what is
         * wrong rather than making someone read a diff of everything.
         */
        for (const [name, entry] of [...summary.byFunction.entries()].sort()) {
          const records = replayed.filter((record) => record.function === name);

          if (entry.outcome === 'unimplemented' || entry.outcome === 'unsupported') {
            it.failing(`${name} matches Windows`, function () {
              throw new Error(
                entry.outcome === 'unimplemented'
                  ? `${name} is not implemented`
                  : `${name} has no replay adapter`
              );
            });

            continue;
          }

          /* A known gap is expected to fail, so the suite stays green while it
           * lasts. If it starts agreeing, the entry is stale and saying so is
           * the whole point -- an exception list nobody prunes stops meaning
           * anything.
           */
          if (KNOWN_GAPS[name]) {
            if (entry.outcome === 'agreed') {
              it(`${name} is no longer a known gap`, function () {
                throw new Error(
                  `${name} now agrees with Windows; remove it from KNOWN_GAPS in replay.ts`
                );
              });
            } else {
              it.failing(`${name} matches Windows`, function () {
                throw new Error(`${name}: ${KNOWN_GAPS[name]}`);
              });
            }

            continue;
          }

          it(`${name} matches Windows`, function () {
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
