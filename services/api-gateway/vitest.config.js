import { defineConfig } from 'vitest/config';

// Istanbul provider — same rationale as the other services: required for
// genuine condition / decision-condition coverage (see
// notification-service/vitest.config.js).
export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
    },
  },
});
