/**
 * Tests for the no-unsafe-execa ESLint rule
 *
 * This test suite verifies that the custom ESLint rule correctly identifies
 * potentially unsafe execa() usage patterns that could lead to command injection.
 */

const { RuleTester } = require('eslint');
const rule = require('./no-unsafe-execa');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

ruleTester.run('no-unsafe-execa', rule, {
  valid: [
    // Safe: Literal command and literal arguments
    {
      code: `execa('docker', ['ps', '-a']);`,
    },
    // Safe: Literal command with options
    {
      code: `execa('docker', ['compose', 'up'], { cwd: '/path' });`,
    },
    // Safe: Template literal without expressions
    {
      code: 'execa(`docker`, [`ps`]);',
    },
    // Safe: Variable for argument array (the safe pattern for dynamic values)
    {
      code: `const args = ['ps', '-a']; execa('docker', args);`,
    },
    // Safe: Using toString() on a number in argument array
    {
      code: `execa('docker', ['stop', containerId.toString()]);`,
    },
    // Safe: Spread operator with literal array
    {
      code: `execa('docker', ['compose', ...['up', '-d']]);`,
    },
    // Safe: Method call execa.sync with literals
    {
      code: `execa.sync('chmod', ['-R', 'a+rX', '/path']);`,
    },
    // Safe: shell: false is explicitly set (this is the default and safe)
    {
      code: `execa('ls', ['-la'], { shell: false });`,
    },
  ],

  invalid: [
    // Unsafe: Template literal in command
    {
      code: 'execa(`${cmd}`, []);',
      errors: [{ messageId: 'unsafeTemplateCommand' }],
    },
    // Unsafe: String concatenation in command
    {
      code: `execa('docker' + cmd, []);`,
      errors: [{ messageId: 'unsafeConcatCommand' }],
    },
    // Unsafe: Variable as command name
    {
      code: `execa(command, ['arg']);`,
      errors: [{ messageId: 'unsafeVariableCommand' }],
    },
    // Unsafe: Template literal with expression in argument array
    {
      code: 'execa(`docker`, [`--filter=name=${name}`]);',
      errors: [{ messageId: 'unsafeTemplateArg' }],
    },
    // Unsafe: String concatenation in argument array
    {
      code: `execa('docker', ['--filter=' + userInput]);`,
      errors: [{ messageId: 'unsafeConcatArg' }],
    },
    // Unsafe: shell: true option
    {
      code: `execa('ls', ['-la'], { shell: true });`,
      errors: [{ messageId: 'unsafeShellOption' }],
    },
    // Unsafe: shell: true with execa.sync
    {
      code: `execa.sync('ls', ['-la'], { shell: true });`,
      errors: [{ messageId: 'unsafeShellOption' }],
    },
    // Unsafe: Multiple issues in one call
    {
      code: 'execa(cmd, [`-a=${val}`], { shell: true });',
      errors: [
        { messageId: 'unsafeVariableCommand' },
        { messageId: 'unsafeTemplateArg' },
        { messageId: 'unsafeShellOption' },
      ],
    },
  ],
});

console.log('All tests passed!');
