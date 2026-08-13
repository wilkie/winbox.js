import base from './jest.config.js';
import conformance from './jest.conformance.config.js';

/**
 * Coverage across both suites at once.
 *
 * The unit suite and the conformance oracle exercise very different parts of
 * the emulator, and measuring either alone is misleading: the unit suite on its
 * own reports about a quarter of the statements, while the two together put the
 * 286 core above eighty percent. Neither number tells you what *neither* suite
 * reaches, which is the number worth acting on.
 *
 *   pnpm test:coverage
 *   CONFORMANCE_SAMPLE=20 pnpm test:coverage    # faster, still representative
 *
 * The conformance project contributes nothing if its vectors have not been
 * fetched, so the report is still valid, just narrower.
 */
export default {
  projects: [
    { ...base, displayName: 'unit' },
    { ...conformance, displayName: 'conformance' },
  ],

  collectCoverageFrom: ['src/**/*.ts', '!src/demo.ts', '!src/shim.ts', '!src/vendor.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html'],
};
