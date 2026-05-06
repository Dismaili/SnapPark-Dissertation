export default {
  testEnvironment: 'node',
  transform: {},

  // Coverage configuration is set at the top level rather than per-project
  // so a single jest --coverage run produces one coverage-final.json
  // covering both unit and integration tests. The `scripts/coverage-metrics.js`
  // analyzer relies on the istanbul-format coverage-final.json — Jest
  // produces this by default since it ships with istanbul under the hood.
  coverageProvider: 'babel',
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'json', 'json-summary'],
  collectCoverageFrom: [
    'src/**/*.js',
  ],

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
