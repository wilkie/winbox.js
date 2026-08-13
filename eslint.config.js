import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'docs/**', 'coverage/**', 'playwright-report/**', 'test-results/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      /* The sources came over from JavaScript wholesale. Anything that fires
       * purely because of that conversion is a warning: errors are reserved
       * for newly introduced problems, so a clean `pnpm lint` stays meaningful
       * in CI. Promote these back to errors as the debt gets paid down.
       */
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Half-written win16 API stubs; the unused parameters document the ABI.
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // `var` that ESLint could not safely convert (captured in loops, etc).
      'no-var': 'warn',
      'no-case-declarations': 'warn',
      'no-useless-assignment': 'warn',
    },
  },

  {
    /* Opcode dispatch tables fall through on purpose, constantly: an 8086
     * decoder is one big switch where shared tails are the point.
     */
    files: ['src/emulator/**/*.ts'],
    rules: {
      'no-fallthrough': 'off',
    },
  },

  {
    files: ['test/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },

  {
    files: ['*.config.ts', '*.config.js', 'jest.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  }
);
