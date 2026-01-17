const rulesDirPlugin = require('eslint-plugin-rulesdir');
rulesDirPlugin.RULES_DIR = 'eslint-rules';

module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'security', 'rulesdir'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended-legacy',
  ],
  env: {
    node: true,
    es2020: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    // Security rules for command execution
    // detect-child-process catches child_process usage; our custom rule catches execa
    'security/detect-child-process': 'error',
    // Custom rule for execa - set to warn as it may have false positives requiring human review
    'rulesdir/no-unsafe-execa': 'warn',
  },
  ignorePatterns: ['dist/', 'node_modules/', 'eslint-rules/'],
};
