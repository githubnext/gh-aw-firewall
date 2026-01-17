module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/../benchmarks'],
  testMatch: ['**/*.benchmark.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testTimeout: 300000, // 5 minutes per test (benchmarks can be slow)
  verbose: true,
  maxWorkers: 1, // Run tests serially to get accurate benchmark measurements
};
