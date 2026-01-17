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
  // Note: chalk 5.x is pure ESM and uses subpath imports (#ansi-styles, #supports-color)
  // which are resolved within the chalk package itself
  transformIgnorePatterns: ['/node_modules/(?!chalk/)'],
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
