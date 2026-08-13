import base from './jest.config.js';

/** @type {import('jest').Config} */
export default {
  ...base,
  roots: ['<rootDir>/test/conformance'],
  testMatch: ['**/*.spec.ts'],
  // Thousands of instruction executions per opcode; the default 5s is not it.
  testTimeout: 120000,
};
