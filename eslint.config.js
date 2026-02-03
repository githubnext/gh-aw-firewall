const globals = require('globals');
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'eslint-rules/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    rules: {
      // Custom TypeScript rules
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Security rules - core ESLint rules for security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Note: Custom 'rulesdir/no-unsafe-execa' rule and eslint-plugin-security
      // are not yet compatible with ESLint 9 flat config system
      // TODO: Re-enable when plugins are updated for flat config support
    },
  }
);
