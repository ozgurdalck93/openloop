import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // This suite exercises real SQLite. Keeping files serial avoids exhausting
    // memory-constrained development and CI environments with forked workers.
    fileParallelism: false,
    maxWorkers: 1,
  },
});
