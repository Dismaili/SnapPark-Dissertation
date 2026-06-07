import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Mirrors the per-service Istanbul setup in the backend services so the
// shared scripts/coverage-metrics.js analyzer (which reads
// coverage-final.json) can process the frontend too.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/lib/**/*.ts', 'src/components/**/*.{ts,tsx}'],
      exclude: [
        'src/app/**',          // page components mostly import server-only stuff
        '**/*.d.ts',
        '**/node_modules/**',
      ],
    },
  },
});
