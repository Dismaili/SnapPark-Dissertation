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
    },
  },
});
