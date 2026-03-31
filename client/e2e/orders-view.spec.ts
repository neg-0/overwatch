import { expect, test } from '@playwright/test';

test.describe('Orders View E2E', () => {
  let scenarioId: string;

  test.beforeAll(() => {
    scenarioId = process.env.TEST_SCENARIO_ID!;
    expect(scenarioId).toBeDefined();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      if (id) window.localStorage.setItem('ow_activeScenarioId', id);
    }, scenarioId);
    
    await page.goto('/orders');
  });

  test('renders the tasking orders page with title', async ({ page }) => {
    await expect(page.locator('h2', { hasText: 'Tasking Orders' })).toBeVisible();
    
    // There should be an orders list or empty state shown
    await expect(page.locator('.orders-list-container, .empty-state, .orders-grid')).toBeVisible();
  });

  test('displays orders populated from seeded scenario', async ({ page }) => {
    // Wait for the data to fetch and render
    // Our test scenario has at least 1 ATO order
    await page.waitForTimeout(1000); 

    const orderCards = page.locator('.order-card');
    await expect(orderCards).toHaveCountGreaterThan(0, { timeout: 10000 });
  });

  test('order cards display the issuing authority or type', async ({ page }) => {
    const orderCard = page.locator('.order-card').first();
    
    // Seed uses CFACC 613AOC and ATO
    await expect(orderCard).toContainText('ATO');
  });

  test('can expand an order to view mission packages', async ({ page }) => {
    const orderCard = page.locator('.order-card').first();
    
    // Some implementations clicking the card expands it
    await orderCard.click();
    
    // See if mission details or a package listing appears
    const packageItems = page.locator('.package-item, .mission-item, .order-details');
    await expect(packageItems).toBeVisible({ timeout: 5000 });
  });
});
