module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    // Transform ESM dependencies to CommonJS for Jest compatibility
    '^.+\\.js$': 'babel-jest',
  },
  // Allow transformation of ESM-only packages (chalk 5.x, etc.)
  transformIgnorePatterns: [
    '/node_modules/(?!(chalk|#ansi-styles|#supports-color)/)',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 35,
      lines: 38,
      statements: 38,
    },
  },
};
