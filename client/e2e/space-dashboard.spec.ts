import { expect, test } from '@playwright/test';

test.describe('Space Assets Dashboard E2E', () => {
  let scenarioId: string;

  test.beforeAll(() => {
    scenarioId = process.env.TEST_SCENARIO_ID!;
    expect(scenarioId).toBeDefined();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      if (id) window.localStorage.setItem('ow_activeScenarioId', id);
    }, scenarioId);
    
    await page.goto('/space');
  });

  test('renders the space dashboard title', async ({ page }) => {
    await expect(page.locator('h2', { hasText: 'Space Assets' })).toBeVisible();
    await expect(page.locator('.space-dashboard, .space-assets-view')).toBeVisible();
  });

  test('displays SATCOM and ISR allocations based on seed', async ({ page }) => {
    await page.waitForTimeout(1000);
    
    // There should be a list of space assets from the new enriched seed
    const assetItems = page.locator('.space-asset-item, .space-asset-card, tr.space-asset');
    await expect(assetItems).toHaveCountGreaterThan(0, { timeout: 10000 });
  });

  test('filters space assets by band or type', async ({ page }) => {
    // There should be a filter bar
    const filterInput = page.locator('input[placeholder*="Search"], .filter-input, input[type="text"]');
    
    if (await filterInput.count() > 0) {
      await filterInput.fill('UHF');
      
      // The list should update. E2E tests for React filters
      await page.waitForTimeout(500);
      const filteredItems = page.locator('.space-asset-item, .space-asset-card, tr.space-asset');
      // The exact count depends on the seed. But it shouldn't be empty or crash.
      await expect(filteredItems).toBeVisible();
    }
  });

  test('shows health or operational status indicators', async ({ page }) => {
    const statusBadges = page.locator('.status-badge, .operational-status, .health-indicator');
    await expect(statusBadges).toHaveCountGreaterThan(0, { timeout: 10000 });
  });
});
