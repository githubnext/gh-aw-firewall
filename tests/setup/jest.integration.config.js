module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../integration'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': 'babel-jest',
  },
  transformIgnorePatterns: [
    // Transform ESM-only packages (chalk, execa, commander, etc.)
    'node_modules/(?!(chalk|execa|commander)/)',
  ],
  collectCoverageFrom: [
    '../integration/**/*.ts',
    '!**/*.test.ts',
    '!**/node_modules/**',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testTimeout: 120000, // 2 minutes per test (firewall tests can be slow)
  verbose: true,
  maxWorkers: 1, // Run tests serially to avoid Docker conflicts
};
