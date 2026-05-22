import { defineConfig } from 'vitest/config';

// See notification-service/vitest.config.js for why istanbul is required
// over the v8 default.
export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      // rabbitmq.js is a thin amqplib wrapper — exercised only by the e2e
      // run, not unit tests. Matches the same exclusion in
      // notification-service/vitest.config.js.
      exclude: ['src/rabbitmq.js'],
    },
  },
});
