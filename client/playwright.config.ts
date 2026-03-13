import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Overwatch client E2E tests.
 *
 * Tests run against both a live Vite dev server (client) and
 * a live Express/Socket.IO server (server) with a real PostgreSQL database.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,            // Tests share server state — run serial
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Start both client and server dev servers */
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../server',
      port: 3001,
      timeout: 15_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: 'postgresql://overwatch:overwatch123@localhost:5432/overwatch_test',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'npm run dev',
      port: 5173,
      timeout: 15_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
