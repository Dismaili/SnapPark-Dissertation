import { defineConfig } from 'vitest/config';

// Istanbul provider is required for genuine condition / decision-condition
// coverage. V8 sees byte ranges only and cannot decompose `a && b` into
// individual condition outcomes; Istanbul instruments the AST and so
// distinguishes branch types in coverage-final.json (the analyzer in
// scripts/coverage-metrics.js depends on that distinction).
export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      // Keep the report focused on application code; rabbitmq.js is a thin
      // I/O wrapper that's exercised only in live integration runs, not
      // unit tests.
      exclude: ['src/rabbitmq.js'],
    },
  },
});
