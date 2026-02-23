import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: 'postgresql://dustinstringer@localhost:5432/overwatch_test'
    },

    // Workspace-style projects for tiered testing
    projects: [
      {
        // Unit tests — pure logic, no DB
        extends: true,
        test: {
          name: 'unit',
          include: ['src/__tests__/unit/**/*.test.ts'],
          testTimeout: 10000,
        },
      },
      {
        // Integration tests — DB + API
        extends: true,
        test: {
          name: 'integration',
          include: ['src/__tests__/integration/**/*.test.ts'],
          testTimeout: 30000,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        // E2E tests — full lifecycle
        extends: true,
        test: {
          name: 'e2e',
          include: ['src/__tests__/e2e/**/*.test.ts'],
          testTimeout: 60000,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
