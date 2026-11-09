import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'docs/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      /* cargo's, with the page's module that `pnpm build:web` writes. */
      'target/**',
      /* Agents' worktrees, each a checkout of its own. */
      '.claude/**',
    ],
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
      /* The sources came over from JavaScript wholesale. The rules that fired
       * because of that conversion were warnings until the debt was paid
       * down; it has been, and they are errors again. An unused parameter
       * that documents an ABI takes a leading underscore.
       */
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Half-written win16 API stubs; the unused parameters document the ABI.
      '@typescript-eslint/no-empty-function': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-var': 'error',
      'no-case-declarations': 'error',
      'no-useless-assignment': 'error',
    },
  },

  {
    /* The run page's components (React and MUI, `src/run/ui/`): the rules
     * of hooks, and the accessibility rules for JSX, as each recommends. */
    files: ['src/**/*.tsx'],
    ...jsxA11y.flatConfigs.recommended,
    plugins: {
      ...jsxA11y.flatConfigs.recommended.plugins,
      ...reactHooks.configs.flat.recommended.plugins,
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
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
    files: ['*.config.ts', '*.config.js', 'jest.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  }
);
