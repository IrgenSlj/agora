import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Blocks real network access — see test/setup.ts for why.
    setupFiles: ['test/setup.ts'],
    testTimeout: 10000
  }
});
