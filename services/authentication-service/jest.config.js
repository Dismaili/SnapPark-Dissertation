export default {
  testEnvironment: 'node',
  transform: {},
  // Separate unit and integration test suites
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      testEnvironment: 'node',
      transform: {},
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.js'],
      testEnvironment: 'node',
      transform: {},
      // Integration tests run sequentially to avoid DB conflicts
      maxWorkers: 1,
    },
  ],
};
