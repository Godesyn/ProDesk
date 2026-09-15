import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@prodesk/server-shared': path.resolve(__dirname, '../../packages/server-shared/src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      '../../packages/server-shared/src/**/*.test.ts',
      // Frontend modules that are pure enough to run under `environment: 'node'`
      // — no React, no DOM, no imports beyond types. The repo has one test
      // runner, and a burst absorber and a cache writer are exactly the kind of
      // logic that should not be verified by opening the app and typing fast.
      // Anything needing a DOM belongs in its own harness, not here.
      '../../packages/shared/src/lib/**/*.test.ts',
      '../../clients/chat/src/app/**/*.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
