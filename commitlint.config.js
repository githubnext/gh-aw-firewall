module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce lowercase for type
    'type-case': [2, 'always', 'lower-case'],
    // Disable case checking for subject (allows acronyms like UID/GID)
    'subject-case': [0],
    // No period at end of subject
    'subject-full-stop': [2, 'never', '.'],
    // Max 72 chars for subject (git best practice)
    'header-max-length': [2, 'always', 72],
  },
};
