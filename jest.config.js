/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['**/*_test.ts'],

  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript' },
          target: 'es2022',
          /* Matches tsconfig.json. Migration-era members are declared with
           * `declare`, so they emit nothing either way.
           */
          transform: { useDefineForClassFields: true },
        },
      },
    ],
  },

  /* Sources import each other with explicit `.js` specifiers (the TypeScript
   * convention that survives bundling). Jest resolves against the real files,
   * so drop the extension and let it find the `.ts`.
   */
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  collectCoverageFrom: ['src/**/*.ts', '!src/shim.ts'],
  coverageDirectory: 'coverage',
  /* Jasmine restored spies after every spec; `restoreMocks` is the equivalent,
   * and matters because the suite spies on shared prototypes (ALU.prototype).
   */
  restoreMocks: true,
};
