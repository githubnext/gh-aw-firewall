module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../integration'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
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
