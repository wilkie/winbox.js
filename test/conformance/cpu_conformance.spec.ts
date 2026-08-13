/**
 * Runs the CPU conformance oracle and guards against regression.
 *
 * The core does not pass these tests today, and pretending otherwise would
 * make the suite useless. Instead each opcode is measured against a recorded
 * baseline in `baseline.json`: passing more than the baseline is welcome,
 * passing fewer is a regression and fails the run.
 *
 *   pnpm test:conformance                      # run against the baseline
 *   CONFORMANCE_SAMPLE=1000 pnpm test:conformance
 *   CONFORMANCE_UPDATE=1 pnpm test:conformance # re-record the baseline
 *
 * Vectors are fetched separately and not committed:
 *
 *   node scripts/fetch-cpu-tests.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { availableOpcodes, renderReport, runOpcode, type OpcodeSummary } from './oracle.js';

const BASELINE_PATH = join(__dirname, 'baseline.json');
const REPORT_PATH = join(__dirname, 'report.md');

const SAMPLE = Number(process.env.CONFORMANCE_SAMPLE ?? 250);
const UPDATING = process.env.CONFORMANCE_UPDATE === '1';

interface Baseline {
  note: string;
  sample: number;
  opcodes: Record<string, { passed: number; total: number }>;
}

function readBaseline(): Baseline {
  if (!existsSync(BASELINE_PATH)) {
    return { note: '', sample: SAMPLE, opcodes: {} };
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

const opcodes = availableOpcodes();
const baseline = readBaseline();
const summaries: OpcodeSummary[] = [];

if (!opcodes.length) {
  describe('CPU conformance', () => {
    it.skip('needs vectors: run `node scripts/fetch-cpu-tests.mjs`', () => {});
  });
} else {
  describe(`CPU conformance (${opcodes.length} opcodes, ${SAMPLE} vectors each)`, () => {
    /* The core logs unconditionally from its descriptor-table setters and from
     * the HLT stub. At thousands of executions per opcode that is unreadable,
     * and slow.
     */
    let silenced: jest.SpyInstance;

    beforeAll(() => {
      silenced = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterAll(() => {
      silenced.mockRestore();
    });

    for (const opcode of opcodes) {
      it(`opcode ${opcode} does not regress`, () => {
        const summary = runOpcode(opcode, SAMPLE);
        summaries.push(summary);

        const recorded = baseline.opcodes[opcode];

        if (!recorded || UPDATING) {
          // Nothing to compare against yet; the run records it below.
          return;
        }

        /* Pass rates are not uniform across an opcode's vectors, so a baseline
         * taken at one sample size says nothing exact about another. Rather
         * than invent a tolerance, only gate when the sizes match.
         */
        if (baseline.sample !== SAMPLE) {
          return;
        }

        const expected = recorded.passed;

        if (summary.passed < expected) {
          throw new Error(
            `opcode ${opcode} regressed: ${summary.passed}/${summary.total} passing, ` +
              `baseline predicts at least ${expected}. ` +
              `First failures: ${JSON.stringify(summary.examples)}`
          );
        }

        expect(summary.passed).toBeGreaterThanOrEqual(expected);
      });
    }

    afterAll(() => {
      if (!summaries.length) {
        return;
      }

      writeFileSync(REPORT_PATH, renderReport(summaries, SAMPLE));

      if (UPDATING) {
        const updated: Baseline = {
          note:
            'Recorded pass rates for the current core against hardware-captured ' +
            '80286 vectors. Regenerate with CONFORMANCE_UPDATE=1 pnpm test:conformance.',
          sample: SAMPLE,
          opcodes: Object.fromEntries(
            [...summaries]
              .sort((a, b) => a.opcode.localeCompare(b.opcode))
              .map((entry) => [entry.opcode, { passed: entry.passed, total: entry.total }])
          ),
        };

        writeFileSync(BASELINE_PATH, `${JSON.stringify(updated, null, 2)}\n`);
      }

      if (!UPDATING && baseline.sample !== SAMPLE && Object.keys(baseline.opcodes).length) {
        process.stdout.write(
          `\nNote: baseline was recorded at CONFORMANCE_SAMPLE=${baseline.sample}, this run ` +
            `used ${SAMPLE}, so regression checking was skipped. Re-run at ${baseline.sample}, ` +
            `or re-record with CONFORMANCE_UPDATE=1.\n`
        );
      }

      const total = summaries.reduce((sum, entry) => sum + entry.total, 0);
      const passed = summaries.reduce((sum, entry) => sum + entry.passed, 0);
      process.stdout.write(
        `\nConformance: ${passed}/${total} vectors (${((passed / total) * 100).toFixed(1)}%) ` +
          `across ${summaries.length} opcodes. Report written to test/conformance/report.md\n`
      );
    });
  });
}
