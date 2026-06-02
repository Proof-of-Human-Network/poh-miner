import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Note: Integration tests live in test/integration/
      // They are run explicitly via `npm run test:integration`
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});