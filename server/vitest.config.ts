import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    exclude: [
      'node_modules',
      // Legacy integration test scripts — use custom assert() runner, not vitest describe/it format.
      // Run these standalone with: npx tsx server/src/llm/__tests__/phase2.test.ts
      'src/llm/__tests__/phase2.test.ts',
      'src/cognition/__tests__/phase3.test.ts',
    ],
    testTimeout: 10000,
  },
});
