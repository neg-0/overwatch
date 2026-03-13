import { expect, test } from '@playwright/test';

/**
 * Command Dashboard E2E tests — verify dashboard renders, playback controls,
 * and connection indicator.
 */

test.describe('Command Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the dashboard page', async ({ page }) => {
    // Main content area should exist
    await expect(page.locator('.main-content')).toBeVisible();

    // Dashboard should be the active route
    const dashLink = page.locator('.nav-link:has-text("Dashboard")');
    await expect(dashLink).toHaveClass(/active/);
  });

  test('shows playback controls in sidebar footer', async ({ page }) => {
    // Status indicator
    await expect(page.locator('.playback-controls')).toBeVisible();

    // Status text (IDLE or STOPPED initially)
    const statusText = page.locator('.playback-controls__status-text');
    await expect(statusText).toBeVisible();

    // Time display
    await expect(page.locator('.playback-controls__day')).toBeVisible();
    await expect(page.locator('.playback-controls__clock')).toBeVisible();
  });

  test('shows time display as DAY -- and --:--:--Z when no simulation active', async ({ page }) => {
    await expect(page.locator('.playback-controls__day')).toHaveText('DAY --');
    await expect(page.locator('.playback-controls__clock')).toHaveText('--:--:--Z');
  });

  test('shows Start button when simulation is idle', async ({ page }) => {
    const startButton = page.locator('.shuttle-btn:has-text("Start")');
    await expect(startButton).toBeVisible();
  });

  test('connection indicator exists', async ({ page }) => {
    await expect(page.locator('.playback-controls__conn')).toBeVisible();
  });
});

test.describe('WebSocket Connection', () => {
  test('connects to server WebSocket on load', async ({ page }) => {
    await page.goto('/');

    // Wait for connection indicator to show connected state
    // The connection indicator should get the 'connected' class
    const connIndicator = page.locator('.playback-controls__conn');
    await expect(connIndicator).toHaveClass(/connected/, { timeout: 5000 });
  });
});
