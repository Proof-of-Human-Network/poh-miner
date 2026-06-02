import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.js'],
    // More permissive transform settings for heavy integration tests
    // that import large parts of the application
    deps: {
      inline: [
        // Try to inline problematic local packages if needed
      ],
    },
    // Increase timeouts significantly for real miner runs
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});